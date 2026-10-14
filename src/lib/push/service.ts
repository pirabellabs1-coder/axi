import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { enqueue } from "@/lib/jobs";
import { isPushTopic, type PushTopic, type SubscriptionRow } from "./send";

/**
 * Règles métier des notifications push (lot 4 §19) :
 *  - sujet `orders` : transactionnel, lié à un compte acheteur, aucun consentement marketing requis ;
 *  - sujet `marketing` : seulement si le DERNIER consentement `PUSH` / `MARKETING` du client est accordé
 *    (un retrait postérieur l'emporte toujours) ; un visiteur sans compte ne reçoit jamais de marketing ;
 *  - plan : fonction `webPush`, plafond mensuel `limits.pushPerMonth` (compté sur les envois réussis) ;
 *  - toujours filtré par `storeId`, abonnements révoqués exclus.
 */

export const MAX_SUBSCRIPTIONS_PER_STORE = 50_000;

export type PlanPushState = { enabled: boolean; monthlyLimit: number | null; used: number; remaining: number | null };

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Volume déjà envoyé ce mois-ci : somme des compteurs des lignes `Notification` du canal « push ». */
export async function pushSentThisMonth(storeId: string, now = new Date()): Promise<number> {
  const rows = await db.notification.findMany({
    where: { storeId, channel: "push", status: "SENT", createdAt: { gte: monthStart(now) } },
    select: { payload: true },
  });
  let total = 0;
  for (const r of rows) {
    const sent = (r.payload as { sent?: unknown } | null)?.sent;
    if (typeof sent === "number" && Number.isFinite(sent)) total += sent;
  }
  return total;
}

export async function planPushState(storeId: string, now = new Date()): Promise<PlanPushState> {
  const store = await db.store.findUnique({ where: { id: storeId }, select: { subscription: true } });
  const plan = PLANS[effectivePlanId(store?.subscription ?? null)];
  const enabled = plan.features.webPush;
  const monthlyLimit = plan.limits.pushPerMonth;
  const used = enabled ? await pushSentThisMonth(storeId, now) : 0;
  return { enabled, monthlyLimit, used, remaining: monthlyLimit == null ? null : Math.max(0, monthlyLimit - used) };
}

/** Clients dont le dernier consentement push marketing est accordé. */
async function pushMarketingConsent(storeId: string): Promise<Set<string>> {
  const consents = await db.consent.findMany({
    where: { customer: { storeId }, channel: "PUSH", purpose: "MARKETING" },
    orderBy: { createdAt: "desc" },
    select: { customerId: true, granted: true, createdAt: true },
  });
  // Le consentement le plus récent gagne, quel que soit l'ordre renvoyé par la base (comparaison explicite).
  const latest = new Map<string, { at: number; granted: boolean }>();
  for (const c of consents) {
    const at = c.createdAt.getTime();
    const current = latest.get(c.customerId);
    if (!current || at >= current.at) latest.set(c.customerId, { at, granted: c.granted });
  }
  return new Set([...latest].filter(([, v]) => v.granted).map(([id]) => id));
}

export type AudienceQuery = { topic: PushTopic; customerId?: string | null; subscriptionIds?: string[]; limit?: number };

/**
 * Abonnements destinataires d'une notification. Filtre `storeId`, sujet souscrit, non révoqué, et
 * consentement marketing lorsque le sujet est `marketing`.
 */
export async function audience(storeId: string, q: AudienceQuery): Promise<SubscriptionRow[]> {
  const subs = await db.pushSubscription.findMany({
    where: {
      storeId,
      revokedAt: null,
      topics: { has: q.topic },
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.subscriptionIds?.length ? { id: { in: q.subscriptionIds } } : {}),
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true, customerId: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(q.limit ?? 5_000, MAX_SUBSCRIPTIONS_PER_STORE),
  });
  if (q.topic !== "marketing") return subs.map(({ id, endpoint, p256dh, auth }) => ({ id, endpoint, p256dh, auth }));
  const consenting = await pushMarketingConsent(storeId);
  return subs.filter((s) => s.customerId && consenting.has(s.customerId)).map(({ id, endpoint, p256dh, auth }) => ({ id, endpoint, p256dh, auth }));
}

/** Nombre d'abonnements actifs par sujet (écran marchand). */
export async function subscriptionCounts(storeId: string): Promise<{ total: number; orders: number; marketing: number }> {
  const [total, orders, marketing] = await Promise.all([
    db.pushSubscription.count({ where: { storeId, revokedAt: null } }),
    db.pushSubscription.count({ where: { storeId, revokedAt: null, topics: { has: "orders" } } }),
    db.pushSubscription.count({ where: { storeId, revokedAt: null, topics: { has: "marketing" } } }),
  ]);
  return { total, orders, marketing };
}

export type PushJobPayload = {
  storeId: string;
  topic: PushTopic;
  title: string;
  body: string;
  url?: string;
  tag?: string;
  customerId?: string | null;
  campaignId?: string | null;
  subscriptionIds?: string[];
};

export function parsePushJobPayload(raw: unknown): PushJobPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const storeId = str(p.storeId, 64);
  const title = str(p.title, 120);
  const body = str(p.body, 400);
  if (!storeId || !title || !body || !isPushTopic(p.topic)) return null;
  const ids = Array.isArray(p.subscriptionIds) ? p.subscriptionIds.filter((v): v is string => typeof v === "string").slice(0, 500) : undefined;
  return {
    storeId,
    topic: p.topic,
    title,
    body,
    url: str(p.url, 400),
    tag: str(p.tag, 60),
    customerId: str(p.customerId, 64) ?? null,
    campaignId: str(p.campaignId, 64) ?? null,
    subscriptionIds: ids?.length ? ids : undefined,
  };
}

/**
 * Met en file une notification push. À appeler DANS la transaction qui modifie la donnée (outbox),
 * comme le reste des jobs. Le contrôle de plan et de consentement a lieu à l'exécution du job.
 */
export async function enqueuePush(payload: PushJobPayload, tx?: Parameters<typeof enqueue>[3]) {
  return enqueue("push.send", payload as unknown as Record<string, unknown>, { storeId: payload.storeId }, tx);
}

/** Journalise un envoi (compteur du plafond mensuel et historique visible du commerçant). */
export async function recordDelivery(storeId: string, topic: PushTopic, title: string, report: { sent: number; revoked: number; failed: number }, campaignId?: string | null) {
  await db.notification.create({
    data: {
      storeId,
      channel: "push",
      recipient: `push:${topic}`,
      template: `push.${topic}`,
      status: "SENT",
      sentAt: new Date(),
      payload: { title, ...report, campaignId: campaignId ?? null } as Prisma.InputJsonValue,
    },
  });
}
