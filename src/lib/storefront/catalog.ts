/**
 * Catalogue : collections automatiques, filtres, tri et pagination. Module pur (testé).
 * Paramètres d'URL en français, partageables : ?tri=prix-croissant&prix_min=5000&dispo=1&tag=wax&opt=Taille:M&page=2
 */
import type { CardProduct } from "./render-types";

export const SORTS = [
  { value: "pertinence", label: "En vedette" },
  { value: "nouveautes", label: "Nouveautés" },
  { value: "meilleures-ventes", label: "Meilleures ventes" },
  { value: "prix-croissant", label: "Prix croissant" },
  { value: "prix-decroissant", label: "Prix décroissant" },
  { value: "alpha", label: "De A à Z" },
] as const;
export type SortKey = (typeof SORTS)[number]["value"];

export type CatalogParams = {
  sort: SortKey | null;
  page: number;
  min: number | null;
  max: number | null;
  collection: string | null;
  available: boolean;
  tags: string[];
  options: Record<string, string[]>;
  q: string;
};

export type Facets = {
  price: { min: number; max: number };
  tags: { value: string; count: number }[];
  options: { name: string; type: string; values: { value: string; swatch?: string; count: number }[] }[];
  collections: { handle: string; name: string; count: number }[];
  availableCount: number;
  total: number;
};

type SP = Record<string, string | string[] | undefined>;

const arr = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const first = (v: string | string[] | undefined) => arr(v)[0];

function int(v: string | undefined): number | null {
  if (!v || !/^\d{1,10}$/.test(v)) return null;
  return Number(v);
}

export function parseCatalogParams(sp: SP): CatalogParams {
  const sortRaw = first(sp.tri);
  const sort = SORTS.some((s) => s.value === sortRaw) ? (sortRaw as SortKey) : null;
  const page = Math.max(1, Math.min(500, int(first(sp.page)) ?? 1));
  let min = int(first(sp.prix_min));
  let max = int(first(sp.prix_max));
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const collection = first(sp.collection);
  const options: Record<string, string[]> = {};
  for (const raw of arr(sp.opt).slice(0, 20)) {
    const i = raw.indexOf(":");
    if (i <= 0) continue;
    const name = raw.slice(0, i).trim().slice(0, 40);
    const value = raw.slice(i + 1).trim().slice(0, 60);
    if (!name || !value) continue;
    (options[name] ??= []).includes(value) || options[name].push(value);
  }
  return {
    sort,
    page,
    min,
    max,
    collection: collection && /^[a-z0-9-]{1,80}$/.test(collection) ? collection : null,
    available: first(sp.dispo) === "1",
    tags: [...new Set(arr(sp.tag).map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 10),
    options,
    q: (first(sp.q) ?? "").trim().slice(0, 80),
  };
}

/** Chaîne de requête à partir de paramètres (avec modification). `page` est remis à 1 sauf s'il est fourni. */
export function catalogQuery(p: CatalogParams, patch: Partial<CatalogParams> = {}): string {
  const n = { ...p, page: 1, ...patch };
  const sp = new URLSearchParams();
  if (n.q) sp.set("q", n.q);
  if (n.collection) sp.set("collection", n.collection);
  if (n.sort) sp.set("tri", n.sort);
  if (n.min !== null) sp.set("prix_min", String(n.min));
  if (n.max !== null) sp.set("prix_max", String(n.max));
  if (n.available) sp.set("dispo", "1");
  for (const t of n.tags) sp.append("tag", t);
  for (const [k, vs] of Object.entries(n.options)) for (const v of vs) sp.append("opt", `${k}:${v}`);
  if (n.page > 1) sp.set("page", String(n.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function activeFilterCount(p: CatalogParams): number {
  return (p.min !== null || p.max !== null ? 1 : 0) + (p.available ? 1 : 0) + p.tags.length + Object.values(p.options).reduce((s, v) => s + v.length, 0) + (p.collection ? 1 : 0);
}

/* ───────────────────────── Collections automatiques ───────────────────────── */

export type CollectionRules = { match: "all" | "any"; conditions: { field: string; op: string; value: string | number | boolean }[] };

export function parseRules(raw: unknown): CollectionRules | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.conditions) || r.conditions.length === 0) return null;
  const conditions = r.conditions
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ field: String(c.field ?? ""), op: String(c.op ?? "eq"), value: (typeof c.value === "number" || typeof c.value === "boolean" ? c.value : String(c.value ?? "")) as string | number | boolean }))
    .slice(0, 20);
  if (conditions.length === 0) return null;
  return { match: r.match === "any" ? "any" : "all", conditions };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function compareText(actual: string, op: string, expected: string): boolean {
  const a = norm(actual);
  const e = norm(expected);
  switch (op) {
    case "eq":
    case "equals":
    case "is":
      return a === e;
    case "neq":
    case "not_equals":
    case "is_not":
      return a !== e;
    case "contains":
      return a.includes(e);
    case "not_contains":
      return !a.includes(e);
    case "starts_with":
      return a.startsWith(e);
    case "ends_with":
      return a.endsWith(e);
    default:
      return false;
  }
}

