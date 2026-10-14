import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Codes de cartes cadeaux (spécification lot 1, §3 « Code »).
 *  - 16 caractères de l'alphabet Crockford base32 sans I, L, O, U (5 bits par caractère, 80 bits) ;
 *  - affichage `XXXX-XXXX-XXXX-XXXX` ; saisie normalisée (majuscules, sans espaces ni tirets, O→0, I/L→1) ;
 *  - recherche par `codeHash = HMAC-SHA256(clé, "${storeId}:${code}")` en hex, avec
 *    clé = HMAC-SHA256(APP_SECRET, "giftcard") (contrat partagé avec prisma/seed.ts : ne pas modifier).
 * Le `storeId` dans le HMAC rend une carte de la boutique A inutilisable sur la boutique B.
 *
 * Module sans `server-only` pour être testable ; il dépend de node:crypto et ne doit pas être importé
 * par un composant client.
 */

export const GIFT_CARD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const GIFT_CARD_CODE_LENGTH = 16;

const VALID = new RegExp(`^[${GIFT_CARD_ALPHABET}]{${GIFT_CARD_CODE_LENGTH}}$`);

/** Nouveau code aléatoire (CSPRNG). 256 est un multiple de 32 : `octet & 31` est uniforme. */
export function generateGiftCardCode(): string {
  const bytes = randomBytes(GIFT_CARD_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < GIFT_CARD_CODE_LENGTH; i++) out += GIFT_CARD_ALPHABET[bytes[i] & 31];
  return out;
}

/** Normalise une saisie ; null si la forme est invalide (longueur, caractère hors alphabet, U). */
export function normalizeGiftCardCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const code = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return VALID.test(code) ? code : null;
}

/** `KD7M4XQ29PRTH3VW` → `KD7M-4XQ2-9PRT-H3VW`. */
export function formatGiftCardCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join("-");
}

/** Dernier groupe de 4 caractères (seule partie affichée hors révélation auditée). */
export function giftCardLast4(code: string): string {
  return code.slice(-4);
}

/** Masque d'affichage : `•••• •••• •••• H3VW`. */
export function maskGiftCardLast4(last4: string): string {
  return `•••• •••• •••• ${last4}`;
}

function appSecret(secret?: string): string {
  const s = secret ?? process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET manquant ou trop court (32 caractères minimum). Voir .env.example.");
  return s;
}

/** Clé dérivée « giftcard » : HMAC-SHA256(APP_SECRET, "giftcard"). */
export function giftCardHashKey(secret?: string): Buffer {
  return createHmac("sha256", appSecret(secret)).update("giftcard").digest();
}

/** codeHash d'un code NORMALISÉ pour une boutique (hex, 64 caractères). */
export function hashGiftCardCode(storeId: string, normalizedCode: string, secret?: string): string {
  return createHmac("sha256", giftCardHashKey(secret)).update(`${storeId}:${normalizedCode}`).digest("hex");
}

/** Comparaison en temps constant de deux empreintes hex. */
export function sameGiftCardHash(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
