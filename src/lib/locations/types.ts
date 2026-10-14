/**
 * Dépôts : types et libellés PARTAGÉS serveur/client (lot 3 §1.1).
 * Module pur, sans accès base : il peut être importé par un composant client (l'interface des dépôts).
 * Les requêtes et les règles vivent dans ./service.ts (`server-only`).
 */

import { PLANS, type PlanId } from "@/config/plans";

export const DEFAULT_LOCATION_NAME = "Dépôt principal";
/** Garde-fou technique, au-delà de la limite de plan. */
export const MAX_LOCATIONS_HARD = 100;

export type LocationType = "WAREHOUSE" | "STORE" | "PICKUP_POINT";

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  WAREHOUSE: "Entrepôt",
  STORE: "Magasin",
  PICKUP_POINT: "Point de retrait",
};

export type LocationRow = {
  id: string;
  name: string;
  type: LocationType;
  city: string | null;
  isDefault: boolean;
  active: boolean;
  fulfillsOnlineOrders: boolean;
  pickupEnabled: boolean;
  position: number;
};

/** Nombre de dépôts permis par le plan (null = illimité). */
export function locationLimit(planId: PlanId): number | null {
  return PLANS[planId].limits.locations;
}

export function locationLimitMessage(planId: PlanId): string {
  const limit = locationLimit(planId);
  return `Votre plan ${PLANS[planId].name} permet ${limit} dépôt${(limit ?? 0) > 1 ? "s" : ""}. Passez à un plan supérieur depuis la page Abonnement pour en ajouter.`;
}
