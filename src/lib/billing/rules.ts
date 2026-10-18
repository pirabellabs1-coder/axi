import { PAST_DUE_GRACE_DAYS, PLAN_ORDER, zoneForCurrency, type Interval, type PlanId, type PricingZone } from "@/config/plans";
import { periodEndFor } from "./proration";

/**
 * Règles PURES de facturation (sans base de données), partagées par les actions, le cycle de vie,
 * les crédits et les tests (tests/billing-rules.test.ts). Règles V4 :
 *  - essai de 14 jours de Business sans paiement : seul accès payant sans facture réglée ;
 *  - montée en gamme : facture OPEN, l'ancien plan est conservé, le nouveau plan démarre à la
 *    confirmation du paiement (confirmInvoicePayment) ;
 *  - descente : en fin de période ;
 *  - impayé : grâce de PAST_DUE_GRACE_DAYS jours depuis `invoice.dueAt`, puis boutique en pause ;
 *  - plus de plan Gratuit : sans plan ouvrant droit (fin d'essai, résiliation échue, impayé), la boutique
 *    est EN PAUSE (shouldPauseStore) ; « FREE » n'est plus que le niveau interne « sans plan » ;
 *  - données jamais supprimées.
 */

export const DAY_MS = 86_400_000;

type SubState = { planId: string; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null };

export function planRankOf(planId: string): number {
  return PLAN_ORDER.indexOf(planId as PlanId);
}

/** Essai en cours (le seul cas légitime d'accès payant sans facture payée). */
export function isTrialActive(sub: Pick<SubState, "status" | "trialEndsAt"> | null, now = new Date()): boolean {
  return !!sub && sub.status === "TRIALING" && !!sub.trialEndsAt && sub.trialEndsAt > now;
}

/**
 * Plan effectif (fonctions accessibles). `currentPeriodEnd` n'est posé sur un plan payant que par
 * la confirmation d'un paiement : un plan payant sans période réglée n'est jamais accordé.
 */
export function effectivePlanId(sub: SubState | null, now = new Date()): PlanId {
  if (!sub) return "FREE";
  if (sub.status === "TRIALING") return isTrialActive(sub, now) ? (sub.planId as PlanId) : "FREE";
  if (sub.status === "ACTIVE" || sub.status === "PAST_DUE") {
    if (sub.planId === "FREE" || !sub.currentPeriodEnd) return "FREE";
    if (now.getTime() > sub.currentPeriodEnd.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS) return "FREE";
    return sub.planId as PlanId;
  }
  return "FREE";
}

/* ───────────────────────── Pause (plus de plan Gratuit) ───────────────────────── */

type PauseSub = SubState & { coveredBySubscriptionId?: string | null };

/**
 * Abonnement hérité de l'ancien plan Gratuit (ACTIVE + FREE, non couvert) : il reçoit un nouvel essai
 * (migrateLegacyFreeSubscription) au lieu d'une mise en pause immédiate.
 */
export function isLegacyFreeSubscription(sub: Pick<PauseSub, "planId" | "status" | "coveredBySubscriptionId"> | null): boolean {
  return !!sub && sub.planId === "FREE" && sub.status === "ACTIVE" && !sub.coveredBySubscriptionId;
}

/**
 * La boutique doit-elle être EN PAUSE ? Oui dès qu'aucun plan n'ouvre droit : essai terminé sans plan payant,
 * résiliation arrivée à échéance, impayé au-delà de la grâce, abonnement absent. Un abonnement Gratuit hérité
 * n'est pas mis en pause (il est d'abord migré vers un essai).
 */
export function shouldPauseStore(sub: PauseSub | null, now = new Date()): boolean {
  if (isLegacyFreeSubscription(sub)) return false;
  return effectivePlanId(sub, now) === "FREE";
}

export type PauseReason = "trial_ended" | "cancelled" | "unpaid" | "no_plan";

/** Motif lisible de la pause (bandeau marchand, e-mail). */
export function pauseReasonOf(sub: Pick<SubState, "status" | "trialEndsAt"> | null): PauseReason {
  if (!sub) return "no_plan";
  if (sub.status === "SUSPENDED" || sub.status === "PAST_DUE") return "unpaid";
  if (sub.trialEndsAt) return "trial_ended";
  if (sub.status === "PAUSED") return "cancelled";
  return "no_plan";
}

/** Rappels avant la fin de l'essai, en jours (J-3 puis J-1). */
export const TRIAL_REMINDER_DAYS = [3, 1] as const;
export type TrialReminderStage = (typeof TRIAL_REMINDER_DAYS)[number];

/**
 * Rappel de fin d'essai dû maintenant : le plus proche seuil atteint (un cron manqué à J-3 n'envoie que J-1).
 * L'unicité est garantie par une clé (abonnement, date de fin d'essai, seuil), voir src/lib/billing/pause.ts.
 */