function compareNum(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case "eq":
    case "equals":
      return actual === expected;
    case "neq":
    case "not_equals":
      return actual !== expected;
    case "gt":
    case "greater_than":
      return actual > expected;
    case "gte":
      return actual >= expected;
    case "lt":
    case "less_than":
      return actual < expected;
    case "lte":
      return actual <= expected;
    default:
      return false;
  }
}

export function matchesCondition(p: CardProduct, c: CollectionRules["conditions"][number]): boolean {
  const v = c.value;
  switch (c.field) {
    case "tag":
      if (c.op === "neq" || c.op === "not_equals" || c.op === "not_contains") return !p.tags.some((t) => compareText(t, c.op === "not_contains" ? "contains" : "eq", String(v)));
      return p.tags.some((t) => compareText(t, c.op, String(v)));
    case "title":
      return compareText(p.name, c.op, String(v));
    case "vendor":
      return compareText(p.vendor ?? "", c.op, String(v));
    case "type":
    case "productType":
      return compareText(p.productType ?? "", c.op, String(v));
    case "price": {
      const n = Number(v);
      return Number.isFinite(n) && compareNum(p.price, c.op, n);
    }
    case "promo": {
      const want = v === true || v === "true" || v === "1" || v === 1;
      const isPromo = p.onSale ?? p.compareAt !== null;
      return c.op === "neq" || c.op === "not_equals" ? isPromo !== want : isPromo === want;
    }
    case "stock":
    case "available":
      return !p.soldOut === (v === true || v === "true" || v === "1" || v === 1);
    default:
      return false;
  }
}

/**
 * Collection MANUELLE (règles sans conditions) : l'espace marchand enregistre `{ type: "manual", productIds: [...] }`
 * (liste ordonnée, un produit peut appartenir à plusieurs collections). Membres = `productIds` ∪ produits dont
 * `categoryId` = la collection (catégorie principale). Même logique que `getCollectionProducts` (src/lib/collections/service.ts).
 */
export function manualMemberIds(raw: unknown, collectionId: string, products: { id: string; categoryId: string | null }[]): string[] {
  const listed = raw && typeof raw === "object" && Array.isArray((raw as { productIds?: unknown }).productIds) ? ((raw as { productIds: unknown[] }).productIds.filter((x) => typeof x === "string") as string[]) : [];
  const known = new Set(products.map((p) => p.id));
  const ordered = listed.filter((id) => known.has(id));
  const set = new Set(ordered);
  return [...ordered, ...products.filter((p) => p.categoryId === collectionId && !set.has(p.id)).map((p) => p.id)];
}

export function matchesRules(p: CardProduct, rules: CollectionRules): boolean {
  return rules.match === "any" ? rules.conditions.some((c) => matchesCondition(p, c)) : rules.conditions.every((c) => matchesCondition(p, c));
}

/* ───────────────────────── Tri ───────────────────────── */

const COLLECTION_SORT: Record<string, SortKey> = { newest: "nouveautes", price_asc: "prix-croissant", price_desc: "prix-decroissant", best_selling: "meilleures-ventes", alpha: "alpha", manual: "pertinence" };

