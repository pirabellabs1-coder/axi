import { describe, it, expect } from "vitest";
import { activeFilterCount, applyFilters, catalogQuery, computeFacets, manualMemberIds, matchesRules, paginate, parseCatalogParams, parseRules, sortProducts } from "@/lib/storefront/catalog";
import type { CardProduct } from "@/lib/storefront/render-types";

function product(p: Partial<CardProduct> & { id: string; name: string; price: number }): CardProduct {
  return {
    slug: p.id,
    vendor: null,
    description: null,
    compareAt: null,
    range: false,
    discountPct: 0,
    soldOut: false,
    images: [],
    simple: true,
    unitPrice: p.price,
    minQty: 1,
    variantCount: 0,
    categoryId: null,
    tags: [],
    productType: null,
    options: [],
    isFeatured: false,
    position: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
    isNew: false,
    sales: 0,
    rating: null,
    variants: [],
    ...p,
  };
}

const robe = product({
  id: "robe",
  name: "Robe wax Abomey",
  price: 18000,
  tags: ["wax", "femme"],
  simple: false,
  options: [{ name: "Taille", type: "size", values: [{ value: "S" }, { value: "M" }] }],
  variants: [
    { attributes: { Taille: "S" }, purchasable: true },
    { attributes: { Taille: "M" }, purchasable: false },
  ],
  createdAt: "2026-03-01T00:00:00.000Z",
  sales: 4,
});
const chemise = product({ id: "chemise", name: "Chemise wax homme", price: 15000, tags: ["wax", "homme"], compareAt: 18000, createdAt: "2026-02-01T00:00:00.000Z", sales: 9 });
const sac = product({ id: "sac", name: "Sac en pagne tissé", price: 8500, tags: ["accessoire"], soldOut: true, isFeatured: true });
const all = [robe, chemise, sac];

describe("parseCatalogParams / catalogQuery", () => {
  it("lit les paramètres français et ignore les valeurs invalides", () => {
    const p = parseCatalogParams({ tri: "prix-croissant", page: "2", prix_min: "20000", prix_max: "5000", dispo: "1", tag: ["wax", "wax", ""], opt: ["Taille:M", "invalide", "Couleur:"], collection: "Femme!" });
    expect(p.sort).toBe("prix-croissant");
    expect(p.page).toBe(2);
    expect([p.min, p.max]).toEqual([5000, 20000]); // bornes inversées remises dans l'ordre
    expect(p.available).toBe(true);
    expect(p.tags).toEqual(["wax"]);
    expect(p.options).toEqual({ Taille: ["M"] });
    expect(p.collection).toBeNull();
    expect(parseCatalogParams({ tri: "<script>", page: "-3" })).toMatchObject({ sort: null, page: 1 });
  });

  it("aller-retour URL et remise à la page 1 lors d'un changement de filtre", () => {
    const p = parseCatalogParams({ tri: "nouveautes", tag: "wax", opt: "Taille:S", page: "3" });
    const q = catalogQuery(p, { available: true });
    expect(q).toBe("?tri=nouveautes&dispo=1&tag=wax&opt=Taille%3AS");
    const back = parseCatalogParams(Object.fromEntries([...new URLSearchParams(q).entries()].reduce((m, [k, v]) => m.set(k, [...(m.get(k) ?? []), v]), new Map<string, string[]>())));
    expect(back).toMatchObject({ sort: "nouveautes", available: true, tags: ["wax"], options: { Taille: ["S"] }, page: 1 });
    expect(activeFilterCount(back)).toBe(3);
  });
});

describe("applyFilters", () => {
  const base = parseCatalogParams({});
  it("prix, disponibilité, tags", () => {
    expect(applyFilters(all, { ...base, min: 9000 }).map((p) => p.id)).toEqual(["robe", "chemise"]);
    expect(applyFilters(all, { ...base, max: 9000 }).map((p) => p.id)).toEqual(["sac"]);
    expect(applyFilters(all, { ...base, available: true }).map((p) => p.id)).toEqual(["robe", "chemise"]);
    expect(applyFilters(all, { ...base, tags: ["WAX"] }).map((p) => p.id)).toEqual(["robe", "chemise"]);
  });
  it("options : au moins une variante avec la valeur (achetable si « disponible »)", () => {
    expect(applyFilters(all, { ...base, options: { Taille: ["M"] } }).map((p) => p.id)).toEqual(["robe"]);
    expect(applyFilters(all, { ...base, options: { Taille: ["M"] }, available: true })).toEqual([]);
  });
  it("recherche insensible aux accents et à la casse, collection", () => {
    expect(applyFilters(all, { ...base, q: "tisse" }).map((p) => p.id)).toEqual(["sac"]);
    const membership = new Map([["homme", new Set(["chemise"])]]);
    expect(applyFilters(all, { ...base, collection: "homme" }, membership).map((p) => p.id)).toEqual(["chemise"]);
  });
});

