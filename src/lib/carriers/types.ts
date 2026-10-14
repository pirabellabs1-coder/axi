/**
 * Transporteurs (lot 3 §1.2).
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │  POINT D'INTÉGRATION LAISSÉ AU PORTEUR                                       │
 * │  `manual` (livreur interne ou transporteur sans API) est COMPLET et suffit à │
 * │  exploiter la fonctionnalité : étiquette interne, page livreur, code de       │
 * │  remise, suivi acheteur.                                                     │
 * │  `gozem`, `yango`, `dhl`, `laposte_bj` définissent le CONTRAT, la            │
 * │  construction des requêtes, le mapping des statuts et la vérification de     │
 * │  signature (tous testés) ; les appels HTTP réels attendent les comptes et la  │
 * │  documentation du fournisseur (comme les passerelles de paiement).           │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * Invariants :
 *  - aucun identifiant en clair en base (`CarrierAccount.credentialsEncrypted`, `encryptSecret`) ;
 *  - les statuts transporteurs sont ORDONNÉS côté application (`applyCarrierStatus`) : un événement
 *    tardif ne rétrograde jamais une expédition ;
 *  - webhooks signés (HMAC) et idempotents : `(shipmentId, providerEventId)` est unique en base ;
 *  - une indisponibilité du transporteur ne bloque jamais la vente : repli sur le transporteur manuel.
 */

import type { ShipmentStatusValue } from "@/lib/shipping/state";

export type CarrierId = "manual" | "gozem" | "yango" | "dhl" | "laposte_bj";

export const CARRIER_IDS: readonly CarrierId[] = ["manual", "gozem", "yango", "dhl", "laposte_bj"] as const;

export const CARRIER_LABELS: Record<CarrierId, string> = {
  manual: "Livreur interne / transporteur sans API",
  gozem: "Gozem",
  yango: "Yango Delivery",
  dhl: "DHL Express",
  laposte_bj: "La Poste du Bénin",
};

/** Transporteurs dont l'intégration API reste à brancher (le reste est complet et testé). */
export const CARRIERS_PENDING_INTEGRATION: readonly CarrierId[] = ["gozem", "yango", "dhl", "laposte_bj"] as const;

export function isCarrierId(value: string): value is CarrierId {
  return (CARRIER_IDS as readonly string[]).includes(value);
}

export type Address = {
  name: string;
  phone: string;
  address?: string | null;
  city?: string | null;
  country: string;
  note?: string | null;
};

export type ParcelInput = {
  weightGrams: number;
  /** Référence commerçant (référence de commande) reprise sur l'étiquette et le suivi. */
  reference: string;
  /** Valeur déclarée (XOF entier) pour l'assurance ou le paiement à la livraison. */
  declaredValue?: number;
  /** Montant à encaisser à la livraison (0 = déjà payé). */
  cashOnDelivery?: number;
  description?: string | null;
};

export type QuoteInput = { from: Address; to: Address; parcel: ParcelInput; service?: string | null };
export type Quote = { service: string; label: string; price: number; currency: string; etaLabel?: string | null };

export type CreateShipmentInput = QuoteInput & { callbackUrl?: string | null };
export type CreateShipmentResult = { providerRef: string; trackingNumber?: string | null; labelUrl?: string | null; cost?: number | null };

export type TrackingEvent = {
  status: ShipmentStatusValue;
  message?: string | null;
  locationLabel?: string | null;
  occurredAt: Date;
  /** Identifiant d'événement du fournisseur : clé d'idempotence `(shipmentId, providerEventId)`. */
  providerEventId?: string | null;
};

export type ParsedEvent = { providerRef: string; events: TrackingEvent[] };

export type CarrierCredentials = Record<string, string>;

/** Contrat d'un adaptateur transporteur (spec lot 3 §1.2). */
export type CarrierAdapter = {
  id: CarrierId;
  label: string;
  /** false : les appels réels ne sont pas encore branchés (le contrat et les mappings le sont). */
  implemented: boolean;
  /** Champs d'identifiants attendus dans le formulaire du commerçant. */
  credentialFields: readonly { key: string; label: string; secret?: boolean }[];
  quote?(input: QuoteInput, credentials: CarrierCredentials): Promise<Quote[]>;
  createShipment(input: CreateShipmentInput, credentials: CarrierCredentials): Promise<CreateShipmentResult>;
  cancel(providerRef: string, credentials: CarrierCredentials): Promise<void>;
  track(providerRef: string, credentials: CarrierCredentials): Promise<TrackingEvent[]>;
  /** Vérifie la signature du webhook et en extrait les événements ; `null` = rejet (401). */
  verifyWebhook?(raw: string, headers: Record<string, string>, credentials: CarrierCredentials): ParsedEvent | null;
  /** Lien de suivi public du transporteur, si le numéro de suivi en permet un. */
  trackingUrl?(trackingNumber: string): string | null;
};

/** Erreur d'un transporteur : message affichable au commerçant, jamais la réponse brute du fournisseur. */
export class CarrierError extends Error {
  constructor(
    message: string,
    public readonly code: "not_implemented" | "credentials" | "network" | "rejected" = "rejected",
  ) {
    super(message);
  }
}

export function notImplemented(carrier: CarrierId): CarrierError {
  return new CarrierError(
    `L'intégration API ${CARRIER_LABELS[carrier]} n'est pas encore activée sur cette installation. Créez l'expédition avec un transporteur « manuel » (étiquette interne) en attendant.`,
    "not_implemented",
  );
}