export function collectionSortKey(sortOrder: string | null | undefined): SortKey {
  return COLLECTION_SORT[sortOrder ?? "manual"] ?? "pertinence";
}

export function sortProducts(list: CardProduct[], sort: SortKey): CardProduct[] {
  const out = [...list];
  const byDefault = (a: CardProduct, b: CardProduct) => Number(b.isFeatured) - Number(a.isFeatured) || a.position - b.position || b.createdAt.localeCompare(a.createdAt);
  switch (sort) {
    case "nouveautes":
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "meilleures-ventes":
      return out.sort((a, b) => b.sales - a.sales || byDefault(a, b));
    case "prix-croissant":
      return out.sort((a, b) => a.price - b.price || byDefault(a, b));
    case "prix-decroissant":
      return out.sort((a, b) => b.price - a.price || byDefault(a, b));
    case "alpha":
      return out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    default:
      return out.sort(byDefault);
  }
}

/* ───────────────────────── Recherche, filtres, facettes ───────────────────────── */

export function matchesQuery(p: CardProduct, q: string): boolean {
  if (!q) return true;
  const hay = norm([p.name, p.description ?? "", p.vendor ?? "", p.productType ?? "", ...p.tags].join(" "));
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Filtre une liste de produits (la collection, le cas échéant, est déjà appliquée en amont). */
export function applyFilters(list: CardProduct[], p: CatalogParams, collectionIds?: Map<string, Set<string>>): CardProduct[] {
  const inCollection = p.collection && collectionIds ? collectionIds.get(p.collection) : null;
  const optionEntries = Object.entries(p.options);
  return list.filter((x) => {
    if (p.collection && collectionIds && !inCollection?.has(x.id)) return false;
    if (!matchesQuery(x, p.q)) return false;
    if (p.min !== null && x.price < p.min) return false;
    if (p.max !== null && x.price > p.max) return false;
    if (p.available && x.soldOut) return false;
    if (p.tags.length && !p.tags.some((t) => x.tags.some((pt) => norm(pt) === norm(t)))) return false;
    for (const [name, values] of optionEntries) {
      // Au moins une variante disposant d'une des valeurs choisies (et achetable si « disponible »).
      const ok = x.variants.length
        ? x.variants.some((v) => values.includes(v.attributes[name]) && (!p.available || v.purchasable))
        : x.options.some((o) => o.name === name && o.values.some((ov) => values.includes(ov.value)));
      if (!ok) return false;
    }
    return true;
  });
}

export function computeFacets(list: CardProduct[], collections: { handle: string; name: string; productIds: string[] }[] = []): Facets {
  const prices = list.map((p) => p.price);
  const tags = new Map<string, number>();
  const options = new Map<string, { type: string; values: Map<string, { swatch?: string; count: number }> }>();
  for (const p of list) {
    for (const t of new Set(p.tags)) tags.set(t, (tags.get(t) ?? 0) + 1);
    for (const o of p.options) {
      let e = options.get(o.name);
      if (!e) options.set(o.name, (e = { type: o.type, values: new Map() }));
      for (const v of o.values) {
        const cur = e.values.get(v.value);
        e.values.set(v.value, { swatch: cur?.swatch ?? v.swatch, count: (cur?.count ?? 0) + 1 });
      }
    }
  }
  const ids = new Set(list.map((p) => p.id));
  return {
    price: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 },
    tags: [...tags.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr")).slice(0, 30),
    options: [...options.entries()].map(([name, e]) => ({ name, type: e.type, values: [...e.values.entries()].map(([value, v]) => ({ value, ...v })) })),
    collections: collections.map((c) => ({ handle: c.handle, name: c.name, count: c.productIds.filter((id) => ids.has(id)).length })).filter((c) => c.count > 0),
    availableCount: list.filter((p) => !p.soldOut).length,
    total: list.length,
  };
}

export function paginate<T>(list: T[], page: number, perPage: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * perPage, p * perPage), page: p, pages };
}
