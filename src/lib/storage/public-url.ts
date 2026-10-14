import { isLocalMediaPath, isValidMediaKey } from "./keys";

/**
 * URL publiques des médias (module pur, importable côté client comme serveur).
 * - pilote local : `/media/stores/…` (même origine, toujours accepté) ;
 * - pilote s3 : `${STORAGE_PUBLIC_URL}/stores/…` (variable lue côté serveur ; côté client elle est absente
 *   et l'URL, en https, est acceptée par les règles https habituelles).
 */

/** Base publique normalisée (sans « / » final), ou null si absente / invalide. */
export function normalizePublicUrl(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const u = new URL(v);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.search || u.hash) return null;
    return v;
  } catch {
    return null;
  }
}

export function storagePublicBase(): string | null {
  return normalizePublicUrl(typeof process !== "undefined" ? process.env.STORAGE_PUBLIC_URL : undefined);
}

/** URL publique d'un objet stocké par le pilote S3. */
export function s3PublicUrl(base: string, key: string): string {
  return `${base}/${key}`;
}

/** Vrai si l'URL désigne un média produit par la couche de stockage (local ou bucket configuré). */
export function isStoredMediaUrl(url: string, publicBase: string | null = storagePublicBase()): boolean {
  if (isLocalMediaPath(url)) return true;
  if (publicBase && url.startsWith(`${publicBase}/`)) return isValidMediaKey(url.slice(publicBase.length + 1));
  return false;
}

/** Image affichable sans validation supplémentaire : https, média stocké, ou data-URL héritée (lecture seule). */
export function isDisplayableImageUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && (url.startsWith("https://") || isStoredMediaUrl(url) || url.startsWith("data:image/"));
}

/** URL absolue (Open Graph, JSON-LD, e-mails) : préfixe l'origine de l'application aux chemins internes. */
export function absoluteUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    return base ? `${base}${url}` : undefined;
  }
  return undefined;
}

/** Image partageable (Open Graph / JSON-LD) : https ou média stocké, jamais une data-URL. */
export function shareableImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("https://")) return url;
  if (isStoredMediaUrl(url)) return absoluteUrl(url);
  return undefined;
}
