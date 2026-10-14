/**
 * Options et variantes façon Shopify — fonctions pures (client + serveur), testées dans tests/catalog-variants.test.ts.
 *
 * `Product.options` : jusqu'à 3 options, chacune avec ses valeurs ordonnées.
 * `Variant.attributes` : { [nom d'option]: valeur }, toujours cohérent avec `Product.options`.
 */

export type OptionType = "color" | "size" | "text";
export type OptionValue = { value: string; swatch?: string | null; image?: string | null };
export type ProductOption = { name: string; type: OptionType; values: OptionValue[] };

export type VariantDraft = {
  id?: string;
  /** Clé locale stable (UI) ; l'id base reste la référence côté serveur. */
  key?: string;
  attributes: Record<string, string>;
  price: number | null;
  compareAtPrice: number | null;
  sku: string | null;
  barcode: string | null;
  stock: number;
  /** Stock lu à l'ouverture (variantes existantes) : sert de base au calcul du delta côté serveur. */
  stockBase?: number | null;
  weightGrams: number | null;
  imageUrl: string | null;
  available: boolean;
  /** « Continuer à vendre en cas de rupture » (absent = politique du produit pour une nouvelle combinaison). */
  inventoryPolicy?: "DENY" | "CONTINUE";
};

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;
export const MAX_OPTION_VALUES = 50;

export const OPTION_PRESETS: { name: string; type: OptionType }[] = [
  { name: "Couleur", type: "color" },
  { name: "Taille", type: "size" },
  { name: "Matière", type: "text" },
];

/** Clé canonique d'une combinaison (ordre des options du produit). */
export function attrKey(attrs: Record<string, string>, options?: ProductOption[]): string {
  const names = options ? options.map((o) => o.name) : Object.keys(attrs).sort((a, b) => a.localeCompare(b));
  return names.map((n) => `${n}=${attrs[n] ?? ""}`).join("|");
}

/** Nom lisible d'une variante : « Rouge / M ». */
export function variantName(attrs: Record<string, string>, options: ProductOption[]): string {
  return options.map((o) => attrs[o.name]).filter(Boolean).join(" / ") || "Par défaut";
}

/** Produit cartésien des valeurs des options (dans l'ordre des options et des valeurs). */
export function combinations(options: ProductOption[]): Record<string, string>[] {
  const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
  if (usable.length === 0) return [];
  return usable.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v.value }))), [{}]);
}

export function countCombinations(options: ProductOption[]): number {
  const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
  return usable.length === 0 ? 0 : usable.reduce((n, o) => n * o.values.length, 1);
}

export function emptyVariant(attributes: Record<string, string>): VariantDraft {
  return { attributes, price: null, compareAtPrice: null, sku: null, barcode: null, stock: 0, weightGrams: null, imageUrl: null, available: true };
}

/**
 * Régénère la matrice des variantes à partir des options en CONSERVANT les variantes existantes
 * (id, prix, stock, SKU…) dont la combinaison existe encore :
 *  1. correspondance exacte de la combinaison ;
 *  2. sinon (option ajoutée ou retirée, valeur renommée), meilleure correspondance partielle non encore utilisée :
 *     la variante existante qui partage le plus de couples option=valeur, à condition de ne contredire aucune
 *     option commune. Ex. ajouter « Taille » à des variantes Couleur garde chaque couleur sur la 1re taille.
 * Les combinaisons retirées disparaissent ; les nouvelles sont créées vides.
 */
