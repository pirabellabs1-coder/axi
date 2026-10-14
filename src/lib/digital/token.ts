import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Jetons des accès de téléchargement (vague 2).
 *
 *  - 32 octets aléatoires (CSPRNG) encodés en base64url : 256 bits, non énumérable ;
 *  - la base ne contient que `tokenHash = HMAC-SHA256(clé « download » dérivée d'APP_SECRET, jeton)` (hex) :
 *    une fuite de la base ne donne aucun lien utilisable ;
 *  - la recherche se fait par empreinte (index unique) puis l'empreinte lue est comparée en TEMPS CONSTANT
 *    (`sameDownloadHash`) : aucune comparaison de chaîne sensible à la durée, aucun jeton en clair journalisé.
 *
 * Module sans `server-only` pour rester testable ; il dépend de node:crypto et ne doit pas être importé
 * par un composant client.
 */

export const DOWNLOAD_TOKEN_BYTES = 32;
/** 32 octets en base64url = 43 caractères sans remplissage. */
export const DOWNLOAD_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function appSecret(secret?: string): string {
  const s = secret ?? process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET manquant ou trop court (32 caractères minimum). Voir .env.example.");
  return s;
}

/** Clé dérivée « download » : HMAC-SHA256(APP_SECRET, "download"). */
export function downloadHashKey(secret?: string): Buffer {
  return createHmac("sha256", appSecret(secret)).update("download").digest();
}

export function generateDownloadToken(): string {
  return randomBytes(DOWNLOAD_TOKEN_BYTES).toString("base64url");
}

/** Forme attendue d'un jeton reçu dans une URL (contrôlée AVANT toute requête : pas de recherche inutile). */
export function isDownloadTokenShape(token: unknown): token is string {
  return typeof token === "string" && DOWNLOAD_TOKEN_RE.test(token);
}

export function hashDownloadToken(token: string, secret?: string): string {
  return createHmac("sha256", downloadHashKey(secret)).update(token).digest("hex");
}

/** Comparaison en temps constant de deux empreintes hex. */
export function sameDownloadHash(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
