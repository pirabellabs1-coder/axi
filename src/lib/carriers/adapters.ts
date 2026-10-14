/**
 * Adaptateurs d'API transporteurs : Gozem, Yango Delivery, DHL Express, La Poste du Bénin.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │  POINT D'INTÉGRATION LAISSÉ AU PORTEUR                                       │
 * │  Ce qui est ICI et TESTÉ : le contrat, la construction de la requête          │
 * │  (`buildCreateShipmentRequest`), le mapping des statuts (`status-map.ts`) et  │
 * │  la vérification de signature des webhooks (`webhook.ts`).                   │
 * │  Ce qui MANQUE : l'appel HTTP réel (URL de production, format exact de        │
 * │  réponse), qui exige un compte et la documentation du transporteur.           │
 * │  Tant que `implemented = false`, l'interface propose le transporteur mais     │
 * │  l'action refuse clairement la création et invite au transporteur manuel.     │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */

import type { CarrierAdapter, CarrierCredentials, CarrierId, CreateShipmentInput, QuoteInput } from "./types";
import { notImplemented } from "./types";
import { parseCarrierPayload, verifySignature } from "./webhook";

/** Corps de requête commun (JSON) d'une demande d'expédition : pur, testé, indépendant du fournisseur. */
export function buildCreateShipmentRequest(input: CreateShipmentInput): Record<string, unknown> {
  return {
    reference: input.parcel.reference,
    service: input.service ?? null,
    sender: {
      name: input.from.name,
      phone: input.from.phone,
      address: input.from.address ?? null,
      city: input.from.city ?? null,
      country: input.from.country,
    },
    recipient: {
      name: input.to.name,
      phone: input.to.phone,
      address: input.to.address ?? null,
      city: input.to.city ?? null,
      country: input.to.country,
      note: input.to.note ?? null,
    },
    parcel: {
      weight_grams: Math.max(1, Math.round(input.parcel.weightGrams)),
      declared_value: input.parcel.declaredValue ?? 0,
      cash_on_delivery: input.parcel.cashOnDelivery ?? 0,
      description: input.parcel.description ?? null,
    },
    callback_url: input.callbackUrl ?? null,
  };
}

/** Requête de cotation (mêmes données, sans destinataire nominatif : seul le trajet compte). */
export function buildQuoteRequest(input: QuoteInput): Record<string, unknown> {
  return {
    from: { city: input.from.city ?? null, country: input.from.country },
    to: { city: input.to.city ?? null, country: input.to.country },
    weight_grams: Math.max(1, Math.round(input.parcel.weightGrams)),
    declared_value: input.parcel.declaredValue ?? 0,
  };
}

/**
 * Drapeau de configuration de l'anti-rejeu (mineur n° 7) : par défaut, un webhook SANS en-tête
 * d'horodatage est refusé. Ce champ ne doit être renseigné (`true`) que pour un transporteur qui n'en
 * envoie pas ; la protection repose alors uniquement sur le nonce (signature déjà vue, TTL 10 min).
 */
const TIMESTAMP_FIELD = { key: "allowMissingTimestamp", label: "Transporteur sans en-tête d'horodatage (« true », déconseillé)" } as const;

const FIELDS: Record<Exclude<CarrierId, "manual">, readonly { key: string; label: string; secret?: boolean }[]> = {
  gozem: [
    { key: "apiKey", label: "Clé d'API Gozem Business", secret: true },
    { key: "webhookSecret", label: "Secret des webhooks", secret: true },
    TIMESTAMP_FIELD,
  ],
  yango: [
    { key: "apiKey", label: "Jeton Yango Delivery", secret: true },
    { key: "webhookSecret", label: "Secret des webhooks", secret: true },
    TIMESTAMP_FIELD,
  ],
  dhl: [
    { key: "apiKey", label: "Clé d'API DHL", secret: true },
    { key: "apiSecret", label: "Secret d'API DHL", secret: true },
    { key: "accountNumber", label: "Numéro de compte DHL" },
    { key: "webhookSecret", label: "Secret des webhooks", secret: true },
    TIMESTAMP_FIELD,
  ],
  laposte_bj: [
    { key: "apiKey", label: "Identifiant La Poste du Bénin", secret: true },
    { key: "webhookSecret", label: "Secret des webhooks", secret: true },
    TIMESTAMP_FIELD,
  ],
};

const TRACKING_URL: Partial<Record<CarrierId, (n: string) => string>> = {
  dhl: (n) => `https://www.dhl.com/bj-fr/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  laposte_bj: (n) => `https://laposte.bj/suivi?code=${encodeURIComponent(n)}`,
};

function pendingAdapter(id: Exclude<CarrierId, "manual">, label: string): CarrierAdapter {
  return {
    id,
    label,
    implemented: false,
    credentialFields: FIELDS[id],
    async createShipment(): Promise<never> {
      throw notImplemented(id);
    },
    async cancel(): Promise<never> {
      throw notImplemented(id);
    },
    async track(): Promise<never> {
      throw notImplemented(id);
    },
    /**
     * La signature et le format d'événement SONT traités : un transporteur peut donc notifier Axi
     * dès que le porteur a renseigné le secret, même si la création d'expédition passe encore par
     * le mode manuel.
     */
    verifyWebhook(raw: string, headers: Record<string, string>, credentials: CarrierCredentials) {
      const check = verifySignature({
        secret: credentials.webhookSecret,
        raw,
        signature: headers["x-axi-signature"] ?? headers["x-signature"] ?? headers["signature"],
        timestamp: headers["x-axi-timestamp"] ?? headers["x-timestamp"] ?? null,
        // Drapeau de configuration par compte transporteur (mineur n° 7) : l'horodatage est EXIGÉ,
        // sauf pour un fournisseur qui n'en envoie pas — à cocher sciemment dans ses identifiants.
        allowMissingTimestamp: credentials.allowMissingTimestamp === "true",
      });
      if (!check.ok) return null;
      try {
        return parseCarrierPayload(id, JSON.parse(raw));
      } catch {
        return null;
      }
    },
    trackingUrl(trackingNumber: string) {
      return TRACKING_URL[id]?.(trackingNumber) ?? null;
    },
  };
}

export const gozemAdapter = pendingAdapter("gozem", "Gozem");
export const yangoAdapter = pendingAdapter("yango", "Yango Delivery");
export const dhlAdapter = pendingAdapter("dhl", "DHL Express");
export const laposteBjAdapter = pendingAdapter("laposte_bj", "La Poste du Bénin");
