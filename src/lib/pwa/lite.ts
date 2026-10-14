/**
 * Mode économie de données (lot 4 §14). Fonctions PURES, partagées serveur / client / tests.
 *
 * Activation : en-tête `Save-Data: on` envoyé par le navigateur, ou interrupteur du pied de page
 * (cookie `axi_lite=1`). Le choix explicite du visiteur l'emporte : `axi_lite=0` désactive le mode
 * même sous `Save-Data` (il reste maître de sa navigation).
 *
 * Effets (voir `pwa-mount.tsx`, les sections 4D et `motion.ts` pour les animations) :
 *  - police système (aucun téléchargement de police décorative) ;
 *  - images en qualité réduite et largeur plafonnée ;
 *  - aucune lecture automatique de vidéo, aucun préchargement de média ;
 *  - chargement paresseux strict (aucune image prioritaire) ;
 *  - aucune animation (déjà assuré par `motionEnvFromRequest`).
 */

export const LITE_COOKIE = "axi_lite";
export const LITE_COOKIE_MAX_AGE = 180 * 24 * 3600;

/** Qualité d'image en mode économie (contre 72 par défaut) et largeur maximale demandée au CDN. */
export const LITE_IMAGE_QUALITY = 40;
export const LITE_MAX_IMAGE_WIDTH = 640;

/** Pile de polices système : aucune requête réseau, rendu immédiat. */
export const SYSTEM_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export type LiteInput = { saveDataHeader?: string | null; liteCookie?: string | null };

export function isLiteCookieOn(v: string | null | undefined): boolean {
  return v === "1" || v === "on" || v === "true";
}

export function isLiteCookieOff(v: string | null | undefined): boolean {
  return v === "0" || v === "off" || v === "false";
}

/** Mode économie actif pour cette requête. */
export function isLiteRequest({ saveDataHeader, liteCookie }: LiteInput): boolean {
  if (isLiteCookieOn(liteCookie)) return true;
  if (isLiteCookieOff(liteCookie)) return false;
  return typeof saveDataHeader === "string" && saveDataHeader.trim().toLowerCase() === "on";
}

/** Origine du mode (affichée dans l'interrupteur du pied de page). */
export function liteOrigin({ saveDataHeader, liteCookie }: LiteInput): "cookie" | "header" | "off" {
  if (isLiteCookieOn(liteCookie)) return "cookie";
  if (isLiteCookieOff(liteCookie)) return "off";
  return typeof saveDataHeader === "string" && saveDataHeader.trim().toLowerCase() === "on" ? "header" : "off";
}

/**
 * Version allégée d'une URL d'image. Les URL du CDN (Unsplash) sont redimensionnées et recompressées ;
 * les médias stockés (`/media/…`, déjà compressés à ~300 Ko et immuables) sont laissés intacts.
 */
export function liteImageUrl(src: string | null | undefined, width = LITE_MAX_IMAGE_WIDTH): string | null {
  if (!src) return null;
  if (!src.startsWith("https://images.unsplash.com/")) return src;
  try {
    const url = new URL(src);
    const w = Number(url.searchParams.get("w")) || 0;
    const h = Number(url.searchParams.get("h")) || 0;
    const target = Math.min(width, LITE_MAX_IMAGE_WIDTH);
    url.searchParams.set("w", String(target));
    if (w && h) url.searchParams.set("h", String(Math.round((h / w) * target)));
    url.searchParams.set("q", String(LITE_IMAGE_QUALITY));
    url.searchParams.set("auto", "format");
    if (!url.searchParams.has("fit")) url.searchParams.set("fit", "crop");
    return url.toString();
  } catch {
    return src;
  }
}

/** Budget de poids de la page d'accueil en mode économie (§14), vérifié à la recette. */
export const LITE_HOME_BUDGET_BYTES = 300 * 1024;
