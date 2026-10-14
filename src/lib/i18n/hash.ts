import { createHash } from "node:crypto";

/**
 * Empreinte du texte SOURCE au moment de la traduction (`Translation.sourceHash`, lot 2 §1.1).
 * Si la source change, la traduction est marquée « à revoir » mais reste affichée (jamais de vide).
 * Fonction pure : normalisation des fins de ligne et des espaces de bord uniquement.
 */
export function sourceHash(value: string): string {
  return createHash("sha256").update(value.replace(/\r\n/g, "\n").trim(), "utf8").digest("hex");
}

/** La traduction est-elle périmée par rapport à la source actuelle ? */
export function isStale(storedHash: string | null | undefined, currentSource: string | null | undefined): boolean {
  if (!storedHash) return false;
  return sourceHash(currentSource ?? "") !== storedHash;
}
