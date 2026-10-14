/**
 * Variantes façon Shopify, module pur (serveur et client).
 * Les options viennent de `Product.options` (nom, type, valeurs, pastilles) et, à défaut ou en complément,
 * des attributs des variantes (`Variant.attributes`, ex. { Taille: "M", Couleur: "Bleu" }).
 */

export type OptionValue = { value: string; swatch?: string; image?: string };
export type ProductOption = { name: string; type: "color" | "size" | "text"; values: OptionValue[] };
/**
 * `stock` peut être masqué (null) par la fiche produit : `inStock` fait alors foi. `inStock` vaut « achetable côté stock » :
 * une variante en rupture avec « continuer à vendre » (précommande) reste achetable (calcul serveur, src/lib/inventory/policy.ts).
 */
export type VariantLike = { id: string; attributes: Record<string, string>; stock: number | null; inStock?: boolean; available: boolean };
export type Selection = Record<string, string>;
export type ValueStatus = "available" | "soldout" | "unavailable";

const MAX_OPTIONS = 3;

function guessType(name: string): ProductOption["type"] {
  if (/couleur|color|coloris|teinte|motif/i.test(name)) return "color";
  if (/taille|pointure|size|longueur|format|contenance/i.test(name)) return "size";
  return "text";
}

/** Attributs d'une variante (JSON défensif : chaînes uniquement). */
export function variantAttributes(raw: unknown): Selection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Selection = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && k.trim() && v.trim()) out[k.trim().slice(0, 40)] = v.trim().slice(0, 60);
    else if (typeof v === "number") out[k.trim().slice(0, 40)] = String(v);
  }
  return out;
}

/**
 * Options normalisées. Avec des variantes, seules les valeurs réellement utilisées sont gardées
 * (dans l'ordre de `Product.options`, puis d'apparition), et les attributs absents de `Product.options` sont ajoutés.
 */
