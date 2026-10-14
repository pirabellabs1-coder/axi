import { PLANS } from "@/config/plans";
import type { PlanId } from "@/config/plans";

/**
 * Contrôle de plan de la caisse, côté serveur (correctif mineur n° 8 de l'audit de la vague 3).
 *
 * Les actions marchandes (`src/lib/pos/actions.ts`) le vérifiaient déjà, mais les trois routes
 * `/api/pos/*` ne le faisaient pas : une boutique repassée en plan Gratuit continuait d'encaisser
 * depuis un appareil déjà associé, et de lire son catalogue, sans aucune limite de plan.
 *
 * La caisse s'appuie sur la LIMITE D'APPAREILS (`limits.posDevices`), pas sur le drapeau historique
 * `features.pos` réservé à Scale : le plan Business a droit à un appareil (cf. docs/vague3/OPS.md §6).
 * Module PUR (testé) : pas d'accès base, utilisable depuis une route comme depuis un test.
 */
export function posPlanAllowed(planId: PlanId): boolean {
  return PLANS[planId].limits.posDevices !== 0;
}

/** Message de refus, ou `null` si le plan autorise la caisse. */
export function posPlanGuard(planId: PlanId): string | null {
  if (posPlanAllowed(planId)) return null;
  return `La caisse en magasin est incluse à partir du plan Business (plan actuel : ${PLANS[planId].name}). Changez de plan depuis la page Abonnement.`;
}
