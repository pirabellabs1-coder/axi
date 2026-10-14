/**
 * Facturation des apps (phase D) — module PUR (importable côté client et dans les tests, aucun `server-only`).
 *
 * Modèle de facturation réutilisant les champs EXISTANTS d'AppInstallation (pas de changement de schéma) :
 *   - priceAmount   : montant unitaire snapshoté à l'installation (XOF, entier).
 *   - billingStatus : none | trialing | active | past_due | cancelled.
 *   - trialEndsAt   : fin de l'essai gratuit (si billingStatus = trialing).
 *
 * Aucun provider de paiement réel ici : la capture d'argent réutilisera la facturation plateforme
 * existante plus tard. Ce module ne fait que modéliser les statuts, l'essai et le reporting développeur.
 */
import type { AppPricingType } from "@prisma/client";

export type BillingStatus = "none" | "trialing" | "active" | "past_due" | "cancelled";

const DAY_MS = 86_400_000;

/* ───────────────────────── Install : état de facturation initial ───────────────────────── */

export type BillingAppInput = {
  pricingType: AppPricingType;
  priceAmount: number;
  priceInterval?: string | null;
  trialDays: number;
};

export type InitialBilling = { priceAmount: number; billingStatus: BillingStatus; trialEndsAt: Date | null };

/**
 * État de facturation à la création d'une installation :
 *   - FREE (ou montant nul)         → { 0, "none", null }
 *   - SUBSCRIPTION avec trialDays>0 → "trialing", trialEndsAt = now + trialDays
 *   - SUBSCRIPTION sans essai        → "active"
 *   - ONE_TIME                       → "active" (paiement unique, pas de renouvellement)
 */
export function initialBillingForInstall(app: BillingAppInput, now = new Date()): InitialBilling {
  if (app.pricingType === "FREE" || app.priceAmount <= 0) {
    return { priceAmount: 0, billingStatus: "none", trialEndsAt: null };
  }
  if (app.pricingType === "ONE_TIME") {
    return { priceAmount: app.priceAmount, billingStatus: "active", trialEndsAt: null };
  }
  // SUBSCRIPTION
  if (app.trialDays > 0) {
    return { priceAmount: app.priceAmount, billingStatus: "trialing", trialEndsAt: new Date(now.getTime() + app.trialDays * DAY_MS) };
  }
  return { priceAmount: app.priceAmount, billingStatus: "active", trialEndsAt: null };
}

/* ───────────────────────── Cycle de vie : transition de statut ───────────────────────── */

export type BillingInstallInput = { billingStatus: string | null; trialEndsAt: Date | null };

/**
 * Statut suivant d'une installation, ou `null` si aucune transition n'est due.
 * Seule transition automatique sans provider : trialing → active quand l'essai est échu.
 *
 * TODO(provider) : la vérification de paiement réelle s'enficherait ici — active → past_due si une
 * échéance de renouvellement n'est pas honorée, puis past_due → cancelled après la période de grâce.
 * Tant que la capture est gérée par la facturation plateforme (hors périmètre), aucun past_due auto.
 */
export function nextBillingTransition(installation: BillingInstallInput, now = new Date()): BillingStatus | null {
  if (installation.billingStatus === "trialing" && installation.trialEndsAt && installation.trialEndsAt <= now) {
    return "active";
  }
  return null;
}

/* ───────────────────────── Reporting : revenus développeur ───────────────────────── */

export type EarningsInstall = {
  billingStatus: string | null;
  priceAmount: number;
  pricingType: AppPricingType;
  priceInterval?: string | null;
};

export type DeveloperEarnings = {
  activePaidInstalls: number;
  grossMonthly: number;
  feeMonthly: number;
  netMonthly: number;
};

/**
 * Revenu mensuel récurrent (MRR) d'un ensemble d'installations, net de la commission plateforme.
 *
 * Choix documentés :
 *   - Seules les installations SUBSCRIPTION au statut "active" et payantes (priceAmount>0) comptent :
 *     un essai (trialing) ne génère pas encore de revenu, un abonnement annulé non plus.
 *   - Un abonnement annuel est normalisé au mois (priceAmount / 12, arrondi entier XOF).
 *   - Les paiements ONE_TIME ne sont PAS récurrents : exclus du MRR (ils seraient reportés à part).
 *   - Montants entiers (XOF sans décimales) : la commission est arrondie à l'entier le plus proche.
 */
export function computeDeveloperEarnings(installs: readonly EarningsInstall[], feePct: number): DeveloperEarnings {
  let activePaidInstalls = 0;
  let grossMonthly = 0;
  for (const i of installs) {
    if (i.billingStatus !== "active" || i.priceAmount <= 0 || i.pricingType !== "SUBSCRIPTION") continue;
    activePaidInstalls++;
    grossMonthly += i.priceInterval === "year" ? Math.round(i.priceAmount / 12) : i.priceAmount;
  }
  const pct = Math.min(100, Math.max(0, feePct));
  const feeMonthly = Math.round((grossMonthly * pct) / 100);
  const netMonthly = grossMonthly - feeMonthly;
  return { activePaidInstalls, grossMonthly, feeMonthly, netMonthly };
}

/* ───────────────────────── Affichage FR ───────────────────────── */

/** Libellé français d'un statut de facturation d'app. */
export function formatBillingStatus(status: string | null | undefined): string {
  switch (status) {
    case "trialing":
      return "Essai gratuit";
    case "active":
      return "Actif";
    case "past_due":
      return "Impayé";
    case "cancelled":
      return "Annulé";
    default:
      return "—";
  }
}
