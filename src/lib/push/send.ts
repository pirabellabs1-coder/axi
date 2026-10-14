import "server-only";
import { db } from "@/lib/db";
import { encryptPush, MAX_PAYLOAD_BYTES } from "./encrypt";
import { platformSubject, platformVapidKeys, vapidHeaders, type VapidKeys } from "./vapid";

/**
 * Envoi effectif d'une notification Web Push (RFC 8030 + 8291 + 8292).
 *  - corps chiffré `aes128gcm`, en-têtes `TTL`, `Urgency`, `Content-Encoding` et `Authorization: vapid` ;
 *  - 404 / 410 : l'abonnement n'existe plus chez le service de push → révoqué en base (jamais réessayé) ;
 *  - 413 : charge trop grande (jamais réessayée) ; 429 et 5xx : à réessayer (le job échoue, le worker retente) ;
 *  - aucun secret ni jeton dans les messages d'erreur (seuls le statut et l'origine du service sont journalisés).
 */

export type PushNotification = {
  title: string;
  body: string;
  /** Lien ouvert au clic (chemin de la boutique ou https). */
  url?: string;
  /** Icône (logo de la boutique) et badge monochrome. */
  icon?: string;
  badge?: string;
  /** Regroupement : une notification par sujet remplace la précédente. */
  tag?: string;
  topic: PushTopic;
};

/** Sujets d'abonnement : `orders` est transactionnel, `marketing` exige le consentement PUSH. */
export const PUSH_TOPICS = ["orders", "marketing"] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

export function isPushTopic(v: unknown): v is PushTopic {
  return typeof v === "string" && (PUSH_TOPICS as readonly string[]).includes(v);
}

export type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

export type SendOutcome =
  | { ok: true; status: number }
  | { ok: false; status: number | null; retryable: boolean; revoked: boolean; error: string };

/** Charge utile JSON transmise au service worker (bornée à `MAX_PAYLOAD_BYTES` après sérialisation). */
export function buildPayload(n: PushNotification): string {
  const clip = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);
  const payload = {
    title: clip(n.title, 80),
    body: clip(n.body, 240),
    url: n.url && (n.url.startsWith("/") || n.url.startsWith("https://")) ? n.url.slice(0, 400) : undefined,
    icon: n.icon?.startsWith("https://") || n.icon?.startsWith("/") ? n.icon.slice(0, 400) : undefined,
    badge: n.badge?.startsWith("https://") || n.badge?.startsWith("/") ? n.badge.slice(0, 400) : undefined,
    tag: n.tag?.slice(0, 60),
    topic: n.topic,
  };
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, "utf8") <= MAX_PAYLOAD_BYTES) return json;
  return JSON.stringify({ ...payload, body: clip(n.body, 120) });
}

const URGENCY: Record<PushTopic, string> = { orders: "high", marketing: "normal" };

/** Envoie une notification à un abonnement. Ne lève pas : le résultat décrit la suite à donner. */
export async function sendToSubscription(sub: SubscriptionRow, notification: PushNotification, keys: VapidKeys, opts: { subject?: string; ttlSec?: number } = {}): Promise<SendOutcome> {
  let origin = "";
  try {
    origin = new URL(sub.endpoint).origin;
  } catch {
    return { ok: false, status: null, retryable: false, revoked: true, error: "Point de terminaison invalide" };
  }
  let body: Buffer;
  try {
    body = encryptPush(buildPayload(notification), { p256dh: sub.p256dh, auth: sub.auth }).body;
  } catch (e) {
    // Clés d'abonnement illisibles : inutile de réessayer, la ligne est révoquée.
    return { ok: false, status: null, retryable: false, revoked: true, error: e instanceof Error ? e.message : "Chiffrement impossible" };
  }
  let res: Response;
  try {
    res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        ...vapidHeaders(sub.endpoint, keys, { subject: opts.subject ?? platformSubject() }),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttlSec ?? 86400),
        Urgency: URGENCY[notification.topic],
      },
      body: new Uint8Array(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: null, retryable: true, revoked: false, error: `Service de push injoignable (${origin})` };
  }
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
  const revoked = res.status === 404 || res.status === 410;
  const retryable = !revoked && res.status !== 400 && res.status !== 401 && res.status !== 403 && res.status !== 413;
  return { ok: false, status: res.status, retryable, revoked, error: `${origin} a répondu ${res.status}` };
}

/** Marque un abonnement révoqué (404 / 410 ou clés illisibles) : il n'est plus jamais sollicité. */
export async function revokeSubscription(id: string, storeId: string) {
  await db.pushSubscription.updateMany({ where: { id, storeId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export type DeliveryReport = { sent: number; revoked: number; failed: number; retryable: number };

/**
 * Envoie une notification à une liste d'abonnements, en séquence bornée (le worker traite un job à la fois).
 * Révoque au fil de l'eau, compte les échecs. `null` si les clés VAPID de la plateforme ne sont pas configurées.
 */
export async function deliver(storeId: string, subs: SubscriptionRow[], notification: PushNotification): Promise<DeliveryReport | null> {
  const keys = platformVapidKeys();
  if (!keys) return null;
  const report: DeliveryReport = { sent: 0, revoked: 0, failed: 0, retryable: 0 };
  for (const sub of subs) {
    const outcome = await sendToSubscription(sub, notification, keys);
    if (outcome.ok) {
      report.sent++;
      await db.pushSubscription.updateMany({ where: { id: sub.id, storeId }, data: { lastSuccessAt: new Date(), failures: 0 } }).catch(() => {});
      continue;
    }
    if (outcome.revoked) {
      report.revoked++;
      await revokeSubscription(sub.id, storeId).catch(() => {});
      continue;
    }
    report.failed++;
    if (outcome.retryable) report.retryable++;
    await db.pushSubscription.updateMany({ where: { id: sub.id, storeId }, data: { failures: { increment: 1 } } }).catch(() => {});
    console.error("[push] échec d'envoi", { subscriptionId: sub.id, status: outcome.status, error: outcome.error });
  }
  // Trop d'échecs consécutifs : l'abonnement est considéré perdu (nettoyage, pas de file qui s'allonge).
  await db.pushSubscription.updateMany({ where: { storeId, revokedAt: null, failures: { gte: 10 } }, data: { revokedAt: new Date() } }).catch(() => {});
  return report;
}
