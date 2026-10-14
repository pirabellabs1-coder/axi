import type { TranslatableResource } from "@prisma/client";

/**
 * Ressources traduisibles et champs sources (lot 2 §1.1, tableau « Contenus traduisibles »).
 * Module PUR : extraction des textes sources depuis des lignes déjà chargées, sans accès base.
 *
 * Les adresses (slugs) ne sont PAS traduites au lot 2 : le même handle sert dans toutes les langues.
 */

export type TranslatableResourceType = TranslatableResource;

export const TRANSLATABLE_RESOURCES = ["STORE", "PRODUCT", "VARIANT", "OPTION", "COLLECTION", "PAGE", "MENU", "THEME", "BLOG_POST", "BLOG_CATEGORY"] as const satisfies readonly TranslatableResourceType[];

export const RESOURCE_META: Record<TranslatableResourceType, { label: string; plural: string }> = {
  STORE: { label: "Boutique", plural: "Boutique" },
  PRODUCT: { label: "Produit", plural: "Produits" },
  VARIANT: { label: "Variante", plural: "Variantes" },
  OPTION: { label: "Supplément", plural: "Suppléments" },
  COLLECTION: { label: "Collection", plural: "Collections" },
  PAGE: { label: "Page", plural: "Pages" },
  MENU: { label: "Menu", plural: "Menus" },
  THEME: { label: "Thème", plural: "Thème" },
  BLOG_POST: { label: "Article", plural: "Articles du blog" },
  BLOG_CATEGORY: { label: "Catégorie du blog", plural: "Catégories du blog" },
};

/** Identifiant de ressource du document de thème publié (`Translation.resourceId`). */
export const THEME_RESOURCE_ID = "published";

export type FieldKind = "short" | "long" | "markdown";

/** Longueur maximale acceptée pour une traduction, par nature de champ (défense en profondeur). */
export const MAX_VALUE_LENGTH: Record<FieldKind, number> = { short: 300, long: 5_000, markdown: 20_000 };

export type SourceField = { field: string; label: string; value: string; kind: FieldKind };

const push = (out: SourceField[], field: string, label: string, value: unknown, kind: FieldKind) => {
  if (typeof value === "string" && value.trim() !== "") out.push({ field, label, value, kind });
};

/** Clé d'index d'une ressource traduite. */
export function resourceKey(type: TranslatableResourceType, id: string): string {
  return `${type}:${id}`;
}

/* ───────────────────────── Boutique ───────────────────────── */

export function storeSourceFields(store: { name: string; tagline?: string | null; description?: string | null; orderNotes?: string | null }): SourceField[] {
  const out: SourceField[] = [];
  push(out, "name", "Nom", store.name, "short");
  push(out, "tagline", "Accroche", store.tagline, "short");
  push(out, "description", "Description", store.description, "long");
  push(out, "orderNotes", "Message au moment de commander", store.orderNotes, "long");
  return out;
}

/* ───────────────────────── Produit ───────────────────────── */

type ProductRow = {
  name: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  details?: unknown;
  options?: unknown;
};

/** `Product.details` : `[{ title, body }]` (titre et corps par index, §1.1). */
export function productDetails(raw: unknown): { title: string; body: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({ title: typeof d.title === "string" ? d.title : "", body: typeof d.body === "string" ? d.body : "" }));
}

/** `Product.options` : `[{ name, values[] }]` (noms d'options et valeurs des variantes). */
export function productOptions(raw: unknown): { name: string; values: string[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({ name: typeof o.name === "string" ? o.name : "", values: Array.isArray(o.values) ? o.values.filter((v): v is string => typeof v === "string") : [] }));
}

export function productSourceFields(p: ProductRow): SourceField[] {
  const out: SourceField[] = [];
  push(out, "name", "Nom", p.name, "short");
  push(out, "description", "Description", p.description, "markdown");
  push(out, "seoTitle", "Titre SEO", p.seoTitle, "short");
  push(out, "seoDescription", "Description SEO", p.seoDescription, "long");
  productDetails(p.details).forEach((d, i) => {
    push(out, `details.${i}.title`, `Détail ${i + 1} · titre`, d.title, "short");
    push(out, `details.${i}.body`, `Détail ${i + 1} · texte`, d.body, "long");
  });
  // Options et valeurs : la clé contient le TEXTE SOURCE (`options.name.Taille`, `options.value.M`) et non un
  // index. Le commerçant peut réordonner ses options sans invalider ses traductions, et le rendu applique la
  // traduction par correspondance de texte (les variantes restent sélectionnées par identifiant).
  const seen = new Set<string>();
  for (const o of productOptions(p.options)) {
    if (o.name && !seen.has(`n:${o.name}`)) {
      seen.add(`n:${o.name}`);
      push(out, optionNameField(o.name), `Option « ${o.name} » · nom`, o.name, "short");
    }
    for (const v of o.values) {
      if (!v || seen.has(`v:${v}`)) continue;
      seen.add(`v:${v}`);
      push(out, optionValueField(v), `Option « ${o.name} » · valeur « ${v} »`, v, "short");
    }
  }
  return out;
}

