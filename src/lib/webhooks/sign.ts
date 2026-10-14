import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signature des webhooks sortants (lot 2 §4.1), fonctions pures.
 *
 *   Axi-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + "." + corps))>[,v1=<ancien secret pendant une rotation>]
 *
 * La clé HMAC est la chaîne complète du secret (`whsec_…`, UTF-8), comme l'affiche l'interface. Le destinataire
 * recalcule la signature sur le corps BRUT reçu (pas sur un JSON re-sérialisé) et refuse un horodatage hors
 * tolérance (5 min par défaut) pour bloquer le rejeu.
 */

export const SECRET_PREFIX = "whsec_";
export const SIGNATURE_TOLERANCE_SEC = 300;
const SECRET_RE = /^whsec_[A-Za-z0-9_-]{43}$/;

/** Nouveau secret : `whsec_` + 32 octets aléatoires en base64url (43 caractères). */
export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isWebhookSecret(v: unknown): v is string {
  return typeof v === "string" && SECRET_RE.test(v);
}

/** Préfixe affichable (identification sans divulgation) : « whsec_AbCd… ». */
export function secretDisplayPrefix(secret: string): string {
  return secret.slice(0, SECRET_PREFIX.length + 4);
}

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** En-tête complet ; un `v1` par secret actif (le nouveau d'abord pendant une rotation). */
export function signatureHeader(secrets: readonly string[], timestamp: number, body: string): string {
  if (!secrets.length) throw new Error("Aucun secret de signature");
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${computeSignature(s, timestamp, body)}`)].join(",");
}

export function parseSignatureHeader(header: string | null | undefined): { timestamp: number; signatures: string[] } | null {
  if (!header || header.length > 2000) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) signatures.push(v);
  }
  return timestamp == null || !signatures.length ? null : { timestamp, signatures };
}

function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export type VerifyResult = { ok: true } | { ok: false; reason: "malformed" | "timestamp_out_of_tolerance" | "no_matching_signature" };

/**
 * Vérification côté destinataire (référence publiée dans docs/API-REST.md) : au moins un `v1` correspond à l'un
 * des secrets connus, et |maintenant - t| ≤ tolérance. Comparaison en temps constant.
 */
export function verifySignature(
  header: string | null | undefined,
  body: string,
  secrets: readonly string[],
  opts: { toleranceSec?: number; nowSec?: number } = {},
): VerifyResult {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > (opts.toleranceSec ?? SIGNATURE_TOLERANCE_SEC)) return { ok: false, reason: "timestamp_out_of_tolerance" };
  for (const secret of secrets) {
    const expected = computeSignature(secret, parsed.timestamp, body);
    if (parsed.signatures.some((s) => hexEqual(s, expected))) return { ok: true };
  }
  return { ok: false, reason: "no_matching_signature" };
}
