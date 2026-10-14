/**
 * Indicateurs de l'administration plateforme : fonctions pures (testées dans tests/admin-metrics.test.ts).
 * Les requêtes vivent dans les pages ; ici, uniquement le calcul.
 *
 * Conventions monétaires (src/lib/money.ts) : EUR en centimes, XOF en unités entières.
 * Aucune conversion de change : le « MRR consolidé » valorise chaque abonnement au tarif de la
 * zone Monde (euros) via planPrice(..., "WORLD"), ce qui donne une base comparable entre zones.
 */
import { ADD_ONS, PLAN_ORDER, planPrice, type AddOnBilling, type Interval, type PlanId, type PricingZone } from "@/config/plans";

export type SubLike = { planId: PlanId; interval: Interval; zone: string; status: string };

export type MrrBreakdown = {
  /** Tous les abonnements payants valorisés au tarif Monde, en centimes d'euro. */
  consolidatedEur: number;
  /** Abonnements facturés en zone Monde (EUR, centimes). */
  eur: number;
  /** Abonnements facturés en zone Afrique (FCFA). */
  xof: number;
  /** Nombre d'abonnements payants actifs. */
  paying: number;
  byPlan: Record<PlanId, { count: number; consolidatedEur: number }>;
};

export function normalizeZone(zone: string | null | undefined): PricingZone {
  return zone === "AFRICA" ? "AFRICA" : "WORLD";
}

/** Un abonnement compte dans le MRR s'il est ACTIVE sur un plan payant au prix connu (Enterprise sur devis exclu si sans prix). */
export function isPaying(s: Pick<SubLike, "planId" | "status">): boolean {
  return s.status === "ACTIVE" && s.planId !== "FREE";
}

export function mrrBreakdown(subs: SubLike[]): MrrBreakdown {
  const byPlan = Object.fromEntries(PLAN_ORDER.map((p) => [p, { count: 0, consolidatedEur: 0 }])) as MrrBreakdown["byPlan"];
  const out: MrrBreakdown = { consolidatedEur: 0, eur: 0, xof: 0, paying: 0, byPlan };
  for (const s of subs) {
    if (!isPaying(s)) continue;
    const world = planPrice(s.planId, "WORLD", s.interval).perMonth ?? 0;
    const zone = normalizeZone(s.zone);
    const native = planPrice(s.planId, zone, s.interval).perMonth ?? 0;
    out.paying += 1;
    out.consolidatedEur += world;
    if (zone === "AFRICA") out.xof += native;
    else out.eur += native;
    byPlan[s.planId].count += 1;
    byPlan[s.planId].consolidatedEur += world;
  }
  return out;
}

/** Montant mensuel récurrent d'une option (MONTHLY tel quel, YEARLY / 12 arrondi, ponctuel et packs = 0). */
export function addOnMonthlyAmount(billing: AddOnBilling, price: number): number {
  if (billing === "MONTHLY") return price;
  if (billing === "YEARLY") return Math.round(price / 12);
  return 0;
}

/** MRR des options actives, en centimes d'euro (tarif Monde) pour comparer les zones. */
export function addOnMrrEur(purchases: { addOnId: string; quantity: number }[]): number {
  let sum = 0;
  for (const p of purchases) {
    const a = ADD_ONS.find((x) => x.id === p.addOnId);
    if (!a) continue;
    sum += addOnMonthlyAmount(a.billing, a.price.WORLD) * p.quantity;
  }
  return sum;
}

/** Somme par devise (jamais de conversion implicite). */
export function sumByCurrency(rows: { amount: number; currency: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.currency] = (out[r.currency] ?? 0) + r.amount;
  return out;
}

/** Taux de conversion en % (une décimale), null sans base. */
export function conversionRate(converted: number, eligible: number): number | null {
  if (eligible <= 0) return null;
  return Math.round((Math.min(converted, eligible) / eligible) * 1000) / 10;
}

/** Solde d'un portefeuille à partir de sommes de deltas non expirés, jamais négatif. */
export function walletBalance(sumOfLiveDeltas: number | null | undefined): number {
  return Math.max(0, sumOfLiveDeltas ?? 0);
}

/** Part (0-100) d'une valeur dans le maximum d'une série : largeur des barres horizontales. */
export function barWidth(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

/* ───────────────────────── Séries temporelles de la vue d'ensemble ───────────────────────── */

const DAY_MS = 86_400_000;

/** Débuts de mois (UTC) des `n` derniers mois, du plus ancien au mois courant. */
export function monthStarts(n: number, now = new Date()): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)));
}