export function normalizeOptions(raw: unknown, variants: { attributes: Selection }[] = []): ProductOption[] {
  const out: ProductOption[] = [];
  if (Array.isArray(raw)) {
    for (const o of raw) {
      if (out.length >= MAX_OPTIONS) break;
      if (!o || typeof o !== "object") continue;
      const r = o as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : "";
      if (!name || out.some((x) => x.name === name)) continue;
      const type = r.type === "color" || r.type === "size" || r.type === "text" ? r.type : guessType(name);
      const values: OptionValue[] = [];
      if (Array.isArray(r.values)) {
        for (const v of r.values) {
          const vv = typeof v === "string" ? { value: v } : v && typeof v === "object" ? (v as Record<string, unknown>) : null;
          const value = vv && typeof vv.value === "string" ? vv.value.trim().slice(0, 60) : "";
          if (!value || values.some((x) => x.value === value)) continue;
          const ov: OptionValue = { value };
          if (vv && typeof vv.swatch === "string" && /^#[0-9a-fA-F]{6}$/.test(vv.swatch)) ov.swatch = vv.swatch;
          if (vv && typeof vv.image === "string" && /^https:\/\/[^\s<>"']+$/i.test(vv.image)) ov.image = vv.image;
          values.push(ov);
          if (values.length >= 100) break;
        }
      }
      out.push({ name, type, values });
    }
  }
  if (variants.length > 0) {
    // Compléter avec les attributs des variantes, puis retirer les valeurs jamais utilisées.
    for (const v of variants) {
      for (const [k, val] of Object.entries(v.attributes)) {
        let opt = out.find((x) => x.name === k);
        if (!opt) {
          if (out.length >= MAX_OPTIONS) continue;
          opt = { name: k, type: guessType(k), values: [] };
          out.push(opt);
        }
        if (!opt.values.some((x) => x.value === val)) opt.values.push({ value: val });
      }
    }
    for (const opt of out) opt.values = opt.values.filter((x) => variants.some((v) => v.attributes[opt.name] === x.value));
    return out.filter((o) => o.values.length > 0);
  }
  return out.filter((o) => o.values.length > 0);
}

export function isPurchasable(v: VariantLike, trackStock: boolean): boolean {
  return v.available && (!trackStock || (v.inStock ?? (v.stock ?? 0) > 0));
}

/** Variante correspondant exactement à la sélection (toutes les options choisies). */
export function findVariant<V extends VariantLike>(options: ProductOption[], variants: V[], selection: Selection): V | null {
  if (variants.length === 0) return null;
  if (options.length === 0) return variants[0];
  if (!options.every((o) => selection[o.name])) return null;
  return variants.find((v) => options.every((o) => v.attributes[o.name] === selection[o.name])) ?? null;
}

/**
 * État d'une valeur compte tenu des AUTRES options déjà choisies :
 * « unavailable » = combinaison inexistante, « soldout » = existe mais épuisée, « available » sinon.
 */
export function valueStatus(options: ProductOption[], variants: VariantLike[], selection: Selection, optionName: string, value: string, trackStock: boolean): ValueStatus {
  const matches = variants.filter((v) => v.attributes[optionName] === value && options.every((o) => o.name === optionName || !selection[o.name] || v.attributes[o.name] === selection[o.name]));
  if (matches.length === 0) return "unavailable";
  return matches.some((v) => isPurchasable(v, trackStock)) ? "available" : "soldout";
}

/** Sélection initiale : variante demandée (?variante=), sinon première variante achetable, sinon la première. */
export function initialSelection(options: ProductOption[], variants: VariantLike[], trackStock: boolean, requestedId?: string | null): Selection {
  if (variants.length === 0) return {};
  const v = (requestedId ? variants.find((x) => x.id === requestedId) : null) ?? variants.find((x) => isPurchasable(x, trackStock)) ?? variants[0];
  const sel: Selection = {};
  for (const o of options) if (v.attributes[o.name]) sel[o.name] = v.attributes[o.name];
  return sel;
}

/**
 * Changement d'une valeur : si la combinaison obtenue n'existe pas, les autres options sont ajustées
 * vers la variante la plus proche (en gardant un maximum de choix, achetable de préférence).
 */
export function changeSelection(options: ProductOption[], variants: VariantLike[], selection: Selection, optionName: string, value: string, trackStock: boolean): Selection {
  const next = { ...selection, [optionName]: value };
  if (variants.length === 0 || findVariant(options, variants, next)) return next;
  const candidates = variants.filter((v) => v.attributes[optionName] === value);
  if (candidates.length === 0) return next;
  const score = (v: VariantLike) => options.reduce((s, o) => s + (o.name !== optionName && v.attributes[o.name] === selection[o.name] ? 2 : 0), 0) + (isPurchasable(v, trackStock) ? 1 : 0);
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
  const out: Selection = {};
  for (const o of options) if (best.attributes[o.name]) out[o.name] = best.attributes[o.name];
  return out;
}

/**
 * Variante demandée pour une ligne de panier / commande. Refuse une variante inconnue OU désactivée
 * (`available: false`) et un produit à variantes sans variante choisie. Partagé par createOrder, l'aperçu des totaux
 * et la restauration de panier (tests/storefront-variants.test.ts).
 */
export function pickOrderVariant<V extends { id: string; available: boolean }>(
  product: { name: string; variants: V[] },
  variantId: string | null | undefined,
): { ok: true; variant: V | null } | { ok: false; error: string } {
  const variant = variantId ? (product.variants.find((v) => v.id === variantId) ?? null) : null;
  if (variantId && (!variant || !variant.available)) return { ok: false, error: `Variante indisponible pour ${product.name}.` };
  if (product.variants.length > 0 && !variant) return { ok: false, error: `Choisissez une variante pour ${product.name}.` };
  return { ok: true, variant };
}

/**
 * Variante demandée dans l'URL de la fiche : `?variante=` (liens partagés depuis la fiche) ou `?variant=` (flux
 * catalogue Meta / Google, lot 1 bis). `variante` prime ; valeur hors format d'identifiant ignorée. L'existence de la
 * variante dans le produit est vérifiée par l'appelant.
 */
export function requestedVariantParam(sp: Record<string, string | string[] | undefined>): string | null {
  for (const key of ["variante", "variant"] as const) {
    const raw = sp[key];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v === "string" && /^[\w-]{8,64}$/.test(v)) return v;
  }
  return null;
}
