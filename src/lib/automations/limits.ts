import { PLANS, type PlanFeatures, type PlanId } from "@/config/plans";
import type { AutomationTrigger } from "./templates";

/** Nombre maximal d'automatisations ACTIVES du plan (null = illimité, 0 = fonctionnalité absente). */
export function activeAutomationLimit(planId: PlanId): number | null {
  if (!PLANS[planId].features.automations) return 0;
  return PLANS[planId].limits.automations;
}

/** Déclencheurs soumis à une fonctionnalité de plan dédiée. */
export const TRIGGER_FEATURE: Partial<Record<AutomationTrigger, keyof PlanFeatures>> = {
  "cart.abandoned": "abandonedCart",
};

export function triggerAllowed(planId: PlanId, trigger: AutomationTrigger): boolean {
  const feature = TRIGGER_FEATURE[trigger];
  return !feature || PLANS[planId].features[feature];
}

export function automationLimitMessage(planId: PlanId, used: number, limit: number): string {
  return `Votre plan ${PLANS[planId].name} permet ${limit} automatisation${limit > 1 ? "s" : ""} active${limit > 1 ? "s" : ""} (${used} sur ${limit}). Désactivez-en une ou passez au plan Scale pour des automatisations illimitées.`;
}
