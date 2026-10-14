/**
 * Correspondance des statuts transporteurs → statuts Axi (lot 3 §1.2) — module PUR (testé).
 * Un statut inconnu renvoie `null` : l'événement est journalisé mais ne change pas l'expédition
 * (jamais de régression silencieuse, jamais de « livré » déduit à tort).
 */

import type { ShipmentStatusValue } from "@/lib/shipping/state";
import type { CarrierId } from "./types";

type Map_ = Record<string, ShipmentStatusValue>;

/** Vocabulaire commun (minuscules, séparateurs normalisés) partagé par la plupart des transporteurs. */
const COMMON: Map_ = {
  created: "LABEL_CREATED",
  label_created: "LABEL_CREATED",
  pending: "PENDING",
  accepted: "LABEL_CREATED",
  assigned: "LABEL_CREATED",
  picked_up: "PICKED_UP",
  pickup: "PICKED_UP",
  collected: "PICKED_UP",
  in_transit: "IN_TRANSIT",
  transit: "IN_TRANSIT",
  arrived: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivering: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  completed: "DELIVERED",
  failed: "FAILED_ATTEMPT",
  failed_attempt: "FAILED_ATTEMPT",
  attempt_failed: "FAILED_ATTEMPT",
  returned: "RETURNED",
  return_to_sender: "RETURNED",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
};

/** Codes propres à chaque transporteur, en plus du vocabulaire commun. */
const BY_CARRIER: Record<CarrierId, Map_> = {
  manual: {},
  gozem: { courier_assigned: "LABEL_CREATED", courier_arrived: "OUT_FOR_DELIVERY", dropped_off: "DELIVERED", client_absent: "FAILED_ATTEMPT" },
  yango: { performer_found: "LABEL_CREATED", pickup_arrived: "PICKED_UP", delivery_arrived: "OUT_FOR_DELIVERY", finished: "DELIVERED", returning: "RETURNED", return_arrived: "RETURNED" },
  // Codes DHL (ShipmentTracking) : PU = picked up, PL/DF = en transit, WC = en livraison, OK = livré, RT = retour.
  dhl: { pu: "PICKED_UP", pl: "IN_TRANSIT", df: "IN_TRANSIT", af: "IN_TRANSIT", wc: "OUT_FOR_DELIVERY", ok: "DELIVERED", rt: "RETURNED", cm: "FAILED_ATTEMPT" },
  laposte_bj: { depose: "PICKED_UP", en_cours: "IN_TRANSIT", en_distribution: "OUT_FOR_DELIVERY", distribue: "DELIVERED", avise: "FAILED_ATTEMPT", retour_expediteur: "RETURNED" },
};

/** Normalise un code fournisseur : minuscules, espaces et tirets en « _ ». */
export function normalizeCarrierCode(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Statut Axi correspondant, ou `null` si le code est inconnu de ce transporteur. */
export function mapCarrierStatus(carrier: CarrierId, raw: string): ShipmentStatusValue | null {
  const code = normalizeCarrierCode(raw);
  if (!code) return null;
  return BY_CARRIER[carrier]?.[code] ?? COMMON[code] ?? null;
}
