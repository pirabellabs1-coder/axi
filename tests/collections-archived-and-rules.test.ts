import { describe, it, expect } from "vitest";
import { isOnSale, matchesRules, mergeArchivedMembers, minEffectivePrice, type AutoRules, type RuleProduct } from "@/lib/collections/rules";
import { matchesRules as storefrontMatches } from "@/lib/storefront/catalog";
import type { CardProduct } from "@/lib/storefront/render-types";

describe("collection manuelle : membres archivés conservés (constat 3)", () => {
  it("ajoute en fin de liste les archivés déjà membres que l'éditeur ne montre pas", () => {
    const previous = ["a", "arch1", "b", "arch2"];
    const archived = new Set(["arch1", "arch2"]);
    // L'éditeur n'envoie que les produits non archivés, réordonnés, « a » retiré.
    expect(mergeArchivedMembers(["b", "c"], previous, archived)).toEqual(["b", "c", "arch1", "arch2"]);
  });

  it("ne duplique pas un archivé déjà envoyé et ne ressuscite pas un non-archivé retiré", () => {
    expect(mergeArchivedMembers(["arch1", "b", "b"], ["a", "arch1"], new Set(["arch1"]))).toEqual(["arch1", "b"]);
  });

  it("n'ajoute pas un archivé qui n'était pas membre", () => {
    expect(mergeArchivedMembers(["b"], ["b"], new Set(["arch9"]))).toEqual(["b"]);
  });
});

describe("collections auto : même sémantique admin et boutique (constat 11)", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const base: RuleProduct = { id: "p", name: "Robe", price: 20000, tags: [] };

  it("prix = prix effectif minimum (variantes comprises)", () => {
    const p: RuleProduct = { ...base, variants: [{ price: 18000, compareAtPrice: null }, { price: null, compareAtPrice: null }] };
    expect(minEffectivePrice(p, now)).toBe(18000);
    const promo: RuleProduct = { ...base, promoPrice: 15000, variants: [{ price: null, compareAtPrice: null }] };
    expect(minEffectivePrice(promo, now)).toBe(15000);
    const lt: AutoRules = { type: "auto", match: "all", conditions: [{ field: "price", op: "lt", value: "19000" }] };
    expect(matchesRules(p, lt, now)).toBe(true);
    expect(matchesRules(base, lt, now)).toBe(false);
  });

  it("promo = promo active, prix barré produit ou prix barré d'une variante", () => {
    expect(isOnSale(base, now)).toBe(false);
    expect(isOnSale({ ...base, compareAtPrice: 25000 }, now)).toBe(true);
    expect(isOnSale({ ...base, variants: [{ price: 18000, compareAtPrice: 22000 }] }, now)).toBe(true);
    expect(isOnSale({ ...base, variants: [{ price: 18000, compareAtPrice: 18000 }] }, now)).toBe(false);
  });

  it("la boutique utilise l'indicateur onSale (variante en promo non la moins chère)", () => {
    const card = { id: "p", name: "Robe", tags: [], price: 15000, compareAt: null, onSale: true, soldOut: false } as unknown as CardProduct;
    const rules = { match: "all" as const, conditions: [{ field: "promo", op: "eq", value: "true" }] };
    expect(storefrontMatches(card, rules as Parameters<typeof storefrontMatches>[1])).toBe(true);
    expect(storefrontMatches({ ...card, onSale: false }, rules as Parameters<typeof storefrontMatches>[1])).toBe(false);
  });
});
