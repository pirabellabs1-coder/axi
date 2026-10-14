import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Chiffrement au repos des secrets (clés de passerelles de paiement, tokens d'intégration).
 * AES-256-GCM avec une clé dérivée de APP_SECRET. Jamais exposé côté client.
 */
/** Valeur d'exemple (.env.example) restée en place : interdite en production (m16). */
export function isPlaceholderSecret(value: string | undefined | null): boolean {
  return !!value && /change-?me/i.test(value);
}

/**
 * Accesseur UNIQUE du secret d'application. Toute empreinte de jeton (appareil de caisse, code de
 * remise, code gérant, identifiant visiteur signé) passe par lui : jamais de `process.env.APP_SECRET ?? ""`,
 * qui produirait des empreintes calculées avec une clé vide — donc forgeables par quiconque connaît le format.
 * Lève si le secret est absent, trop court ou resté sur la valeur d'exemple.
 */
export function requireAppSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("APP_SECRET manquant ou trop court (32 caractères minimum). Voir .env.example.");
  }
  if (isPlaceholderSecret(secret)) {
    throw new Error("APP_SECRET contient la valeur d'exemple « change-me » : générez un secret aléatoire (openssl rand -hex 32).");
  }
  return secret;
}

function key(): Buffer {
  return createHash("sha256").update(requireAppSecret()).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [v, ivB, tagB, encB] = payload.split(".");
  if (v !== "v1" || !ivB || !tagB || !encB) throw new Error("Format de secret invalide");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(secret: string, input: string | Buffer): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Code numérique à 6 chiffres pour vérification e-mail / réinitialisation. */
export function numericCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += String(bytes[i] % 10);
  return out;
}
