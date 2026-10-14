/**
 * En-tête transparent superposé à la bannière (type Shopify). Module PUR (réglages + modèle → booléen),
 * testé unitairement et partagé serveur / aperçu. La décision n'active JAMAIS la transparence tant que
 * `settings.header.transparentOverHero` est faux (défaut) : le rendu existant reste strictement inchangé.
 */
import { isHexColor, readableOn, S } from "@/lib/storefront/theme-doc";
import type { GlobalSettings, SectionInstance, SectionType, Settings, Template } from "./types";

/** Sections bannière pouvant accueillir un en-tête transparent (plein cadre en tête de page). */
export const OVERLAY_HERO_TYPES: ReadonlySet<SectionType> = new Set(["hero-banner", "slideshow", "hero-split-video"]);

function hasImage(v: Settings[string] | undefined): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { url?: unknown }).url === "string" && ((v as { url: string }).url?.length ?? 0) > 0;
}

/** Un schéma de section (section settings `scheme`) produit-il un fond sombre imposant un texte clair ? */
export function isDarkScheme(settings: GlobalSettings, scheme: string | undefined): boolean {
  if (!scheme || scheme === "default" || scheme === "surface") return false;
  let bg: string | undefined;
  if (scheme === "inverse") bg = settings.colors.text;
  else if (scheme === "brand") bg = settings.colors.primary;
  else bg = settings.colors.schemes.find((x) => x.id === scheme)?.background;
  return !!bg && isHexColor(bg) && readableOn(bg) === "#ffffff";
}

/**
 * La section (supposée 1re du corps) est-elle une bannière éligible à la transparence ?
 * Éligible quand la zone sous l'en-tête est franchement sombre ou couverte par une image plein cadre :
 *  - hero-banner : image plein cadre (disposition « overlay » ou « below ») OU schéma sombre ;
 *  - slideshow : au moins une diapositive avec image (toujours plein cadre, avec voile) ;
 *  - hero-split-video : média seulement sur une moitié → éligible uniquement si le schéma est sombre.
 */
export function isOverlayEligibleBanner(section: SectionInstance, settings: GlobalSettings): boolean {
  if (!OVERLAY_HERO_TYPES.has(section.type)) return false;
  const s = section.settings;
  if (section.type === "slideshow") {
    return section.blocks.some((b) => b.type === "slide" && !b.disabled && hasImage(b.settings.image));
  }
  if (section.type === "hero-split-video") {
    return isDarkScheme(settings, S.str(s, "scheme", "default"));
  }
  // hero-banner
  const layout = S.str(s, "layout", "overlay");
  const fullBleed = layout === "overlay" || layout === "below";
  return (fullBleed && (hasImage(s.image) || hasImage(s.image_mobile))) || isDarkScheme(settings, S.str(s, "scheme", "default"));
}

/** 1re section du corps réellement rendue (ordre du modèle, 1re non désactivée). */
export function firstBodySection(template: Template | null | undefined): SectionInstance | null {
  if (!template) return null;
  for (const id of template.order) {
    const s = template.sections[id];
    if (s && !s.disabled) return s;
  }
  return null;
}

/**
 * Décision finale : l'en-tête doit-il se superposer en transparent à la 1re bannière ?
 * Vrai seulement si l'option est activée ET que la 1re section du corps est une bannière éligible.
 */
export function headerOverlaysHero(settings: GlobalSettings, template: Template | null | undefined): boolean {
  if (!settings.header.transparentOverHero) return false;
  const first = firstBodySection(template);
  return !!first && isOverlayEligibleBanner(first, settings);
}