export function buildVariantMatrix(options: ProductOption[], existing: VariantDraft[], renames: Record<string, Record<string, string>> = {}): VariantDraft[] {
  const combos = combinations(options);
  if (combos.length === 0) return [];
  // Applique les renommages de valeurs (option -> ancienne valeur -> nouvelle) aux variantes existantes.
  const pool = existing.map((v) => {
    const attrs = { ...v.attributes };
    for (const [opt, map] of Object.entries(renames)) if (attrs[opt] != null && map[attrs[opt]] != null) attrs[opt] = map[attrs[opt]];
    return { v: { ...v, attributes: attrs }, used: false };
  });
  const byKey = new Map<string, (typeof pool)[number]>();
  for (const p of pool) {
    const k = attrKey(p.v.attributes, options);
    if (!byKey.has(k) && Object.keys(p.v.attributes).length === options.filter((o) => o.values.length).length) byKey.set(k, p);
  }
  const result: (VariantDraft | null)[] = combos.map((attrs) => {
    const hit = byKey.get(attrKey(attrs, options));
    if (hit && !hit.used) {
      hit.used = true;
      return { ...hit.v, attributes: attrs };
    }
    return null;
  });
  // Correspondances partielles
  for (let i = 0; i < combos.length; i++) {
    if (result[i]) continue;
    const attrs = combos[i];
    let best: (typeof pool)[number] | null = null;
    let bestScore = 0;
    for (const p of pool) {
      if (p.used) continue;
      let score = 0;
      let conflict = false;
      for (const [k, val] of Object.entries(p.v.attributes)) {
        if (!(k in attrs)) continue;
        if (attrs[k] === val) score++;
        else conflict = true;
      }
      if (conflict || score === 0) continue;
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    if (best) {
      best.used = true;
      result[i] = { ...best.v, attributes: attrs };
    } else result[i] = emptyVariant(attrs);
  }
  return result as VariantDraft[];
}

/** Reconstruit des options depuis des variantes (produits créés avant `Product.options`). */
export function optionsFromVariants(variants: { attributes: unknown }[]): ProductOption[] {
  const map = new Map<string, string[]>();
  for (const v of variants) {
    const attrs = (v.attributes && typeof v.attributes === "object" ? v.attributes : {}) as Record<string, unknown>;
    for (const [k, val] of Object.entries(attrs)) {
      if (typeof val !== "string") continue;
      if (!map.has(k)) map.set(k, []);
      const list = map.get(k)!;
      if (!list.includes(val)) list.push(val);
    }
  }
  return [...map.entries()].slice(0, MAX_OPTIONS).map(([name, values]) => ({ name, type: guessType(name), values: values.map((value) => ({ value })) }));
}

export function guessType(name: string): OptionType {
  const n = name.trim().toLowerCase();
  if (/^(couleur|coloris|color|colour|teinte)s?$/.test(n)) return "color";
  if (/^(taille|pointure|size|dimension)s?$/.test(n)) return "size";
  return "text";
}

/** Lecture tolérante de `Product.options` (JSON en base). */
export function readOptions(raw: unknown): ProductOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    if (typeof r.name !== "string" || !Array.isArray(r.values)) continue;
    const type: OptionType = r.type === "color" || r.type === "size" || r.type === "text" ? r.type : guessType(r.name);
    const values = (r.values as unknown[])
      .map((v) => (typeof v === "string" ? { value: v } : v && typeof v === "object" && typeof (v as OptionValue).value === "string" ? (v as OptionValue) : null))
      .filter((v): v is OptionValue => !!v)
      .map((v) => ({ value: v.value, ...(v.swatch ? { swatch: v.swatch } : {}), ...(v.image ? { image: v.image } : {}) }));
    out.push({ name: r.name, type, values });
  }
  return out.slice(0, MAX_OPTIONS);
}

/** Stock total + résumé « 12 en stock pour 6 variantes ». */
export function stockSummary(p: { trackStock: boolean; stock: number; variants: { stock: number }[] }): { total: number; label: string } {
  if (!p.trackStock) return { total: 0, label: "Non suivi" };
  if (p.variants.length === 0) return { total: p.stock, label: `${p.stock.toLocaleString("fr-FR")} en stock` };
  const total = p.variants.reduce((s, v) => s + v.stock, 0);
  const n = p.variants.length;
  return { total, label: `${total.toLocaleString("fr-FR")} en stock pour ${n} variante${n > 1 ? "s" : ""}` };
}
