import { isDataImageUrl } from "./data-url";
import { isLocalMediaPath, MEDIA_ROUTE_PREFIX } from "./keys";
import { isStoredMediaUrl, storagePublicBase } from "./public-url";

/**
 * Règles d'ÉCRITURE des images (module pur, appelé par les actions serveur après chargement de l'existant).
 *
 * 1. Aucune nouvelle data-URL : une image base64 n'est acceptée que si elle est STRICTEMENT identique à une
 *    valeur déjà en base pour cette entité (données antérieures au stockage des médias, pas encore migrées).
 *    Sinon on contournerait le stockage et son quota en enregistrant des images dans la base.
 * 2. Un média téléversé (`/media/stores/…` ou `${STORAGE_PUBLIC_URL}/stores/…`) doit appartenir à la boutique
 *    (`stores/{storeId}/…`), sauf s'il figure déjà dans l'existant.
 * La lecture et le rendu restent rétrocompatibles (voir public-url.ts).
 */
export const DATA_URL_WRITE_ERROR = "Les images intégrées (base64) ne sont plus acceptées : importez le fichier pour l'envoyer au stockage des médias.";
export const FOREIGN_MEDIA_ERROR = "Cette image appartient à une autre boutique : importez-la à nouveau.";

function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value && typeof value === "object") for (const v of Object.values(value)) yield* strings(v);
}

/** Clé de média désignée par une URL de stockage, ou null. */
export function mediaKeyOf(url: string, publicBase: string | null = storagePublicBase()): string | null {
  if (isLocalMediaPath(url)) return url.slice(MEDIA_ROUTE_PREFIX.length);
  if (publicBase && isStoredMediaUrl(url, publicBase) && url.startsWith(`${publicBase}/`)) return url.slice(publicBase.length + 1);
  return null;
}

/** Vrai si l'URL est un média de stockage appartenant à la boutique. */
export function isOwnStoredMediaUrl(url: string, storeId: string, publicBase: string | null = storagePublicBase()): boolean {
  const key = mediaKeyOf(url, publicBase);
  return !!key && key.startsWith(`stores/${storeId}/`);
}

/**
 * Vérifie une valeur à écrire (chaîne, liste d'images, document JSON). `existing` : valeurs actuellement en
 * base pour la même entité (ex. [themeDoc, themeDocDraft]). Renvoie un message d'erreur, ou null si tout va bien.
 */
export function checkImageWrite(next: unknown, opts: { storeId: string; existing?: unknown[]; publicBase?: string | null }): string | null {
  const publicBase = opts.publicBase === undefined ? storagePublicBase() : opts.publicBase;
  let known: Set<string> | null = null;
  const isKnown = (s: string) => {
    known ??= new Set(strings(opts.existing ?? []));
    return known.has(s);
  };
  for (const s of strings(next)) {
    if (s.startsWith("data:")) {
      // Toute data-URL (image ou non) qui n'est pas déjà en base est refusée.
      if (!isKnown(s)) return DATA_URL_WRITE_ERROR;
      if (!isDataImageUrl(s)) return DATA_URL_WRITE_ERROR;
      continue;
    }
    const key = mediaKeyOf(s, publicBase);
    if (key && !key.startsWith(`stores/${opts.storeId}/`) && !isKnown(s)) return FOREIGN_MEDIA_ERROR;
  }
  return null;
}
