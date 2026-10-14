import type { TemplateId } from "@/lib/theme-engine/types";

export type EditorCollection = { id: string; name: string; slug: string; imageUrl: string | null };
export type EditorProduct = { id: string; name: string; slug: string; imageUrl: string | null };
export type EditorPage = { id: string; title: string; slug: string };
export type EditorMenu = { handle: string; title: string };
/** Catégorie du blog (réglage `blog_category`, valeur = adresse). */
export type EditorBlogCategory = { slug: string; name: string };

export type EditorResources = {
  storeId: string;
  collections: EditorCollection[];
  products: EditorProduct[];
  pages: EditorPage[];
  menus: EditorMenu[];
  /** Catégories du blog de la boutique (facultatif : absent = aucune). */
  blogCategories?: EditorBlogCategory[];
};

export type EditorPreset = { id: string; name: string; description: string; primary: string; accent: string; allowed: boolean };

export type EditorVersion = { id: string; label: string | null; publishedAt: string; actorName: string | null };

export type Selection =
  | { kind: "section"; id: string }
  | { kind: "block"; sectionId: string; blockId: string }
  | { kind: "global"; group: string }
  | null;

export type Device = "desktop" | "tablet" | "mobile";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "invalid";

export type EditorTemplate = { id: TemplateId; label: string };

/* ───────────── Lot 4 (vague 2, T2) ───────────── */

/** Fiche qui utilise un modèle alternatif (aperçu « avec un produit qui utilise ce modèle », avertissement de suppression). */
export type AlternateOwner = { type: "product" | "collection" | "page" | "article"; suffix: string; name: string; path: string };

/** Section enregistrée par la boutique (la charge est demandée au serveur à l'insertion). */
export type EditorSavedSection = { id: string; name: string; sectionType: string; sectionName: string; createdAt: string };

/** Élément de la bibliothèque Axi ; `locked` = plan insuffisant (contrôle serveur à l'insertion). */
export type EditorLibraryItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  sectionType: string;
  previewUrl: string | null;
  premium: boolean;
  requiredPlanName: string;
  locked: boolean;
  lockReason: string | null;
};

export type EditorLot4 = {
  planId: string;
  rules: import("@/lib/theme/editor-plan").EditorLot4Rules;
  alternateOwners: AlternateOwner[];
  metafields: import("@/lib/theme-engine/dynamic-sources").MetafieldDefinitionLike[];
  /** Valeurs d'exemple par chemin de source (`product.title` → « Robe wax »), pour l'aperçu des sources dynamiques. */
  samples: Record<string, string>;
  sampleProductName: string | null;
  storeCity: string | null;
  savedSections: EditorSavedSection[];
  library: EditorLibraryItem[];
  /** Faits de qualité chargés côté serveur (quality.ts). */
  qualityFacts: import("@/lib/theme-engine/quality").QualityFacts;
};
