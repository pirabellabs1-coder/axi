import { PLANS, PLAN_ORDER, planRank, type PlanId } from "@/config/plans";

/** Plafond technique, tous plans confondus (protection contre les abus). */
export const MAX_ZONES_HARD = 50;

/** Limite de zones de livraison du plan (null = illimité). */
export function zoneLimit(planId: PlanId): number | null {
  return PLANS[planId].limits.deliveryZones;
}

/** Premier plan supérieur qui offre plus de zones que le plan actuel. */
export function planForMoreZones(planId: PlanId): PlanId {
  const current = zoneLimit(planId);
  return (
    PLAN_ORDER.find((p) => {
      if (planRank(p) <= planRank(planId)) return false;
      const l = PLANS[p].limits.deliveryZones;
      return l == null || (current != null && l > current);
    }) ?? "ENTERPRISE"
  );
}

/** Message d'upsell factuel quand la limite de zones est atteinte. */
export function zoneLimitMessage(planId: PlanId, used: number): string {
  const limit = zoneLimit(planId) ?? 0;
  const target = PLANS[planForMoreZones(planId)];
  const unit = limit > 1 ? "zones" : "zone";
  return `Votre plan ${PLANS[planId].name} inclut ${limit} ${unit} de livraison (${used} configurée${used > 1 ? "s" : ""}). Passez au plan ${target.name} pour ajouter des zones sans limite.`;
}