/** Débuts de semaine (lundi 00:00 UTC) des `n` dernières semaines, de la plus ancienne à la courante. */
export function weekStarts(n: number, now = new Date()): Date[] {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  return Array.from({ length: n }, (_, i) => new Date(monday.getTime() - (n - 1 - i) * 7 * DAY_MS));
}

/** Débuts de jour (UTC) des `n` derniers jours, du plus ancien à aujourd'hui. */
export function dayStarts(n: number, now = new Date()): Date[] {
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(d - (n - 1 - i) * DAY_MS));
}

/** Compte les dates par intervalle [starts[i], starts[i+1]) ; la dernière case court jusqu'à `end`. */
export function bucketCounts(dates: (Date | null | undefined)[], starts: Date[], end: Date = new Date(8.64e15)): number[] {
  const out = starts.map(() => 0);
  for (const d of dates) {
    if (!d) continue;
    const t = d.getTime();
    if (t < starts[0].getTime() || t >= end.getTime()) continue;
    let i = starts.length - 1;
    while (i > 0 && t < starts[i].getTime()) i--;
    out[i] += 1;
  }
  return out;
}

export type PaidPlanInvoice = { storeId?: string; amount: number; currency: string; periodStart: Date; periodEnd: Date };

/** Nombre de mois couverts par une facture (1 pour mensuel, 12 pour annuel), au moins 1. */
export function invoiceMonths(periodStart: Date, periodEnd: Date): number {
  return Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / (30.44 * DAY_MS)));
}

function covers(inv: { periodStart: Date; periodEnd: Date }, at: Date): boolean {
  return inv.periodStart.getTime() <= at.getTime() && inv.periodEnd.getTime() > at.getTime();
}

/**
 * MRR mensuel reconstruit depuis les factures d'abonnement PAYÉES : pour chaque mois, somme des
 * factures dont la période couvre la fin du mois (ou maintenant pour le mois courant), ramenées
 * au mois. Une série par devise (jamais de conversion de change).
 */
export function mrrSeriesFromInvoices(invoices: PaidPlanInvoice[], months: Date[], now = new Date()): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  months.forEach((m, i) => {
    const next = i + 1 < months.length ? months[i + 1] : new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    const sample = new Date(Math.min(next.getTime() - 1, now.getTime()));
    for (const inv of invoices) {
      if (!covers(inv, sample)) continue;
      (out[inv.currency] ??= months.map(() => 0))[i] += Math.round(inv.amount / invoiceMonths(inv.periodStart, inv.periodEnd));
    }
  });
  return out;
}

/** Boutiques couvertes par une facture d'abonnement payée à un instant donné. */
export function payingStoresAt(invoices: PaidPlanInvoice[], at: Date): Set<string> {
  const s = new Set<string>();
  for (const inv of invoices) if (inv.storeId && inv.amount > 0 && covers(inv, at)) s.add(inv.storeId);
  return s;
}

/** Churn : part des boutiques payantes au début de la période qui ne le sont plus maintenant. */
export function churn(start: Set<string>, now: Set<string>): { base: number; lost: number; rate: number | null } {
  let lost = 0;
  for (const id of start) if (!now.has(id)) lost++;
  return { base: start.size, lost, rate: start.size ? Math.round((lost / start.size) * 1000) / 10 : null };
}

/** Revenu moyen par compte payant (même unité que le MRR), null sans compte payant. */
export function arpa(mrr: number, paying: number): number | null {
  return paying > 0 ? Math.round(mrr / paying) : null;
}

export type FunnelStep = { key: string; label: string; count: number; fromPrevious: number | null; fromFirst: number | null };

/** Entonnoir d'activation : taux depuis l'étape précédente et depuis la première (en %, une décimale). */
export function funnel(steps: { key: string; label: string; count: number }[]): FunnelStep[] {
  const first = steps[0]?.count ?? 0;
  return steps.map((s, i) => {
    const prev = i > 0 ? steps[i - 1].count : null;
    return {
      ...s,
      fromPrevious: prev == null ? null : prev > 0 ? Math.round((Math.min(s.count, prev) / prev) * 1000) / 10 : null,
      fromFirst: i === 0 ? null : first > 0 ? Math.round((Math.min(s.count, first) / first) * 1000) / 10 : null,
    };
  });
}
