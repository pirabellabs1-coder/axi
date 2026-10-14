import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Double authentification TOTP (RFC 6238, au-dessus de HOTP RFC 4226), sans dépendance :
 * HMAC via node:crypto, secret encodé en base32 (RFC 4648) pour les applications
 * d'authentification (Google Authenticator, 1Password, Aegis…).
 *
 * Module pur (aucun accès base, aucun cookie) : testé dans tests/mfa.test.ts.
 * La persistance (secret chiffré, codes de secours, jeton de connexion en attente) vit dans
 * src/lib/admin/mfa-server.ts.
 */

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Clé base32 invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) : troncature dynamique d'un HMAC du compteur 64 bits big-endian. */
export function hotp(key: Buffer, counter: number | bigint, digits = 6, algorithm: TotpAlgorithm = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const TOTP_STEP = 30;

export function totpCounter(timeMs: number, step = TOTP_STEP): number {
  return Math.floor(timeMs / 1000 / step);
}

/** TOTP (RFC 6238) pour un instant donné. */
export function totp(key: Buffer, timeMs: number, opts: { step?: number; digits?: number; algorithm?: TotpAlgorithm } = {}): string {
  return hotp(key, totpCounter(timeMs, opts.step), opts.digits ?? 6, opts.algorithm ?? "sha1");
}

function constantEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Vérifie un code TOTP avec une tolérance de ±`window` pas (décalage d'horloge du téléphone).
 * Renvoie le compteur accepté (à mémoriser pour refuser un rejeu) ou null.
 * `afterCounter` : dernier compteur déjà utilisé ; tout compteur ≤ est refusé (anti-rejeu).
 */
export function verifyTotp(key: Buffer, code: string, timeMs: number, opts: { window?: number; afterCounter?: number | null } = {}): number | null {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return null;
  const now = totpCounter(timeMs);
  const window = opts.window ?? 1;
  let matched: number | null = null;
  // Toutes les fenêtres sont évaluées (temps constant vis-à-vis de la position du code).
  for (let c = now - window; c <= now + window; c++) {
    if (c < 0) continue;
    if (constantEq(hotp(key, c), clean) && matched === null) matched = c;
  }
  if (matched === null) return null;
  if (opts.afterCounter != null && matched <= opts.afterCounter) return null;
  return matched;
}

/** Nouveau secret aléatoire de 160 bits (taille recommandée pour HMAC-SHA1). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Clé lisible : groupes de 4 caractères (saisie manuelle). */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/** URI de provisionnement (Key Uri Format) lue par les applications d'authentification. */
export function otpauthUri({ secret, account, issuer }: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_STEP) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ───────────────────────── Codes de secours ───────────────────────── */

const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // sans 0/o, 1/l/i

/** Codes de secours à usage unique, format « xxxx-xxxx ». */
export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Empreinte stockée d'un code de secours (jamais le code en clair). */
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(`axi-backup:${normalizeBackupCode(code)}`).digest("hex");
}

/** Consomme un code de secours : renvoie la liste restante, ou null si le code est inconnu. */
export function consumeBackupCode(hashes: string[], code: string): string[] | null {
  const h = hashBackupCode(code);
  let found = -1;
  hashes.forEach((x, i) => {
    if (found === -1 && constantEq(x, h)) found = i;
  });
  if (found === -1) return null;
  return hashes.filter((_, i) => i !== found);
}

/* ───────────────────────── Jeton de connexion en attente ───────────────────────── */

/**
 * Après un mot de passe correct, un compte à double authentification reçoit un jeton signé court
 * (HMAC-SHA256, 5 minutes) au lieu d'une session. La session n'est créée qu'après le code TOTP.
 */
export type MfaPending = { uid: string; exp: number; next?: string };

export function signMfaPending(payload: MfaPending, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`mfa.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyMfaPending(token: string | undefined | null, secret: string, nowMs = Date.now()): MfaPending | null {
  if (!token || token.length > 1024) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(`mfa.${body}`).digest("base64url");
  if (!constantEq(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MfaPending;
    if (typeof p.uid !== "string" || typeof p.exp !== "number" || p.exp < nowMs) return null;
    return p;
  } catch {
    return null;
  }
}
