/**
 * Clés d'objets et chemins publics des médias (module pur, utilisable client et serveur).
 *
 * Clé : `stores/{storeId}/{yyyy}/{mm}/{sha256}.{ext}` — le hash du contenu rend chaque objet immuable
 * (cache long) et dédoublonne les envois identiques du même mois. Aucune donnée fournie par le client
 * n'entre dans la clé hormis le `storeId` (déjà vérifié par requireStore) : pas de nom de fichier, donc
 * pas de traversée de chemin possible.
 */

export const MEDIA_ROUTE_PREFIX = "/media/";

export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
} as const;

export type ImageMime = keyof typeof IMAGE_TYPES;
export type ImageExt = (typeof IMAGE_TYPES)[ImageMime];

export const EXT_TO_MIME: Record<ImageExt, ImageMime> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

/** Seul format de clé accepté en lecture comme en écriture. */
export const MEDIA_KEY_RE = /^stores\/[a-z0-9]{8,40}\/(returns\/|delivery\/)?\d{4}\/(0[1-9]|1[0-2])\/[a-f0-9]{64}\.(jpg|png|webp|avif|gif)$/;

/**
 * Espaces de noms optionnels sous la boutique.
 *  - `returns` : photos jointes par les ACHETEURS aux demandes de retour, isolées des médias du commerçant
 *    (le dédoublonnage par contenu ne mélange jamais les deux) et purgées après 24 h si aucune demande ne les
 *    cite (src/lib/returns/photo-purge.ts) ;
 *  - `delivery` : photos de PREUVE DE REMISE téléversées par le livreur depuis `/livraison/[token]`
 *    (lot 3 §1.2, mineur n° 5). Elles valent preuve de livraison : la clé est produite par le serveur à
 *    partir du hash du contenu, jamais fournie par le client.
 */
export type MediaNamespace = "returns" | "delivery";

/** Préfixe des photos de preuve de remise d'une boutique. */
export function deliveryMediaPrefix(storeId: string): string {
  return `stores/${storeId}/delivery/`;
}

/** Préfixe des photos de retour d'une boutique. */
export function returnMediaPrefix(storeId: string): string {
  return `stores/${storeId}/returns/`;
}

export function isValidMediaKey(key: string): boolean {
  return MEDIA_KEY_RE.test(key);
}

export function buildMediaKey(storeId: string, sha256Hex: string, ext: ImageExt, date: Date = new Date(), namespace?: MediaNamespace): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const key = `stores/${storeId}/${namespace ? `${namespace}/` : ""}${yyyy}/${mm}/${sha256Hex}.${ext}`;
  if (!isValidMediaKey(key)) throw new Error("Clé de média invalide");
  return key;
}

/** Type MIME servi pour une clé valide (déduit de l'extension, elle-même issue des octets magiques). */
export function mimeForKey(key: string): ImageMime | null {
  if (!isValidMediaKey(key)) return null;
  const ext = key.slice(key.lastIndexOf(".") + 1) as ImageExt;
  return EXT_TO_MIME[ext] ?? null;
}

/** `/media/stores/…` (pilote local) — chemin interne strict. */
export function isLocalMediaPath(url: string): boolean {
  return url.startsWith(MEDIA_ROUTE_PREFIX) && isValidMediaKey(url.slice(MEDIA_ROUTE_PREFIX.length));
}

/** Segments d'URL reçus par la route `/media/[...key]` → clé validée, ou null (404). */
export function keyFromSegments(segments: string[] | undefined): string | null {
  if (!segments?.length || segments.length > 8) return null;
  // Next décode déjà les segments : on refuse tout ce qui n'est pas du texte de clé (`..`, `\`, `%`, vide…).
  if (segments.some((s) => !s || s === "." || s === ".." || !/^[A-Za-z0-9._-]+$/.test(s))) return null;
  const key = segments.join("/");
  return isValidMediaKey(key) ? key : null;
}
