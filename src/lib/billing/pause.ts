import "server-only";
import type { StoreStatus, Subscription } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS, TRIAL_DAYS, TRIAL_PLAN, ZONE_CURRENCY, type PricingZone } from "@/config/plans";
import { SITE } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { enqueue, queueNotification } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { notifyStore } from "@/lib/notifications/service";
import { getEffectivePlanPriceFor } from "@/lib/pricing/catalog";
import { BILLING_PAUSE_REASON } from "./pause-copy";
import { TIKTOK_SHOP_KIND } from "@/lib/tiktok-shop/config";
import { DAY_MS, billingZone, coverageMirror, pickCoveringSubscription, isLegacyFreeSubscription, pauseReasonOf, shouldPauseStore, trialReminderStage, type PauseReason } from "./rules";

/**
 * Boutique EN PAUSE (plus de plan Gratuit, décision du 18/10/2026).
 *
 * Source de vérité : l'abonnement (`shouldPauseStore` : aucun plan n'ouvre droit). Effet : `Store.status = PAUSED`,
 * statut précédent conservé dans `Store.statusBeforePause`. Comme PAUSED n'est ni PUBLISHED ni CLOSED_TEMPORARILY,
 * TOUS les chemins publics existants (vitrine, commande, panier, flux catalogues, live, MCP vitrine, WhatsApp
 * entrant…) se ferment d'eux-mêmes ; la vitrine affiche « Boutique momentanément fermée ».
 * Les jobs sortants (campagnes, relances, synchros, TikTok Shop, push) sont écartés par `isStorePaused` (jobs.ts).
 * Rien n'est supprimé. Au paiement confirmé, `reconcileStorePause` restaure le statut précédent.
 *
 * Seuls les statuts DRAFT / PUBLISHED / CLOSED_TEMPORARILY sont mis en pause : une boutique SUSPENDED (modération)
 * ou ARCHIVED n'est jamais touchée.
 */

export { BILLING_PAUSE_REASON };
const PAUSABLE: StoreStatus[] = ["DRAFT", "PUBLISHED", "CLOSED_TEMPORARILY"];

type Client = Tx | typeof db;

/** La boutique est-elle en pause (abonnement) ? Lecture légère pour les gardes serveur (jobs, actions). */
export async function isStorePaused(storeId: string, client: Client = db): Promise<boolean> {
  const s = await client.store.findUnique({ where: { id: storeId }, select: { status: true } });
  return s?.status === "PAUSED";
}

/** Jobs sortants suspendus pendant la pause (le transactionnel des commandes existantes continue). */
export const PAUSE_GATED_JOBS: ReadonlySet<string> = new Set([
  "automation.run",
  "cart.check",
  "social.sync",
  "push.send",
  "tiktok_shop.sync",
  "tiktok_shop.publish",
  // PAS `tiktok_shop.order` (commande entrante déjà payée : toujours importée) ni `tiktok_shop.stock_state`
  // (mise à 0 / rétablissement du stock TikTok à la pause et à la reprise).
  "theme.schedule_notify",
]);

/**
 * Garde du worker (src/lib/jobs.ts) : un job sortant d'une boutique en pause est clos sans effet.
 * Boutique lue sur `job.storeId`, à défaut sur `payload.storeId`.
 */
export async function skipJobForPause(job: { type: string; storeId: string | null; payload: unknown }, client: Client = db): Promise<boolean> {
  if (!PAUSE_GATED_JOBS.has(job.type)) return false;
  const fromPayload = job.payload && typeof job.payload === "object" ? (job.payload as { storeId?: unknown }).storeId : null;
  const storeId = job.storeId ?? (typeof fromPayload === "string" ? fromPayload : null);
  return !!storeId && (await isStorePaused(storeId, client));
}

async function ownerEmail(storeId: string, client: Client = db): Promise<string | null> {
  const store = await client.store.findUnique({ where: { id: storeId }, select: { contactEmail: true } });
  if (store?.contactEmail) return store.contactEmail;
  const owner = await client.membership.findFirst({ where: { storeId, role: "OWNER" }, include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } });
  return owner?.user.email ?? null;
}