export function trialReminderStage(sub: Pick<SubState, "status" | "trialEndsAt"> | null, now = new Date()): TrialReminderStage | null {
  if (!sub || !isTrialActive(sub, now)) return null;
  const left = sub.trialEndsAt!.getTime() - now.getTime();
  for (const d of [...TRIAL_REMINDER_DAYS].sort((a, b) => a - b)) if (left <= d * DAY_MS) return d;
  return null;
}

/**
 * Boutique supplémentaire (option EXTRA_STORE) : état recopié de l'abonnement de la boutique principale
 * (plan, statut, période, essai, zone). Aucune facture propre : la place est payée par l'option.
 */
export function coverageMirror(parent: SubState & { interval: string; currentPeriodStart: Date; zone: string; currency: string; pausedAt: Date | null } | null, now = new Date()) {
  if (!parent) return { planId: "FREE" as PlanId, status: "PAUSED" as const, trialEndsAt: null, currentPeriodEnd: null, pausedAt: now, cancelAtPeriodEnd: false };
  return {
    planId: parent.planId as PlanId,
    status: parent.status as "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | "PAUSED",
    interval: parent.interval as Interval,
    trialEndsAt: parent.trialEndsAt,
    currentPeriodStart: parent.currentPeriodStart,
    currentPeriodEnd: parent.currentPeriodEnd,
    zone: parent.zone,
    currency: parent.currency,
    pausedAt: parent.pausedAt,
    cancelAtPeriodEnd: false,
  };
}

/**
 * Abonnement qui couvrira une boutique secondaire (migration du Gratuit) : parmi les autres boutiques non archivées
 * du propriétaire, celles dont l'abonnement ouvre droit (payé ou essai en cours) ; meilleur plan, puis la plus ancienne.
 */
export function pickCoveringSubscription<T extends SubState & { store: { createdAt: Date } }>(candidates: T[], now = new Date()): T | null {
  const live = candidates.filter((c) => effectivePlanId(c, now) !== "FREE");
  live.sort((a, b) => planRankOf(effectivePlanId(b, now)) - planRankOf(effectivePlanId(a, now)) || a.store.createdAt.getTime() - b.store.createdAt.getTime());
  return live[0] ?? null;
}

