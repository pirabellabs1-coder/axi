import { describe, it, expect } from "vitest";
import { describeRules, matchesRules, readRules, resolveCollection, rulesSchema, type RuleProduct } from "@/lib/collections/rules";

const now = new Date("2026-10-11T12:00:00Z");
const p = (id: string, over: Partial<RuleProduct> = {}): RuleProduct => ({ id, name: `Produit ${id}`, price: 10000, tags: [], createdAt: new Date(`2026-01-0${id.length}T00:00:00Z`), position: 0, ...over });

const products: RuleProduct[] = [
  p("a", { name: "Robe wax Abomey", price: 15000, tags: ["wax", "Femme"], createdAt: new Date("2026-03-01") }),
  p("b", { name: "Chemise wax", price: 8000, tags: ["WAX"], promoPrice: 6000, createdAt: new Date("2026-05-01") }),
  p("c", { name: "Sac cuir", price: 25000, tags: ["cuir"], vendor: "Atelier Dah", createdAt: new Date("2026-02-01") }),
  p("d", { name: "Collier perles", price: 4000, tags: [], compareAtPrice: 5000, productType: "Bijou", categoryId: "col1", createdAt: new Date("2026-04-01") }),
];

describe("collections automatiques", () => {
  it("étiquette égale (insensible à la casse)", () => {
    const r = { type: "auto" as const, match: "all" as const, conditions: [{ field: "tag" as const, op: "eq" as const, value: "wax" }] };
    expect(products.filter((x) => matchesRules(x, r, now)).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("prix inférieur / supérieur utilise le prix promo en cours", () => {
    const lt = { type: "auto" as const, match: "all" as const, conditions: [{ field: "price" as const, op: "lt" as const, value: "7000" }] };
    expect(products.filter((x) => matchesRules(x, lt, now)).map((x) => x.id)).toEqual(["b", "d"]);
    const gt = { type: "auto" as const, match: "all" as const, conditions: [{ field: "price" as const, op: "gt" as const, value: "10000" }] };
    expect(products.filter((x) => matchesRules(x, gt, now)).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("en promotion, titre contient, toutes vs une des conditions", () => {
    const promo = { type: "auto" as const, match: "all" as const, conditions: [{ field: "promo" as const, op: "is" as const, value: "true" }] };
    expect(products.filter((x) => matchesRules(x, promo, now)).map((x) => x.id)).toEqual(["b", "d"]);
    const all = { type: "auto" as const, match: "all" as const, conditions: [{ field: "title" as const, op: "contains" as const, value: "WAX" }, { field: "price" as const, op: "gt" as const, value: "10000" }] };
    expect(products.filter((x) => matchesRules(x, all, now)).map((x) => x.id)).toEqual(["a"]);
    const any = { ...all, match: "any" as const };
    expect(products.filter((x) => matchesRules(x, any, now)).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(describeRules(all)).toBe("Titre contient WAX et Prix est supérieur à 10000");
  });

  it("une promo expirée ne compte pas", () => {
    const expired = p("e", { price: 9000, promoPrice: 5000, promoEnd: new Date("2026-01-01") });
    const promo = { type: "auto" as const, match: "all" as const, conditions: [{ field: "promo" as const, op: "is" as const, value: "true" }] };
    expect(matchesRules(expired, promo, now)).toBe(false);
  });

  it("tri : prix, nouveautés, alphabétique, meilleures ventes", () => {
    const r = { type: "auto" as const, match: "any" as const, conditions: [{ field: "price" as const, op: "gt" as const, value: "0" }] };
    expect(resolveCollection("x", r, "price_asc", products, { now }).map((x) => x.id)).toEqual(["d", "b", "a", "c"]);
    expect(resolveCollection("x", r, "newest", products, { now }).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
    expect(resolveCollection("x", r, "alpha", products, { now }).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
    expect(resolveCollection("x", r, "best_selling", products, { now, sales: new Map([["c", 9], ["a", 2]]) }).map((x) => x.id).slice(0, 2)).toEqual(["c", "a"]);
  });
});

describe("collections manuelles", () => {
  it("membres = liste ordonnée + catégorie principale", () => {
    const rules = { type: "manual" as const, productIds: ["c", "a"] };
    expect(resolveCollection("col1", rules, "manual", products, { now }).map((x) => x.id)).toEqual(["c", "a", "d"]);
  });

  it("lecture tolérante des règles en base et validation", () => {
    expect(readRules(null)).toEqual({ type: "manual", productIds: [] });
    expect(readRules({ match: "any", conditions: [{ field: "tag", op: "eq", value: "wax" }] }).type).toBe("auto");
    expect(readRules({ type: "manual", productIds: ["a", 3] })).toEqual({ type: "manual", productIds: ["a"] });
    expect(rulesSchema.safeParse({ type: "auto", match: "all", conditions: [] }).success).toBe(false);
    // Format du rendu boutique (storefront/catalog.ts) : alias et valeurs non textuelles
    expect(readRules({ match: "all", conditions: [{ field: "productType", op: "equals", value: "Robe" }, { field: "price", op: "less_than", value: 16000 }, { field: "compareAt", op: "eq", value: true }] })).toEqual({
      type: "auto",
      match: "all",
      conditions: [
        { field: "type", op: "eq", value: "Robe" },
        { field: "price", op: "lt", value: "16000" },
        { field: "promo", op: "is", value: "true" },
      ],
    });
    expect(rulesSchema.safeParse({ type: "auto", match: "all", conditions: [{ field: "price", op: "contains", value: "x" }] }).success).toBe(false);
    expect(rulesSchema.safeParse({ type: "auto", match: "all", conditions: [{ field: "price", op: "lt", value: "5000" }] }).success).toBe(true);
  });
});
