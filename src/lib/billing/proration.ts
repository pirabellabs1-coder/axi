import { PLAN_ORDER, type Interval, type PlanId } from "@/config/plans";
import { addMonths } from "@/lib/utils";

/** Règles pures de facturation (testées dans tests/billing.test.ts). */

export function periodEndFor(start: Date, interval: Interval): Date {
  return addMonths(start, interval === "YEARLY" ? 12 : 1);
}

/** Rang de changement : >0 montée, <0 descente, 0 identique. L'annuel est « au-dessus » du mensuel. */
export function changeDirection(from: { planId: PlanId; interval: Interval }, to: { planId: PlanId; interval: Interval }): number {
  const r = PLAN_ORDER.indexOf(to.planId) - PLAN_ORDER.indexOf(from.planId);
  if (r !== 0) return r;
  if (from.interval === to.interval) return 0;
  return to.interval === "YEARLY" ? 1 : -1;
}

/**
 * Crédit de prorata : part non consommée du montant payé pour la période en cours.
 * Calcul en unités entières : floor(paid × restant / total).
 */
export function prorationCredit(paidAmount: number, periodStart: Date, periodEnd: Date, now = new Date()): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  const remaining = Math.max(0, periodEnd.getTime() - now.getTime());
  if (total <= 0 || paidAmount <= 0 || remaining <= 0) return 0;
  return Math.floor((paidAmount * Math.min(remaining, total)) / total);
}

