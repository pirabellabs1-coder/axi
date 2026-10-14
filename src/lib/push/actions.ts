"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zRawId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";
import { getBuyer } from "@/lib/buyer/session";
import { isValidPublicKey, b64urlDecode } from "./encrypt";
import { isAllowedPushEndpoint, PUSH_ENDPOINT_REJECTED } from "./endpoints";
import { PUSH_TOPICS, type PushTopic } from "./send";
import { audience, enqueuePush, MAX_SUBSCRIPTIONS_PER_STORE, planPushState, recordDelivery, subscriptionCounts } from "./service";

/**
 * Actions des notifications push (lot 4 §19).
 *  - Côté boutique (public, sans compte obligatoire) : `subscribeToPush`, `unsubscribeFromPush`.
 *    Les clés d'abonnement ne sont pas des secrets (RFC 8291) : elles sont stockées telles que fournies.
 *  - Côté marchand : `sendTestPush` et `sendPushCampaign` (plan `webPush`, capacité `theme.manage`,
 *    plafond mensuel du plan, consentement `PUSH` pour le marketing, audit).
 */

const subscribeSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,48}$/),
  // Liste blanche d'hôtes (mineur n° 10) : le worker d'envoi POSTe vers cette URL depuis le serveur.
  // Sans elle, un abonnement forgé en fait une SSRF aveugle.
  endpoint: z.string().url().max(1000).refine(isAllowedPushEndpoint, PUSH_ENDPOINT_REJECTED),
  p256dh: z.string().min(40).max(200),
  auth: z.string().min(10).max(80),
  topics: z.array(z.enum(PUSH_TOPICS)).min(1).max(PUSH_TOPICS.length),
});

export type SubscribeInput = z.input<typeof subscribeSchema>;

async function publicStore(slug: string) {
  return db.store.findFirst({
    where: { slug, status: { in: ["PUBLISHED", "CLOSED_TEMPORARILY"] } },
    select: { id: true, slug: true, name: true, subscription: true },
  });
}

/** Enregistre (ou met à jour) un abonnement du navigateur. Idempotent par point de terminaison. */
export async function subscribeToPush(input: SubscribeInput): Promise<ActionResult<{ topics: PushTopic[] }>> {
  return guard(async () => {
    const parsed = subscribeSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues.some((i) => i.path[0] === "endpoint") ? PUSH_ENDPOINT_REJECTED : "Abonnement invalide");
    const { slug, endpoint, p256dh, auth, topics } = parsed.data;

    const ip = await clientIp();
    const rl = await rateLimitAll([
      { key: `push:sub:ip:${ip}`, limit: 20, windowSec: 600 },
      { key: `push:sub:store:${slug}`, limit: 300, windowSec: 600 },
    ]);
    if (!rl.ok) return fail("Trop de tentatives. Réessayez dans quelques minutes.");

    if (!isValidPublicKey(b64urlDecode(p256dh)) || b64urlDecode(auth).length !== 16) return fail("Clés d'abonnement invalides");

    const store = await publicStore(slug);
    if (!store) return fail("Boutique introuvable");
    if (!PLANS[effectivePlanId(store.subscription)].features.webPush) return fail("Les notifications ne sont pas activées sur cette boutique.");

    const buyer = await getBuyer({ id: store.id, slug: store.slug }).catch(() => null);
    // Marketing : réservé aux clients identifiés (le consentement est rattaché à un client).
    const granted: PushTopic[] = buyer ? topics : topics.filter((t) => t !== "marketing");
    if (!granted.length) return fail("Connectez-vous pour recevoir les offres.");

    const existing = await db.pushSubscription.findUnique({ where: { endpoint }, select: { id: true, storeId: true } });
    if (!existing && (await db.pushSubscription.count({ where: { storeId: store.id, revokedAt: null } })) >= MAX_SUBSCRIPTIONS_PER_STORE) {
      return fail("Trop d'abonnements sur cette boutique.");
    }
    if (existing && existing.storeId !== store.id) {
      // Le même navigateur peut être abonné à plusieurs boutiques, mais un point de terminaison est unique :
      // il est réattribué à la boutique courante (le navigateur en crée un nouveau par portée de service worker).
      // RÉVOCATION et non suppression (mineur n° 10) : la ligne de l'ancienne boutique garde sa trace
      // (quand, pour qui, avec quel consentement) au lieu de disparaître silencieusement.
      await db.pushSubscription.updateMany({ where: { id: existing.id }, data: { revokedAt: new Date(), topics: [] } }).catch(() => {});
    }

    const ua = (await headers()).get("user-agent")?.slice(0, 255) ?? null;
    await db.pushSubscription.upsert({
      where: { endpoint },
      create: { storeId: store.id, customerId: buyer?.customerId ?? null, endpoint, p256dh, auth, topics: granted, userAgent: ua, locale: "fr" },
      update: { storeId: store.id, customerId: buyer?.customerId ?? null, p256dh, auth, topics: granted, userAgent: ua, failures: 0, revokedAt: null },
    });

    if (buyer && granted.includes("marketing")) {
      await db.consent.create({ data: { customerId: buyer.customerId, channel: "PUSH", purpose: "MARKETING", granted: true, source: "storefront" } }).catch(() => {});
    }
    return success({ topics: granted });
  });
}

const unsubscribeSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{3,48}$/), endpoint: z.string().url().max(1000) });

/** Désabonnement explicite depuis la boutique : la ligne est révoquée et le consentement marketing retiré. */
export async function unsubscribeFromPush(input: z.input<typeof unsubscribeSchema>): Promise<ActionResult> {
  return guard(async () => {
    const parsed = unsubscribeSchema.safeParse(input);
    if (!parsed.success) return fail("Désabonnement invalide");
    const store = await publicStore(parsed.data.slug);
    if (!store) return fail("Boutique introuvable");
    const row = await db.pushSubscription.findFirst({ where: { endpoint: parsed.data.endpoint, storeId: store.id }, select: { id: true, customerId: true, topics: true } });
    if (!row) return success(undefined, "Notifications désactivées");
    await db.pushSubscription.updateMany({ where: { id: row.id, storeId: store.id }, data: { revokedAt: new Date(), topics: [] } });
    if (row.customerId && row.topics.includes("marketing")) {
      await db.consent.create({ data: { customerId: row.customerId, channel: "PUSH", purpose: "MARKETING", granted: false, source: "storefront" } }).catch(() => {});
    }
    return success(undefined, "Notifications désactivées");
  });
}

/* ───────────── Côté marchand ───────────── */

async function pushContext(storeId: string) {
  const ctx = await requireStore(storeId, "theme.manage");
  if (!PLANS[ctx.planId].features.webPush) {
    return { ctx, error: fail(`Les notifications push sont incluses à partir du plan Business. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  return { ctx, error: null };
}

const campaignSchema = z.object({
  storeId: zRawId,
  title: z.string().trim().min(3, "Titre trop court").max(80, "80 caractères maximum"),
  body: z.string().trim().min(3, "Message trop court").max(240, "240 caractères maximum"),
  url: z.string().trim().max(400).optional(),
  topic: z.enum(PUSH_TOPICS).default("marketing"),
});

/** Campagne push : une ligne `Campaign` (channel « push », sans crédit WhatsApp) et un job d'envoi. */
export async function sendPushCampaign(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(campaignSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await pushContext(parsed.data.storeId);
    if (error) return error;
    const storeId = ctx.store.id;
    const { topic, title, body } = parsed.data;
    const url = parsed.data.url && (parsed.data.url.startsWith("/") || parsed.data.url.startsWith("https://")) ? parsed.data.url : undefined;

    const state = await planPushState(storeId);
    if (state.remaining !== null && state.remaining <= 0) return fail(`Plafond mensuel atteint (${state.monthlyLimit} notifications). Il se réinitialise le 1er du mois.`);
    const subs = await audience(storeId, { topic, limit: state.remaining ?? undefined });
    if (!subs.length) return fail(topic === "marketing" ? "Aucun client abonné aux offres (consentement push requis)." : "Aucun abonné pour ce sujet.");

    await db.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: { storeId, name: title, channel: "push", segment: { kind: "all" }, message: body, status: "SENT", recipients: subs.length, sentAt: new Date(), creditsUsed: 0 },
      });
      await enqueuePush({ storeId, topic, title, body, url, tag: `campaign:${campaign.id}`, campaignId: campaign.id, subscriptionIds: subs.map((s) => s.id) }, tx);
      await audit({ storeId, actorId: ctx.user.id, action: "push.campaign_sent", target: campaign.id, metadata: { topic, recipients: subs.length } }, tx);
    });
    revalidatePath(`/app/${storeId}/apparence/pwa`);
    return success(undefined, `Notification en cours d'envoi à ${subs.length} abonné${subs.length > 1 ? "s" : ""}.`);
  });
}

/** Envoi d'essai : uniquement aux abonnements du membre connecté s'il en a, sinon aux 3 plus récents. */
export async function sendTestPush(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await pushContext(storeId);
    if (error) return error;
    const subs = (await audience(ctx.store.id, { topic: "orders", limit: 3 })).slice(0, 3);
    if (!subs.length) return fail("Aucun abonné : activez d'abord les notifications depuis votre boutique.");
    const { deliver } = await import("./send");
    const report = await deliver(ctx.store.id, subs, { title: ctx.store.name, body: "Les notifications fonctionnent 🎉", url: `/s/${ctx.store.slug}`, topic: "orders", tag: "test" });
    if (!report) return fail("Notifications push non configurées sur ce serveur (clés VAPID absentes).");
    await recordDelivery(ctx.store.id, "orders", "Essai", report);
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "push.test_sent", metadata: report });
    revalidatePath(`/app/${storeId}/apparence/pwa`);
    return report.sent > 0 ? success(undefined, `Essai envoyé (${report.sent}).`) : fail("Aucune notification n'a pu être remise. Vérifiez vos abonnements.");
  });
}

/** Compteurs pour l'écran marchand. */
export async function pushOverview(storeId: string) {
  const ctx = await requireStore(storeId, "theme.manage");
  const [counts, state] = await Promise.all([subscriptionCounts(ctx.store.id), planPushState(ctx.store.id)]);
  return { counts, state };
}
