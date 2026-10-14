/**
 * Documents de départ de l'éditeur : délègue au moteur de rendu (`defaultThemeDocument`, `migrateLegacyTheme`)
 * et revalide le résultat ; en cas d'incompatibilité, repli sur le document minimal de l'éditeur.
 */
import { defaultThemeDocument, migrateLegacyTheme, type LegacyStore } from "@/lib/theme-engine/defaults";
import { fallbackThemeDocument } from "@/lib/theme-engine/editor-defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { presetForSector, SECTOR_PRESETS } from "@/lib/storefront/theme";

function checked(doc: ThemeDocument, fallbackPreset: string): ThemeDocument {
  const v = validateThemeDocument(doc);
  if (v.ok) return v.doc;
  return fallbackThemeDocument(SECTOR_PRESETS.find((p) => p.id === fallbackPreset) ?? SECTOR_PRESETS[0]);
}

/** Document neuf d'un modèle de départ (id de preset sectoriel = secteur). */
export function starterDocument(presetId: string, store: LegacyStore = {}): ThemeDocument {
  const preset = SECTOR_PRESETS.find((p) => p.id === presetId) ?? SECTOR_PRESETS[0];
  return checked(defaultThemeDocument(preset.sector, store), preset.id);
}

type StoreLike = { sector: string; themeId: string; themeConfig: unknown; logoUrl: string | null; bannerUrl?: string | null; name?: string; tagline?: string | null; description?: string | null; whatsappNumber?: string | null };

/** Migre l'ancien thème (themeId + themeConfig + visuels) vers un document v2. */
export function legacyDocument(store: StoreLike): ThemeDocument {
  return checked(migrateLegacyTheme(store), presetForSector(store.sector).id);
}

/** Premier document valide parmi : brouillon, publié, migration de l'ancien thème. */
export function editorDocument(store: StoreLike & { themeDoc: unknown; themeDocDraft: unknown }): { doc: ThemeDocument; source: "draft" | "published" | "legacy"; recovered: boolean } {
  const draft = store.themeDocDraft ? validateThemeDocument(store.themeDocDraft) : null;
  if (draft?.ok) return { doc: draft.doc, source: "draft", recovered: false };
  const published = store.themeDoc ? validateThemeDocument(store.themeDoc) : null;
  if (published?.ok) return { doc: published.doc, source: "published", recovered: !!store.themeDocDraft };
  return { doc: legacyDocument(store), source: "legacy", recovered: !!(store.themeDocDraft || store.themeDoc) };
}

/** Document publié (ou null s'il n'existe pas / n'est plus valide). */
export function publishedDocument(store: { themeDoc: unknown }): ThemeDocument | null {
  if (!store.themeDoc) return null;
  const v = validateThemeDocument(store.themeDoc);
  return v.ok ? v.doc : null;
}