/** Verrou transactionnel par clé (sérialise cron, pages et actions sur la même notification). */
async function lockKey(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Prix d'appel « à partir de » dans la zone de facturation de la boutique (jamais une devise par défaut). */
async function fromPriceLabel(zone: PricingZone, client: Client): Promise<string | null> {
  const p = await getEffectivePlanPriceFor("STARTER", zone, "MONTHLY", client);
  return p.amount == null ? null : `${formatMoney(p.amount, p.currency || ZONE_CURRENCY[zone])} par mois`;
}

const plansLink = (storeId: string) => `${SITE.url}/app/${storeId}/abonnement`;

/**
 * Notification in-app + e-mail, une seule fois par clé (idempotent : verrou + clé de la notification in-app).
 * Renvoie true si la notification a été créée maintenant.
 */
async function notifyOnce(tx: Tx, storeId: string, key: string, msg: { title: string; text: string; subject: string; email: string }): Promise<boolean> {
  await lockKey(tx, key);
  const created = await notifyStore(storeId, { kind: "invoice.due", title: msg.title, text: msg.text, href: `/app/${storeId}/abonnement`, key }, tx);
  if (!created) return false;
  const to = await ownerEmail(storeId, tx);
  if (to) {
    await queueNotification(storeId, "email", to, key.split(":")[0]!, { subject: msg.subject, text: msg.email, key }, tx);
    await enqueue("notification.send", {}, { storeId }, tx);
  }
  return true;
}

/* ───────────────────────── Rappels de fin d'essai (J-3, J-1) ───────────────────────── */

export function trialReminderKey(subId: string, trialEndsAt: Date, stage: number) {
  return `billing.trial_reminder:${subId}:${trialEndsAt.toISOString()}:J${stage}`;
}

/** Envoie le rappel dû (J-3 ou J-1), une seule fois par essai et par seuil. */
export async function sendTrialReminderIfDue(sub: Subscription, now = new Date()): Promise<number | null> {
  if (sub.coveredBySubscriptionId) return null; // le compte est prévenu via la boutique principale
  const stage = trialReminderStage(sub, now);
  if (!stage || !sub.trialEndsAt) return null;
  const end = sub.trialEndsAt;
  const zone = billingZone(sub, sub.currency);
  const price = await fromPriceLabel(zone, db);
  const store = await db.store.findUnique({ where: { id: sub.storeId }, select: { name: true } });
  const when = stage === 1 ? "demain" : `dans ${stage} jours`;
  const sent = await db.$transaction((tx) =>
    notifyOnce(tx, sub.storeId, trialReminderKey(sub.id, end, stage), {
      title: `Votre essai se termine ${when}`,
      text: `Essai ${PLANS[TRIAL_PLAN].name} jusqu'au ${formatDate(end)}. Choisissez un plan pour que votre boutique reste ouverte.`,
      subject: `${store?.name ?? SITE.name} : votre essai gratuit se termine ${when}`,
      email: `Bonjour,\n\nVotre essai gratuit de ${TRIAL_DAYS} jours (plan ${PLANS[TRIAL_PLAN].name}) se termine le ${formatDate(end)}.\n\nSans plan payant à cette date, votre boutique sera mise en pause : la vitrine affichera « Boutique momentanément fermée » et ne prendra plus de commandes. Rien n'est supprimé, et elle rouvre dès le paiement.\n\nChoisissez votre plan${price ? ` (à partir de ${price})` : ""} : ${plansLink(sub.storeId)}\n\nL'équipe ${SITE.name}`,
    }),
  );
  if (sent) await audit({ storeId: sub.storeId, action: "subscription.trial_reminder", target: sub.id, metadata: { stage, trialEndsAt: end } });
  return sent ? stage : null;
}

/* ───────────────────────── Pause / reprise ───────────────────────── */

const REASON_TEXT: Record<PauseReason, string> = {
  trial_ended: "Votre essai gratuit est terminé",
  cancelled: "Votre abonnement est arrivé à échéance",
  unpaid: "Votre facture d'abonnement n'a pas été réglée",
  no_plan: "Aucun plan n'est actif",
};

/** Met la boutique en pause (dans la transaction). Idempotent : sans effet si déjà en pause ou non pausable. */
export async function pauseStore(tx: Tx, sub: Pick<Subscription, "id" | "storeId" | "status" | "trialEndsAt" | "pausedAt" | "coveredBySubscriptionId">, now = new Date()): Promise<boolean> {
  const store = await tx.store.findUnique({ where: { id: sub.storeId }, select: { status: true } });
  if (!store || !PAUSABLE.includes(store.status)) return false;
  // Verrou optimiste : le statut lu est celui que l'on sauvegarde.
  const r = await tx.store.updateMany({ where: { id: sub.storeId, status: store.status }, data: { status: "PAUSED", statusBeforePause: store.status, statusReason: BILLING_PAUSE_REASON } });
  if (r.count === 0) return false;
  const pausedAt = sub.pausedAt ?? now;
  if (!sub.pausedAt) await tx.subscription.update({ where: { id: sub.id }, data: { pausedAt } });
  const reason = pauseReasonOf(sub);
  await audit({ storeId: sub.storeId, action: "store.paused_billing", metadata: { reason, previous: store.status } }, tx);
  await enqueue("subscription.changed", { storeId: sub.storeId, status: "PAUSED", reason }, { storeId: sub.storeId }, tx);
  await queueTiktokStockState(tx, sub.storeId);
  if (!sub.coveredBySubscriptionId) {
    await notifyOnce(tx, sub.storeId, `billing.paused:${sub.id}:${pausedAt.toISOString()}`, {
      title: "Boutique en pause",
      text: `${REASON_TEXT[reason]}. Votre vitrine est fermée, vos données sont conservées. Choisissez un plan pour la rouvrir.`,
      subject: `${SITE.name} : votre boutique est en pause`,
      email: `Bonjour,\n\n${REASON_TEXT[reason]} : votre boutique est en pause depuis le ${formatDate(now)}.\n\nVos clients voient « Boutique momentanément fermée » et ne peuvent plus commander. Vos produits, commandes et clients sont conservés : rien n'est supprimé.\n\nChoisissez un plan et réglez la facture : votre boutique rouvre automatiquement dès la confirmation du paiement.\n${plansLink(sub.storeId)}\n\nL'équipe ${SITE.name}`,
    });
  }
  return true;
}

/**
 * TikTok Shop connecté : annonces à 0 à la pause, stock réel rétabli à la reprise (job `tiktok_shop.stock_state`,
 * jamais filtré par la pause ; l'état de la boutique est relu à l'exécution).
 */
async function queueTiktokStockState(tx: Tx, storeId: string) {
  const integ = await tx.integration.findUnique({ where: { storeId_kind: { storeId, kind: TIKTOK_SHOP_KIND } }, select: { status: true } });
  if (integ?.status === "active") await enqueue("tiktok_shop.stock_state", { storeId }, { storeId }, tx);
}

/** Lève la pause : statut précédent restauré (DRAFT à défaut). Idempotent. */
export async function resumeStore(tx: Tx, storeId: string): Promise<boolean> {
  const store = await tx.store.findUnique({ where: { id: storeId }, select: { status: true, statusBeforePause: true } });
  if (store?.status !== "PAUSED") return false;
  const restored: StoreStatus = store.statusBeforePause && PAUSABLE.includes(store.statusBeforePause) ? store.statusBeforePause : "DRAFT";
  const r = await tx.store.updateMany({ where: { id: storeId, status: "PAUSED" }, data: { status: restored, statusBeforePause: null, statusReason: null } });
  if (r.count === 0) return false;
  await audit({ storeId, action: "store.resumed_billing", metadata: { restored } }, tx);
  await enqueue("subscription.changed", { storeId, status: "RESUMED", restored }, { storeId }, tx);
  await queueTiktokStockState(tx, storeId);
  return true;
}

/**
 * Aligne l'état de la boutique sur l'abonnement (pause ou reprise). Idempotent, sûr à appeler partout
 * (cycle de vie, confirmation de paiement, affichage).
 */
export async function reconcileStorePause(tx: Tx, storeId: string, now = new Date()): Promise<"paused" | "resumed" | null> {
  // Verrou par boutique : un paiement confirmé et un passage du cron simultanés sont sérialisés, et l'abonnement
  // est relu APRÈS le verrou (jamais une pause décidée sur un état périmé).
  await lockKey(tx, `store-pause:${storeId}`);
  const sub = await tx.subscription.findUnique({ where: { storeId } });
  if (shouldPauseStore(sub, now)) {
    if (!sub) return null;
    return (await pauseStore(tx, sub, now)) ? "paused" : null;
  }
  if (sub) {
    if (sub.pausedAt) await tx.subscription.update({ where: { id: sub.id }, data: { pausedAt: null } });
  }
  return (await resumeStore(tx, storeId)) ? "resumed" : null;
}

/* ───────────────────────── Boutiques supplémentaires (couvertes) ───────────────────────── */

/** Recopie l'état de l'abonnement principal sur les boutiques qu'il couvre, puis aligne leur pause. */
export async function syncCoveredSubscriptions(parentId: string, tx: Tx, now = new Date()): Promise<number> {
  const children = await tx.subscription.findMany({ where: { coveredBySubscriptionId: parentId }, select: { id: true, storeId: true } });
  if (children.length === 0) return 0;
  const parent = await tx.subscription.findUnique({ where: { id: parentId } });
  const data = coverageMirror(parent, now);
  for (const c of children) {
    await tx.subscription.update({ where: { id: c.id }, data });
    await reconcileStorePause(tx, c.storeId, now);
  }
  return children.length;
}

/** Une boutique couverte relit son abonnement principal (cycle de vie, affichage). */
export async function syncCoveredSubscription(sub: Subscription, now = new Date()): Promise<void> {
  if (!sub.coveredBySubscriptionId) return;
  await db.$transaction(async (tx) => {
    const parent = await tx.subscription.findUnique({ where: { id: sub.coveredBySubscriptionId! } });
    await tx.subscription.update({ where: { id: sub.id }, data: coverageMirror(parent, now) });
    await reconcileStorePause(tx, sub.storeId, now);
  });
}

/* ───────────────────────── Migration de l'ancien plan Gratuit ───────────────────────── */

export const LEGACY_FREE_MIGRATED_ACTION = "subscription.free_plan_migrated";

export type LegacyFreePlan = { kind: "trial" } | { kind: "covered"; parentId: string };

/**
 * Décision de migration d'un abonnement Gratuit hérité : une boutique SECONDAIRE d'un compte dont une autre boutique
 * non archivée a un abonnement propre ouvrant droit (payé ou essai en cours) y est rattachée (coveredBySubscriptionId) ;
 * sinon, nouvel essai. Lecture seule (sert aussi au `--dry-run`).
 */
export async function planLegacyFreeMigration(sub: Pick<Subscription, "id" | "storeId">, client: Client = db, now = new Date()): Promise<LegacyFreePlan> {
  const owner = await client.membership.findFirst({ where: { storeId: sub.storeId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { userId: true } });
  if (!owner) return { kind: "trial" };
  const others = await client.subscription.findMany({
    where: { id: { not: sub.id }, coveredBySubscriptionId: null, store: { status: { not: "ARCHIVED" }, memberships: { some: { userId: owner.userId, role: "OWNER" } } } },
    include: { store: { select: { createdAt: true } } },
  });
  const parent = pickCoveringSubscription(others, now);
  return parent ? { kind: "covered", parentId: parent.id } : { kind: "trial" };
}

/**
 * Abonnement Gratuit hérité → rattachement à la boutique principale du compte (planLegacyFreeMigration), ou nouvel
 * essai TRIAL_PLAN de TRIAL_DAYS jours à compter de `now` (mise en production).
 * Idempotent : verrou + verrou optimiste sur (ACTIVE, FREE) + marqueur d'audit unique par abonnement.
 */
export async function migrateLegacyFreeSubscription(sub: Subscription, now = new Date()): Promise<"trial" | "covered" | null> {
  if (!isLegacyFreeSubscription(sub)) return null;
  return db.$transaction(async (tx) => {
    await lockKey(tx, `${LEGACY_FREE_MIGRATED_ACTION}:${sub.id}`);
    const already = await tx.auditLog.findFirst({ where: { action: LEGACY_FREE_MIGRATED_ACTION, target: sub.id }, select: { id: true } });
    const plan = already ? null : await planLegacyFreeMigration(sub, tx, now);
    const parent = plan?.kind === "covered" ? await tx.subscription.findUnique({ where: { id: plan.parentId } }) : null;
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
    // Déjà migré une fois (ne devrait pas arriver) : pas de second essai, la boutique passe en pause.
    const data = already
      ? { status: "PAUSED" as const, pausedAt: now, cancelAtPeriodEnd: false }
      : parent
        ? { ...coverageMirror(parent, now), coveredBySubscriptionId: parent.id }
        : { planId: TRIAL_PLAN, status: "TRIALING" as const, trialEndsAt, currentPeriodStart: now, currentPeriodEnd: trialEndsAt, cancelAtPeriodEnd: false, pausedAt: null };
    const r = await tx.subscription.updateMany({ where: { id: sub.id, planId: "FREE", status: "ACTIVE" }, data });
    if (r.count === 0) return null;
    if (already) {
      await reconcileStorePause(tx, sub.storeId, now);
      return null;
    }
    const kind = parent ? ("covered" as const) : ("trial" as const);
    await audit({ storeId: sub.storeId, action: LEGACY_FREE_MIGRATED_ACTION, target: sub.id, metadata: parent ? { kind, coveredBy: parent.id } : { kind, trialPlan: TRIAL_PLAN, trialEndsAt } }, tx);
    const key = `${LEGACY_FREE_MIGRATED_ACTION}:${sub.id}`;
    const href = `/app/${sub.storeId}/abonnement`;
    await notifyStore(
      sub.storeId,
      parent
        ? { kind: "invoice.due", title: "Boutique rattachée à l'abonnement de votre compte", text: `Le plan Gratuit disparaît. Cette boutique suit désormais l'abonnement de votre boutique principale (plan ${PLANS[parent.planId].name}).`, href, key }
        : { kind: "invoice.due", title: `Nouveau : ${TRIAL_DAYS} jours d'essai ${PLANS[TRIAL_PLAN].name} offerts`, text: `Le plan Gratuit disparaît. Profitez de toutes les fonctions ${PLANS[TRIAL_PLAN].name} jusqu'au ${formatDate(trialEndsAt)}, puis choisissez un plan pour garder votre boutique ouverte.`, href, key },
      tx,
    );
    await reconcileStorePause(tx, sub.storeId, now);
    await syncCoveredSubscriptions(sub.id, tx, now);
    return kind;
  });
}

/** Lot de migration (script `pnpm billing:migrate-free` et cycle de vie). */
export async function migrateLegacyFreeSubscriptions(now = new Date(), take = 500): Promise<{ scanned: number; migrated: number; trials: number; covered: number }> {
  const subs = await db.subscription.findMany({ where: { planId: "FREE", status: "ACTIVE", coveredBySubscriptionId: null }, take, orderBy: { createdAt: "asc" } });
  let trials = 0;
  let covered = 0;
  for (const s of subs) {
    try {
      const r = await migrateLegacyFreeSubscription(s, now);
      if (r === "trial") trials++;
      if (r === "covered") covered++;
    } catch (e) {
      console.error("[billing] migrate free", s.id, e);
    }
  }
  return { scanned: subs.length, migrated: trials + covered, trials, covered };
}
