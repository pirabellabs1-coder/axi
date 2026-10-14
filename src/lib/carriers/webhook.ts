/**
 * Vérification des webhooks transporteurs (lot 3 §1.2 et §6) — module PUR (testé).
 * Signature HMAC-SHA256 du corps BRUT, comparaison à temps constant, horodatage obligatoire pour
 * écarter les rejeux anciens. Les événements sont ensuite idempotents en base par
 * `(shipmentId, providerEventId)`.
 *
 * Mineur n° 12 : un transporteur qui n'envoie aucun identifiant d'événement rendait cette idempotence
 * INOPÉRANTE (`providerEventId` NULL : Postgres ne dédoublonne pas les NULL, et le contrôle applicatif
 * était sauté). On dérive donc une empreinte DÉTERMINISTE du contenu de l'événement
 * (`deterministicEventId`) : un même événement renvoyé deux fois porte la même clé.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CarrierId } from "./types";
import { mapCarrierStatus } from "./status-map";
import type { ParsedEvent, TrackingEvent } from "./types";

/** Tolérance d'horodatage : un événement signé plus vieux est refusé (anti-rejeu). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function signWebhook(secret: string, raw: string, timestamp?: string): string {
  return createHmac("sha256", secret).update(timestamp ? `${timestamp}.${raw}` : raw).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type SignatureCheck = { ok: true } | { ok: false; error: "missing_secret" | "missing_signature" | "missing_timestamp" | "bad_signature" | "stale" };

/**
 * Valide la signature d'un webhook : en-tête `signature` (hex) et en-tête `timestamp` (secondes epoch)
 * dans la fenêtre de tolérance.
 *
 * Correctif mineur n° 7 : l'horodatage était OPTIONNEL (`if (p.timestamp)`). Un transporteur — ou
 * quiconque ayant intercepté une requête signée — pouvait donc rejouer indéfiniment un corps signé sans
 * horodatage et faire avancer des expéditions à volonté. L'horodatage est désormais EXIGÉ par défaut ;
 * `allowMissingTimestamp` est un drapeau de configuration par compte transporteur, réservé aux
 * fournisseurs qui n'en envoient pas (la protection anti-rejeu repose alors sur le NONCE côté route).
 */
export function verifySignature(p: {
  secret: string | null | undefined;
  raw: string;
  signature: string | null | undefined;
  timestamp?: string | null;
  now?: Date;
  /** Drapeau de configuration : accepter un webhook SANS en-tête d'horodatage (déconseillé). */
  allowMissingTimestamp?: boolean;
}): SignatureCheck {
  if (!p.secret) return { ok: false, error: "missing_secret" };
  const signature = (p.signature ?? "").trim().replace(/^sha256=/i, "");
  if (!signature) return { ok: false, error: "missing_signature" };
  if (!p.timestamp && !p.allowMissingTimestamp) return { ok: false, error: "missing_timestamp" };
  if (p.timestamp) {
    const ts = Number(p.timestamp);
    const now = (p.now ?? new Date()).getTime() / 1000;
    if (!Number.isFinite(ts) || Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, error: "stale" };
  }
  const expected = signWebhook(p.secret, p.raw, p.timestamp ?? undefined);
  return constantTimeEqual(signature, expected) ? { ok: true } : { ok: false, error: "bad_signature" };
}

/** Durée de mémorisation d'une signature déjà vue (anti-rejeu, mineur n° 7). */
export const WEBHOOK_NONCE_TTL_SECONDS = 10 * 60;

/**
 * Clé de nonce d'un webhook : transporteur + signature reçue. Deux requêtes identiques partagent la
 * même signature : la seconde est donc un rejeu, qu'elle arrive dans la fenêtre d'horodatage ou non.
 * Fonction PURE (testée) ; la mémorisation elle-même utilise la table `RateLimit` (TTL natif).
 */
export function webhookNonceKey(carrier: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim().replace(/^sha256=/i, "").toLowerCase().slice(0, 128);
  return `carrier:nonce:${carrier}:${sig}`;
}

/**
 * Empreinte déterministe d'un événement sans identifiant fournisseur : même transporteur, même
 * référence, même statut, même date et même libellé ⇒ même clé, donc un seul `ShipmentEvent`.
 * Le préfixe `fp:` distingue ces clés dérivées des identifiants réellement fournis.
 */
export function deterministicEventId(
  carrier: string,
  providerRef: string,
  e: { status: string; message?: string | null; locationLabel?: string | null; occurredAt: Date },
): string {
  const parts = [carrier, providerRef, e.status, e.occurredAt.toISOString(), e.message ?? "", e.locationLabel ?? ""];
  return `fp:${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32)}`;
}

type RawEvent = { status?: unknown; state?: unknown; code?: unknown; event_id?: unknown; id?: unknown; message?: unknown; description?: unknown; location?: unknown; occurred_at?: unknown; timestamp?: unknown; date?: unknown };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseDate(v: unknown): Date {
  const s = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  return s && !Number.isNaN(s.getTime()) ? s : new Date();
}

/**
 * Charge utile commune des transporteurs : `{ tracking_number | shipment_id | reference, events: [...] }`.
 * Les codes inconnus sont écartés (aucune transition hasardeuse). Fonction pure.
 */
export function parseCarrierPayload(carrier: CarrierId, body: unknown): ParsedEvent | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const providerRef = asString(obj.provider_ref) ?? asString(obj.shipment_id) ?? asString(obj.tracking_number) ?? asString(obj.reference);
  if (!providerRef) return null;
  const rawEvents: RawEvent[] = Array.isArray(obj.events) ? (obj.events as RawEvent[]) : [obj as RawEvent];
  const events: TrackingEvent[] = [];
  for (const e of rawEvents) {
    const code = asString(e.status) ?? asString(e.state) ?? asString(e.code);
    const status = code ? mapCarrierStatus(carrier, code) : null;
    if (!status) continue;
    events.push({
      status,
      message: asString(e.message) ?? asString(e.description),
      locationLabel: asString(e.location),
      occurredAt: parseDate(e.occurred_at ?? e.timestamp ?? e.date),
      providerEventId:
        asString(e.event_id) ??
        asString(e.id) ??
        deterministicEventId(carrier, providerRef, { status, message: asString(e.message) ?? asString(e.description), occurredAt: parseDate(e.occurred_at ?? e.timestamp ?? e.date), locationLabel: asString(e.location) }),
    });
  }
  return events.length ? { providerRef, events } : null;
}
