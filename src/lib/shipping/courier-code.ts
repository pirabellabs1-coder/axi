/**
 * Preuve de remise anti-fraude (lot 3 §1.2) — module PUR (tests/courier-code.test.ts).
 *
 * L'acheteur reçoit un code à 4 chiffres (WhatsApp ou page de suivi) ; le livreur le saisit sur
 * `/livraison/[shipmentToken]` pour marquer « Livré ». 5 essais au maximum, puis blocage et alerte.
 * La base ne stocke que l'empreinte du code (`Shipment.deliveryCodeHash`, HMAC APP_SECRET).
 * Données personnelles minimisées : le téléphone du destinataire est partiellement masqué, le numéro
 * complet n'est révélé que par un bouton « Appeler » journalisé.
 */

export const DELIVERY_CODE_LENGTH = 4;
export const MAX_DELIVERY_CODE_ATTEMPTS = 5;
/** Durée de validité du jeton de la page livreur. */
export const COURIER_TOKEN_DAYS = 7;

/** Saisie du livreur normalisée : chiffres uniquement, longueur attendue. */
export function normalizeDeliveryCode(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === DELIVERY_CODE_LENGTH ? digits : null;
}

export type CodeCheck =
  | { ok: true; attempts: number }
  | { ok: false; reason: "format" | "mismatch" | "blocked" | "unset"; attempts: number; remaining: number };

/**
 * Vérifie un code de remise : `fingerprint` est l'empreinte calculée par l'appelant (HMAC) de la saisie.
 * `attempts` est le nombre d'essais DÉJÀ effectués. Fonction pure et déterministe.
 */
export function checkDeliveryCode(p: { input: string; fingerprint: string | null; expected: string | null; attempts: number }): CodeCheck {
  const attempts = Math.max(0, Math.trunc(p.attempts));
  if (attempts >= MAX_DELIVERY_CODE_ATTEMPTS) return { ok: false, reason: "blocked", attempts, remaining: 0 };
  if (!p.expected) return { ok: false, reason: "unset", attempts, remaining: MAX_DELIVERY_CODE_ATTEMPTS - attempts };
  if (!normalizeDeliveryCode(p.input)) return { ok: false, reason: "format", attempts, remaining: MAX_DELIVERY_CODE_ATTEMPTS - attempts };
  if (!p.fingerprint || p.fingerprint !== p.expected) {
    const next = attempts + 1;
    return { ok: false, reason: "mismatch", attempts: next, remaining: Math.max(0, MAX_DELIVERY_CODE_ATTEMPTS - next) };
  }
  return { ok: true, attempts };
}

/** Le jeton de la page livreur est-il encore valable ? */
export function isCourierTokenValid(expiresAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return !Number.isNaN(exp.getTime()) && exp.getTime() > now.getTime();
}

export function courierTokenExpiry(createdAt: Date = new Date(), days = COURIER_TOKEN_DAYS): Date {
  return new Date(createdAt.getTime() + days * 24 * 3600 * 1000);
}

/** Téléphone partiellement masqué : 2 premiers et 2 derniers chiffres (ex. « 97 •• •• 45 »). */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 6) return digits ? "•".repeat(digits.length) : "—";
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  return `${head} ${"•".repeat(Math.min(6, digits.length - 4))} ${tail}`;
}

/** Prénom seul (étiquette et page livreur : données personnelles minimisées). */
export function firstNameOnly(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "Client";
}