/** Longueur maximale d'un nom ou d'une valeur d'option repris dans une clé de champ. */
const OPTION_KEY_MAX = 80;

export function optionNameField(name: string): string {
  return `options.name.${name.slice(0, OPTION_KEY_MAX)}`;
}

export function optionValueField(value: string): string {
  return `options.value.${value.slice(0, OPTION_KEY_MAX)}`;
}

/* ───────────────────────── Variantes, suppléments ───────────────────────── */

export function variantSourceFields(v: { name: string }): SourceField[] {
  const out: SourceField[] = [];
  push(out, "name", "Nom de la variante", v.name, "short");
  return out;
}

export function optionSourceFields(o: { name: string }): SourceField[] {
  const out: SourceField[] = [];
  push(out, "name", "Nom du supplément", o.name, "short");
  return out;
}

/* ───────────────────────── Collections, pages ───────────────────────── */

export function collectionSourceFields(c: { name: string; description?: string | null; seoTitle?: string | null; seoDescription?: string | null }): SourceField[] {
  const out: SourceField[] = [];
  push(out, "name", "Nom", c.name, "short");
  push(out, "description", "Description", c.description, "long");
  push(out, "seoTitle", "Titre SEO", c.seoTitle, "short");
  push(out, "seoDescription", "Description SEO", c.seoDescription, "long");
  return out;
}

export function pageSourceFields(p: { title: string; body: string }): SourceField[] {
  const out: SourceField[] = [];
  push(out, "title", "Titre", p.title, "short");
  push(out, "body", "Contenu", p.body, "markdown");
  return out;
}

/* ───────────────────────── Menus (libellés par chemin) ───────────────────────── */

type RawMenuItem = { label?: unknown; children?: unknown };

/**
 * Libellés d'un menu, indexés par CHEMIN d'index (`0`, `0.2`, `1.0.3`) : stable tant que le commerçant
 * ne réordonne pas son menu. Profondeur 3 et 20 entrées par niveau, comme le rendu (`resolveMenu`).
 */
export function menuSourceFields(items: unknown, prefix = "", depth = 0): SourceField[] {
  if (!Array.isArray(items) || depth > 2) return [];
  const out: SourceField[] = [];
  for (const [i, raw] of items.slice(0, 20).entries()) {
    const it = (raw && typeof raw === "object" ? raw : {}) as RawMenuItem;
    const path = prefix ? `${prefix}.${i}` : String(i);
    push(out, path, `Libellé « ${typeof it.label === "string" ? it.label : ""} »`, it.label, "short");
    out.push(...menuSourceFields(it.children, path, depth + 1));
  }
  return out;
}

/* ───────────────────────── Blog ───────────────────────── */

export function blogPostSourceFields(p: { title: string; excerpt?: string | null; body: string; seoTitle?: string | null; seoDescription?: string | null }): SourceField[] {
  const out: SourceField[] = [];
  push(out, "title", "Titre", p.title, "short");
  push(out, "excerpt", "Chapô", p.excerpt, "long");
  push(out, "body", "Contenu", p.body, "markdown");
  push(out, "seoTitle", "Titre SEO", p.seoTitle, "short");
  push(out, "seoDescription", "Description SEO", p.seoDescription, "long");
  return out;
}

export function blogCategorySourceFields(c: { name: string; description?: string | null }): SourceField[] {
  const out: SourceField[] = [];
  push(out, "name", "Nom", c.name, "short");
  push(out, "description", "Description", c.description, "long");
  return out;
}

/* ───────────────────────── Application d'une traduction ───────────────────────── */

/**
 * Remplace un champ par sa traduction si elle existe et n'est pas vide, sinon conserve la source
 * (repli sur la langue principale, jamais de mélange visible dans un même champ, §1.1).
 */
export function pick(translations: Record<string, string> | undefined, field: string, source: string): string;
export function pick(translations: Record<string, string> | undefined, field: string, source: string | null): string | null;
export function pick(translations: Record<string, string> | undefined, field: string, source: string | null): string | null {
  const v = translations?.[field];
  return typeof v === "string" && v.trim() !== "" ? v : source;
}
