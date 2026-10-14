/**
 * VAPID (RFC 8292) : identification du serveur d'application auprès du service de push,
 * écrit avec `node:crypto` uniquement (aucune dépendance).
 *
 * En-tête produit : `Authorization: vapid t=<JWT ES256>, k=<clé publique base64url>`.
 * Le JWT porte `aud` (origine du point de terminaison), `exp` (≤ 24 h) et `sub` (`mailto:` ou `https:`).
 *
 * Clés de plateforme : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url, P-256 brut : 65 et 32 octets).
 * Génération : `generateVapidKeys()` (voir `docs/vague3/CAN-lot4d.md`).
 */
import { createECDH, createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { b64urlDecode, b64urlEncode } from "./encrypt";

export type VapidKeys = { publicKey: string; privateKey: string };

/** Nouvelle paire VAPID (P-256) en base64url : à mettre dans les variables d'environnement. */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(randomBytes(32));
  return { publicKey: b64urlEncode(ecdh.getPublicKey()), privateKey: b64urlEncode(ecdh.getPrivateKey()) };
}

/** Clé publique non compressée correspondant à une clé privée brute. */
export function publicKeyFromPrivate(privateKeyB64: string): string {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(b64urlDecode(privateKeyB64));
  return b64urlEncode(ecdh.getPublicKey());
}

function jwkFromRaw(publicRaw: Buffer, privateRaw?: Buffer) {
  if (publicRaw.length !== 65 || publicRaw[0] !== 0x04) throw new Error("Clé publique VAPID invalide (65 octets non compressés attendus)");
  const jwk: Record<string, string> = { kty: "EC", crv: "P-256", x: b64urlEncode(publicRaw.subarray(1, 33)), y: b64urlEncode(publicRaw.subarray(33, 65)) };
  if (privateRaw) {
    if (privateRaw.length !== 32) throw new Error("Clé privée VAPID invalide (32 octets attendus)");
    jwk.d = b64urlEncode(privateRaw);
  }
  return jwk;
}

/** Origine (`scheme://host`) du point de terminaison : valeur de la revendication `aud`. */
export function audienceOf(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("Point de terminaison push non https");
  return url.origin;
}

/** `sub` acceptable (RFC 8292 §2.1) : contact du responsable du service. */
export function normalizeSubject(subject: string): string {
  const s = subject.trim();
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/i.test(s)) throw new Error("Sujet VAPID invalide (mailto: ou https: attendu)");
  return s;
}

export type JwtInput = { audience: string; subject: string; expiresAt: number };

/** JWT ES256 signé (RFC 7515, signature brute R‖S de 64 octets, `dsaEncoding: ieee-p1363`). */
export function signVapidJwt(input: JwtInput, keys: VapidKeys): string {
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8"));
  const body = b64urlEncode(Buffer.from(JSON.stringify({ aud: input.audience, exp: input.expiresAt, sub: normalizeSubject(input.subject) }), "utf8"));
  const signingInput = Buffer.from(`${header}.${body}`, "utf8");
  const key = createPrivateKey({ key: jwkFromRaw(b64urlDecode(keys.publicKey), b64urlDecode(keys.privateKey)), format: "jwk" });
  const signature = cryptoSign("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${b64urlEncode(signature)}`;
}

/** Vérifie un JWT VAPID avec la clé publique annoncée (tests, diagnostic). */
export function verifyVapidJwt(token: string, publicKeyB64: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const key = createPublicKey({ key: jwkFromRaw(b64urlDecode(publicKeyB64)), format: "jwk" });
    return cryptoVerify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"), { key, dsaEncoding: "ieee-p1363" }, b64urlDecode(parts[2]));
  } catch {
    return false;
  }
}

/** Charge utile décodée d'un JWT (sans vérification de signature). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(b64urlDecode(token.split(".")[1] ?? "").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const VAPID_MAX_TTL_SEC = 23 * 3600; // < 24 h (RFC 8292 §2) ; marge d'horloge d'une heure.

/** En-têtes d'autorisation VAPID pour un point de terminaison donné. */
export function vapidHeaders(endpoint: string, keys: VapidKeys, opts: { subject: string; now?: Date; ttlSec?: number }): { Authorization: string } {
  const now = opts.now ?? new Date();
  const ttl = Math.min(Math.max(opts.ttlSec ?? VAPID_MAX_TTL_SEC, 60), VAPID_MAX_TTL_SEC);
  const token = signVapidJwt({ audience: audienceOf(endpoint), subject: opts.subject, expiresAt: Math.floor(now.getTime() / 1000) + ttl }, keys);
  return { Authorization: `vapid t=${token}, k=${keys.publicKey}` };
}

/** Clés de la plateforme (variables d'environnement), ou `null` si le push n'est pas configuré. */
export function platformVapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  try {
    if (publicKeyFromPrivate(privateKey) !== publicKey) {
      console.error("[push] VAPID_PUBLIC_KEY ne correspond pas à VAPID_PRIVATE_KEY");
      return null;
    }
  } catch {
    console.error("[push] clés VAPID illisibles (base64url P-256 attendu)");
    return null;
  }
  return { publicKey, privateKey };
}

/** Contact déclaré au service de push (`sub`), par défaut l'adresse de support de la plateforme. */
export function platformSubject(): string {
  const raw = process.env.VAPID_SUBJECT?.trim();
  try {
    return raw ? normalizeSubject(raw) : "mailto:contact@pirabellabs.com";
  } catch {
    return "mailto:contact@pirabellabs.com";
  }
}
