import { formatMoney } from "@/lib/money";
import { priceForInterval } from "@/lib/pricing/rules";
import { planPrice, type Interval, type PlanId, type PricingZone } from "@/config/plans";

/**
 * Prix affiché sur le site vitrine : `formatMoney` sans les décimales inutiles
 * (« 29 € » plutôt que « 29,00 € », mais « 24,17 € » reste précis).
 */
export function formatPrice(amount: number, currency: string): string {
  return formatMoney(amount, currency).replace(/,00(?=\s*€)/, "");
}

export type DisplayPrice =
  | { kind: "free"; label: string }
  | { kind: "quote"; label: string }
  | { kind: "paid"; perMonth: string; billed: string | null };

/** Prix d'un plan prêt à afficher, pour une zone et une période. */
export function displayPlanPrice(planId: PlanId, zone: PricingZone, interval: Interval, monthly?: number | null): DisplayPrice {
  // `monthly` : prix mensuel effectif (surcharge admin) calculé côté serveur ; sinon prix du catalogue.
  const p = monthly === undefined ? planPrice(planId, zone, interval) : priceForInterval(monthly, zone, interval);
  if (p.amount == null || p.perMonth == null) return { kind: "quote", label: "Sur devis" };
  if (p.amount === 0) return { kind: "free", label: formatPrice(0, p.currency) };
  return {
    kind: "paid",
    perMonth: formatPrice(p.perMonth, p.currency),
    billed: interval === "YEARLY" ? `${formatPrice(p.amount, p.currency)} facturés par an` : null,
  };
}
