/**
 * Machine d'états des expéditions (lot 3 §1.2) — module PUR (tests/shipment-state.test.ts).
 *
 *   PENDING → LABEL_CREATED → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
 *                  │              │            │              └─► FAILED_ATTEMPT ─► OUT_FOR_DELIVERY | RETURNED
 *   PENDING | LABEL_CREATED ─► CANCELLED
 *
 * `canTransitionShipment` est la source de vérité. Les statuts transporteurs sont ORDONNÉS : un
 * événement tardif (réseau, webhook rejoué) ne rétrograde jamais une expédition (`applyCarrierStatus`),
 * exactement comme les statuts de paiement.
 */

export type ShipmentStatusValue =
  | "PENDING"
  | "LABEL_CREATED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "FAILED_ATTEMPT"
  | "RETURNED"
  | "CANCELLED";

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatusValue, string> = {
  PENDING: "À préparer",
  LABEL_CREATED: "Étiquette créée",
  PICKED_UP: "Récupéré",
  IN_TRANSIT: "En transit",
  OUT_FOR_DELIVERY: "En cours de livraison",
  DELIVERED: "Livré",
  FAILED_ATTEMPT: "Tentative échouée",
  RETURNED: "Retourné",
  CANCELLED: "Annulé",
};

/** Progression : un événement d'un rang strictement inférieur au statut courant est ignoré. */
export const SHIPMENT_RANK: Record<ShipmentStatusValue, number> = {
  PENDING: 0,
  LABEL_CREATED: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
  OUT_FOR_DELIVERY: 4,
  FAILED_ATTEMPT: 4,
  DELIVERED: 6,
  RETURNED: 6,
  CANCELLED: 6,
};

export const TERMINAL_SHIPMENT_STATUSES: readonly ShipmentStatusValue[] = ["DELIVERED", "RETURNED", "CANCELLED"] as const;

export function isTerminalShipmentStatus(status: ShipmentStatusValue): boolean {
  return TERMINAL_SHIPMENT_STATUSES.includes(status);
}

const TRANSITIONS: Record<ShipmentStatusValue, readonly ShipmentStatusValue[]> = {
  PENDING: ["LABEL_CREATED", "PICKED_UP", "CANCELLED"],
  LABEL_CREATED: ["PICKED_UP", "IN_TRANSIT", "FAILED_ATTEMPT", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT"],
  IN_TRANSIT: ["OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED_ATTEMPT"],
  FAILED_ATTEMPT: ["OUT_FOR_DELIVERY", "RETURNED"],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

export function canTransitionShipment(from: ShipmentStatusValue, to: ShipmentStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextShipmentStatuses(from: ShipmentStatusValue): readonly ShipmentStatusValue[] {
  return TRANSITIONS[from];
}

/**
 * Statut à retenir pour un événement transporteur : `null` si l'événement doit être ignoré
 * (expédition dans un état terminal, statut identique, rang inférieur, ou transition interdite).
 * Un saut d'étape vers l'avant (ex. LABEL_CREATED → DELIVERED) est accepté : les transporteurs
 * n'émettent pas toujours les étapes intermédiaires.
 */
export function applyCarrierStatus(current: ShipmentStatusValue, incoming: ShipmentStatusValue): ShipmentStatusValue | null {
  if (isTerminalShipmentStatus(current)) return null;
  if (incoming === current) return null;
  if (incoming === "CANCELLED") return canTransitionShipment(current, "CANCELLED") ? "CANCELLED" : null;
  if (SHIPMENT_RANK[incoming] < SHIPMENT_RANK[current]) return null;
  // Rangs égaux (OUT_FOR_DELIVERY ↔ FAILED_ATTEMPT) : seule une transition déclarée est permise.
  if (SHIPMENT_RANK[incoming] === SHIPMENT_RANK[current]) return canTransitionShipment(current, incoming) ? incoming : null;
  return incoming;
}

/* ───────────────────────── Avancement de la commande ───────────────────────── */

export type FulfillmentStatusValue = "UNFULFILLED" | "PARTIAL" | "FULFILLED";

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatusValue, string> = {
  UNFULFILLED: "Non expédiée",
  PARTIAL: "Partiellement expédiée",
  FULFILLED: "Expédiée",
};

export type ShipmentQuantity = { orderItemId: string; quantity: number; status: ShipmentStatusValue };

/**
 * Quantités expédiées par ligne (les expéditions ANNULÉES ne comptent pas : leurs unités redeviennent
 * expédiables).
 */
export function shippedByItem(shipmentItems: readonly ShipmentQuantity[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shipmentItems) {
    if (s.status === "CANCELLED") continue;
    out.set(s.orderItemId, (out.get(s.orderItemId) ?? 0) + s.quantity);
  }
  return out;
}

/** Quantité encore expédiable d'une ligne (jamais négative). */
export function remainingToShip(ordered: number, shipped: number): number {
  return Math.max(0, ordered - shipped);
}

/** Avancement global d'une commande : UNFULFILLED, PARTIAL ou FULFILLED. */
export function fulfillmentStatusOf(
  items: readonly { orderItemId: string; quantity: number }[],
  shipmentItems: readonly ShipmentQuantity[],
): FulfillmentStatusValue {
  const shipped = shippedByItem(shipmentItems);
  let total = 0;
  let done = 0;
  for (const i of items) {
    total += i.quantity;
    done += Math.min(i.quantity, shipped.get(i.orderItemId) ?? 0);
  }
  if (done <= 0) return "UNFULFILLED";
  return done >= total ? "FULFILLED" : "PARTIAL";
}

/**
 * Statut de commande induit par les expéditions (lot 3 §1.2) :
 *  - toutes les expéditions livrées (au moins une, hors annulées) → DELIVERED (fidélité, avis…) ;
 *  - au moins une en cours de livraison → OUT_FOR_DELIVERY ;
 *  - sinon, aucun changement.
 */
export function orderStatusFromShipments(statuses: readonly ShipmentStatusValue[]): "DELIVERED" | "OUT_FOR_DELIVERY" | null {
  const live = statuses.filter((s) => s !== "CANCELLED");
  if (!live.length) return null;
  if (live.every((s) => s === "DELIVERED")) return "DELIVERED";
  if (live.some((s) => s === "OUT_FOR_DELIVERY")) return "OUT_FOR_DELIVERY";
  return null;
}