describe("tri, facettes, pagination", () => {
  it("trie par prix, nouveauté, ventes et par défaut (mis en avant d'abord)", () => {
    expect(sortProducts(all, "prix-croissant").map((p) => p.id)).toEqual(["sac", "chemise", "robe"]);
    expect(sortProducts(all, "prix-decroissant").map((p) => p.id)).toEqual(["robe", "chemise", "sac"]);
    expect(sortProducts(all, "nouveautes")[0].id).toBe("robe");
    expect(sortProducts(all, "meilleures-ventes")[0].id).toBe("chemise");
    expect(sortProducts(all, "pertinence")[0].id).toBe("sac");
  });
  it("facettes : bornes de prix, tags comptés, options, disponibilité", () => {
    const f = computeFacets(all, [{ handle: "homme", name: "Homme", productIds: ["chemise"] }]);
    expect(f.price).toEqual({ min: 8500, max: 18000 });
    expect(f.tags[0]).toEqual({ value: "wax", count: 2 });
    expect(f.options[0].name).toBe("Taille");
    expect(f.availableCount).toBe(2);
    expect(f.collections).toEqual([{ handle: "homme", name: "Homme", count: 1 }]);
  });
  it("pagination bornée", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pages: 3 });
    expect(paginate([1, 2, 3], 9, 2)).toEqual({ items: [3], page: 2, pages: 2 });
  });
});

describe("collections automatiques", () => {
  it("règles « toutes » et « au moins une »", () => {
    const rules = parseRules({ match: "all", conditions: [{ field: "tag", op: "eq", value: "wax" }, { field: "price", op: "lt", value: 16000 }] })!;
    expect(all.filter((p) => matchesRules(p, rules)).map((p) => p.id)).toEqual(["chemise"]);
    const any = parseRules({ match: "any", conditions: [{ field: "promo", op: "eq", value: true }, { field: "title", op: "contains", value: "sac" }] })!;
    expect(all.filter((p) => matchesRules(p, any)).map((p) => p.id)).toEqual(["chemise", "sac"]);
  });
  it("format écrit par l'éditeur de collections (espace marchand)", () => {
    // { type: "auto", match, conditions } avec field type/promo, op is, valeurs texte
    const r = parseRules({ type: "auto", match: "all", conditions: [{ field: "price", op: "lt", value: "16000" }, { field: "promo", op: "is", value: "true" }] })!;
    const shop = [product({ id: "a", name: "A", price: 9000, compareAt: 12000 }), product({ id: "b", name: "B", price: 9000 }), product({ id: "c", name: "C", price: 20000, compareAt: 25000 })];
    expect(shop.filter((p) => matchesRules(p, r)).map((p) => p.id)).toEqual(["a"]);
    const t = parseRules({ type: "auto", match: "any", conditions: [{ field: "type", op: "eq", value: "robe" }, { field: "tag", op: "neq", value: "x" }] })!;
    expect(matchesRules(product({ id: "d", name: "D", price: 1, productType: "Robe", tags: ["x"] }), t)).toBe(true);
    expect(parseRules({ type: "manual", productIds: ["a"] })).toBeNull();
  });
  it("collection manuelle : liste ordonnée + catégorie principale", () => {
    const items = [{ id: "a", categoryId: null }, { id: "b", categoryId: "col" }, { id: "c", categoryId: null }];
    expect(manualMemberIds({ type: "manual", productIds: ["c", "zz", "a"] }, "col", items)).toEqual(["c", "a", "b"]);
    expect(manualMemberIds(null, "col", items)).toEqual(["b"]);
  });
  it("règles invalides : collection manuelle", () => {
    expect(parseRules(null)).toBeNull();
    expect(parseRules({ conditions: [] })).toBeNull();
    const unknown = parseRules({ conditions: [{ field: "inconnu", op: "eq", value: "x" }] })!;
    expect(all.some((p) => matchesRules(p, unknown))).toBe(false);
  });
});
