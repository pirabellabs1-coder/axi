/**
 * Transporteur « manual » (lot 3 §1.2) : livreur interne ou transporteur sans API.
 * COMPLET et autonome : aucun appel réseau, le numéro de suivi est la référence interne de
 * l'expédition, l'étiquette est l'étiquette A6 imprimable d'Axi (`/app/.../etiquette`) et le suivi
 * avance par la page livreur ou par le commerçant.
 */

import type { CarrierAdapter, CreateShipmentInput, CreateShipmentResult, TrackingEvent } from "./types";

/** Numéro de suivi interne : lisible au téléphone, sans caractère ambigu. */
export function manualTrackingNumber(reference: string, random: string): string {
  return `${reference.replace(/[^A-Z0-9-]/gi, "").toUpperCase()}-${random.slice(0, 4).toUpperCase()}`;
}

export const manualAdapter: CarrierAdapter = {
  id: "manual",
  label: "Livreur interne / transporteur sans API",
  implemented: true,
  credentialFields: [],
  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    // Aucun fournisseur : la référence de l'expédition fait foi (providerRef = référence commerçant).
    return { providerRef: input.parcel.reference, trackingNumber: null, labelUrl: null, cost: null };
  },
  async cancel(): Promise<void> {
    // Rien à annuler côté fournisseur.
  },
  async track(): Promise<TrackingEvent[]> {
    // Le suivi d'un transporteur manuel vient de la page livreur et du commerçant (ShipmentEvent).
    return [];
  },
};