/** Fin de la grâce d'une facture impayée : calculée depuis son échéance (`dueAt`). */
export function graceEndsAt(invoice: { dueAt: Date }): Date {
  return new Date(invoice.dueAt.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
}

/**
 * Zone tarifaire : celle FIGÉE sur l'abonnement (source de vérité, modifiable uniquement par
 * l'admin via setPricingZone). La devise de la boutique ne sert qu'à initialiser un abonnement absent.
 */
export function billingZone(sub: { zone: string | null } | null | undefined, storeCurrency: string): PricingZone {
  if (sub?.zone === "AFRICA" || sub?.zone === "WORLD") return sub.zone;
  return zoneForCurrency(storeCurrency);
}

export type PaidInvoice = { planId: string; periodStart: Date; periodEnd: Date };

/**
 * Crédits inclus du mois : plan ouvrant droit, ou null.
 * - essai en cours : plan d'essai ;
 * - sinon une facture d'abonnement PAYÉE doit couvrir `now`, et l'abonnement doit être effectif :
 *   on retient le plus bas des deux (jamais plus que ce qui a été payé).
 */
export function monthlyCreditsPlan(sub: SubState | null, paidCovering: PaidInvoice | null, now = new Date()): PlanId | null {
  if (!sub) return null;
  if (isTrialActive(sub, now)) return sub.planId === "FREE" ? null : (sub.planId as PlanId);
  const effective = effectivePlanId(sub, now);
  if (effective === "FREE") return null;
  if (!paidCovering || paidCovering.periodStart > now || paidCovering.periodEnd <= now) return null;
  const paid = paidCovering.planId as PlanId;
  if (paid === "FREE") return null;
  return planRankOf(paid) < planRankOf(effective) ? paid : effective;
}

export type PlanInvoiceForPayment = { planId: string; periodStart: Date; periodEnd: Date };

export type PlanPaymentDecision = {
  /** Période retenue (une montée réglée en retard démarre au paiement : aucun jour perdu). */
  periodStart: Date;
  periodEnd: Date;
  interval: Interval;
  /** La facture couvre une période future (renouvellement anticipé) : bascule à l'échéance. */
  future: boolean;
  /** Mise à jour de l'abonnement. */
  data: {
    status: "ACTIVE" | "PAST_DUE" | "SUSPENDED";
    trialEndsAt: null;
    pausedAt?: null;
    planId?: PlanId;
    interval?: Interval;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  };
  /** Plan inférieur appliqué : produits au-delà de la limite à passer en brouillon. */
  appliedLower: boolean;
};

export function invoiceInterval(inv: { periodStart: Date; periodEnd: Date }): Interval {
  return inv.periodEnd.getTime() - inv.periodStart.getTime() > 200 * DAY_MS ? "YEARLY" : "MONTHLY";
}

/**
 * Effet d'une facture d'abonnement payée sur l'abonnement (chemin unique : confirmInvoicePayment).
 * - `isChange` : facture émise par un changement de plan (montée / démarrage). Le plan est appliqué
 *   au paiement, sur une période qui démarre au paiement si la facture est réglée en retard.
 * - Renouvellement : prolonge la période ; une facture future ne bascule qu'à l'échéance.
 * - `isLatest` : une vieille facture réglée en retard n'écrase jamais un plan plus récent.
 * - `stillOverdue` : une autre facture d'abonnement reste impayée et échue → statut conservé.
 */
export function planPaymentDecision(params: {
  sub: { planId: string; status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean };
  invoice: PlanInvoiceForPayment;
  now: Date;
  isChange: boolean;
  isLatest: boolean;
  stillOverdue: boolean;
}): PlanPaymentDecision {
  const { sub, invoice, now, isChange, isLatest, stillOverdue } = params;
  const interval = invoiceInterval(invoice);
  const keepStatus = stillOverdue && (sub.status === "PAST_DUE" || sub.status === "SUSPENDED");
  const status = (keepStatus ? sub.status : "ACTIVE") as "ACTIVE" | "PAST_DUE" | "SUSPENDED";

  if (isChange) {
    const late = invoice.periodStart.getTime() < now.getTime() - 60_000;
    const periodStart = late ? now : invoice.periodStart;
    const periodEnd = late ? periodEndFor(now, interval) : invoice.periodEnd;
    return {
      periodStart,
      periodEnd,
      interval,
      future: false,
      appliedLower: false,
      data: { status, trialEndsAt: null, ...(status === "ACTIVE" ? { pausedAt: null } : {}), planId: invoice.planId as PlanId, interval, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
    };
  }

  const future = invoice.periodStart.getTime() > now.getTime() + 60_000;
  const extendsPeriod = !sub.currentPeriodEnd || invoice.periodEnd > sub.currentPeriodEnd;
  const appliedLower = !future && isLatest && planRankOf(invoice.planId) < planRankOf(sub.planId);
  return {
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    interval,
    future,
    appliedLower,
    data: {
      status,
      trialEndsAt: null,
      ...(status === "ACTIVE" ? { pausedAt: null } : {}),
      ...(appliedLower ? { cancelAtPeriodEnd: false } : {}),
      ...(!future && isLatest ? { planId: invoice.planId as PlanId, interval } : {}),
      ...(!future && extendsPeriod ? { currentPeriodEnd: invoice.periodEnd, currentPeriodStart: invoice.periodStart } : {}),
    },
  };
}

/**
 * Effet d'un statut fournisseur sur une tentative de paiement (ventes) :
 * - `apply` : transition normale ;
 * - `ignore` : événement en retard ou rejoué ;
 * - `duplicate` : second encaissement (autre référence fournisseur, ou commande déjà payée par une
 *   autre tentative) → à signaler au marchand pour remboursement, jamais silencieux.
 */
export type AttemptStatus = "CREATED" | "PENDING" | "INITIATED" | "CONFIRMED" | "FAILED" | "EXPIRED";
const RANK: Record<AttemptStatus, number> = { CREATED: 0, PENDING: 1, INITIATED: 2, CONFIRMED: 4, FAILED: 3, EXPIRED: 3 };

export function gatewayStatusOutcome(
  attempt: { status: AttemptStatus; providerRef: string | null },
  orderPaymentStatus: string,
  incoming: { status: "CONFIRMED" | "FAILED" | "PENDING" | "EXPIRED"; providerRef?: string | null },
): "apply" | "ignore" | "duplicate" {
  if (attempt.status === "CONFIRMED") {
    if (incoming.status === "CONFIRMED" && incoming.providerRef && attempt.providerRef && incoming.providerRef !== attempt.providerRef) return "duplicate";
    return "ignore";
  }
  if (incoming.status === "CONFIRMED" && orderPaymentStatus === "PAID") return "duplicate";
  if (RANK[incoming.status] < RANK[attempt.status]) return "ignore";
  return "apply";
}

/** Un CONFIRMED n'est recevable qu'avec un montant et une devise vérifiables (m12). */
export function confirmationHasAmount(v: { status: string; amount?: number | null; currency?: string | null }): boolean {
  if (v.status !== "CONFIRMED") return true;
  return typeof v.amount === "number" && Number.isFinite(v.amount) && !!v.currency;
}
