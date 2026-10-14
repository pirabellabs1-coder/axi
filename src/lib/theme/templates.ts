/**
 * Modèles de boutique par secteur : métadonnées d'affichage (photo, libellé de secteur)
 * et règles de plan (`limits.themes`). Module pur, importable côté client et serveur.
 */
import { MEDIA, PRODUCT_PHOTOS } from "@/config/media";
import { PLANS, type PlanId } from "@/config/plans";
import { SECTOR_PRESETS, getPreset, presetForSector, type Sector, type ThemePreset } from "@/lib/storefront/theme";

export const SECTOR_LABELS: Record<Sector, string> = {
  general: "Commerce",
  restaurant: "Restauration",
  patisserie: "Pâtisserie",
  mode: "Mode",
  beaute: "Beauté",
  salon: "Salon",
  clinique: "Santé",
};

/** Photo réelle illustrant chaque modèle (null = pas de photo adaptée, rendu en aplat de couleurs). */
export const TEMPLATE_PHOTOS: Record<Sector, { id: string; alt: string } | null> = {
  general: MEDIA.shopCounter,
  restaurant: MEDIA.jollof,
  patisserie: MEDIA.bakery,
  mode: MEDIA.fabrics,
  beaute: { id: PRODUCT_PHOTOS.sheaButter, alt: "Beurre de karité et soins naturels" },
  salon: MEDIA.braids,
  clinique: null,
};

/** Id canonique (les anciens ids v1 `market`, `fashion`, `beauty` pointent vers leur modèle sectoriel). */
export function canonicalTemplateId(themeId: string): string {
  const p = getPreset(themeId);
  return SECTOR_PRESETS.find((s) => s.sector === p.sector)?.id ?? SECTOR_PRESETS[0].id;
}

export type TemplateAllowance = {
  /** null = tous les modèles. */
  limit: number | null;
  allowed: string[];
};

/**
 * Modèles utilisables selon le plan. Plan limité (Gratuit : 2) : le modèle actuel, puis celui du secteur,
 * puis l'ordre du catalogue. Le modèle actuel reste toujours utilisable (aucune boutique cassée après un changement de plan).
 */
export function templateAllowance(planId: PlanId, sector: string | null | undefined, currentThemeId: string): TemplateAllowance {
  const limit = PLANS[planId].limits.themes;
  const all = SECTOR_PRESETS.map((p) => p.id);
  if (limit == null) return { limit: null, allowed: all };
  const ordered = Array.from(new Set([canonicalTemplateId(currentThemeId), presetForSector(sector).id, ...all]));
  return { limit, allowed: ordered.slice(0, Math.max(1, limit)) };
}

export function isTemplateAllowed(planId: PlanId, sector: string | null | undefined, currentThemeId: string, themeId: string): boolean {
  if (themeId === currentThemeId) return true;
  return templateAllowance(planId, sector, currentThemeId).allowed.includes(canonicalTemplateId(themeId));
}

export function sectorTemplates(): ThemePreset[] {
  return SECTOR_PRESETS;
}
