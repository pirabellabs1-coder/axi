/**
 * Règles de plan de l'éditeur de thème (module pur, testé) :
 *  - modèles de départ : `PLANS[planId].limits.themes` (Gratuit = 2, voir `templateAllowance`) ;
 *  - historique des versions et restauration : fonction `advancedEditor` ;
 *  - nombre de versions conservées.
 */
import { PLANS, type PlanId } from "@/config/plans";
import { isTemplateAllowed, templateAllowance } from "./templates";

export const VERSIONS_KEPT_ADVANCED = 50;
export const VERSIONS_KEPT_BASIC = 5;

export type ThemePlanRules = {
  /** null = tous les modèles de départ. */
  presetLimit: number | null;
  allowedPresets: string[];
  versionHistory: boolean;
  versionsKept: number;
  removeBranding: boolean;
};

export function themePlanRules(planId: PlanId, sector: string | null | undefined, currentPreset: string): ThemePlanRules {
  const plan = PLANS[planId];
  const allowance = templateAllowance(planId, sector, currentPreset);
  return {
    presetLimit: allowance.limit,
    allowedPresets: allowance.allowed,
    versionHistory: plan.features.advancedEditor,
    versionsKept: plan.features.advancedEditor ? VERSIONS_KEPT_ADVANCED : VERSIONS_KEPT_BASIC,
    removeBranding: plan.features.removeBranding,
  };
}

export function canUsePreset(planId: PlanId, sector: string | null | undefined, currentPreset: string, presetId: string): boolean {
  return isTemplateAllowed(planId, sector, currentPreset, presetId);
}

export function canRestoreVersions(planId: PlanId): boolean {
  return PLANS[planId].features.advancedEditor;
}

export const PRESET_UPSELL = "Ce modèle n'est pas inclus dans le plan Gratuit (2 modèles de départ). Passez au plan Starter pour utiliser tous les modèles.";
export const VERSIONS_UPSELL = "L'historique des versions est inclus à partir du plan Business.";
