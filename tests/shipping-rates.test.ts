import { describe, it, expect } from "vitest";
import { chooseShippingFee, missingWeightWarning, orderWeightGrams, quoteRates, rateMatches, ratePrice, type ShippingRateLike } from "@/lib/shipping/rates";

/** Tarifs d'expédition (lot 3 §1.2) : poids, montant, seuils et repli sur le forfait de zone. */

const rate = (over: Partial<ShippingRateLike> = {}): ShippingRateLike => ({ id: "r1", name: "Standard", price: 1_000, ...over });

describe("orderWeightGrams", () => {
  it("additionne poids × quantité, la variante primant sur le produit", () => {
    const r = orderWeightGrams([
      { quantity: 2, variantWeightGrams: 500, productWeightGrams: 900 },
      { quantity: 3, productWeightGrams: 100 },
    ]);
    expect(r.grams).toBe(1_300);
    expect(r.missingWeight).toBe(0);
  });

  it("signale les articles sans poids sans bloquer la vente", () => {
    const r = orderWeightGrams([{ quantity: 2 }, { quantity: 1, productWeightGrams: 250 }]);
    expect(r.grams).toBe(250);
    expect(r.missingWeight).toBe(2);
    expect(missingWeightWarning(r.missingWeight)).toMatch(/sans poids/);
  });

  it("ignore les lignes non expédiables (numérique, carte cadeau) et les quantités invalides", () => {
    const r = orderWeightGrams([
      { quantity: 1, productWeightGrams: 800, shippable: false },
      { quantity: -3, productWeightGrams: 800 },
    ]);
    expect(r.grams).toBe(0);
    expect(r.missingWeight).toBe(0);
    expect(missingWeightWarning(0)).toBeNull();
  });
});

describe("rateMatches", () => {
  it("bornes de poids incluses des deux côtés", () => {
    const r = rate({ minWeightGrams: 1_000, maxWeightGrams: 5_000 });
    expect(rateMatches(r, { weightGrams: 1_000, subtotalNet: 0 })).toBe(true);
    expect(rateMatches(r, { weightGrams: 5_000, subtotalNet: 0 })).toBe(true);
    expect(rateMatches(r, { weightGrams: 999, subtotalNet: 0 })).toBe(false);
    expect(rateMatches(r, { weightGrams: 5_001, subtotalNet: 0 })).toBe(false);
  });

  it("bornes de montant incluses des deux côtés", () => {
    const r = rate({ minSubtotal: 10_000, maxSubtotal: 50_000 });
    expect(rateMatches(r, { weightGrams: 0, subtotalNet: 10_000 })).toBe(true);
    expect(rateMatches(r, { weightGrams: 0, subtotalNet: 50_000 })).toBe(true);
    expect(rateMatches(r, { weightGrams: 0, subtotalNet: 9_999 })).toBe(false);
  });

  it("un tarif inactif ne s'applique jamais", () => {
    expect(rateMatches(rate({ active: false }), { weightGrams: 0, subtotalNet: 0 })).toBe(false);
  });

  it("sans borne, le tarif s'applique toujours", () => {
    expect(rateMatches(rate(), { weightGrams: 999_999, subtotalNet: 0 })).toBe(true);
  });
});

describe("ratePrice", () => {
  it("livraison offerte au-dessus du seuil (seuil inclus)", () => {
    const r = rate({ price: 1_500, freeAbove: 20_000 });
    expect(ratePrice(r, 19_999)).toBe(1_500);
    expect(ratePrice(r, 20_000)).toBe(0);
  });

  it("jamais de prix négatif", () => {
    expect(ratePrice(rate({ price: -50 }), 0)).toBe(0);
  });
});

describe("quoteRates", () => {
  it("trie du moins cher au plus cher et marque la livraison offerte", () => {
    const quotes = quoteRates(
      [rate({ id: "a", name: "Express", price: 3_000 }), rate({ id: "b", name: "Standard", price: 1_000, freeAbove: 25_000 })],
      { weightGrams: 500, subtotalNet: 30_000 },
    );
    expect(quotes.map((q) => q.id)).toEqual(["b", "a"]);
    expect(quotes[0]).toMatchObject({ price: 0, free: true });
  });

  it("n'expose que les tarifs applicables", () => {
    const quotes = quoteRates([rate({ id: "a", maxWeightGrams: 1_000 }), rate({ id: "b", minWeightGrams: 2_000 })], { weightGrams: 2_500, subtotalNet: 0 });
    expect(quotes.map((q) => q.id)).toEqual(["b"]);
  });

  it("départage les prix égaux par la position puis le nom (déterministe)", () => {
    const quotes = quoteRates(
      [rate({ id: "a", name: "Zèbre", position: 2 }), rate({ id: "b", name: "Abeille", position: 1 })],
      { weightGrams: 0, subtotalNet: 0 },
    );
    expect(quotes.map((q) => q.id)).toEqual(["b", "a"]);
  });
});

describe("chooseShippingFee", () => {
  const zone = { fee: 2_000, freeAbove: 50_000, etaLabel: "Sous 24 h", name: "Cotonou" };

  it("retient le tarif applicable le moins cher", () => {
    const choice = chooseShippingFee([rate({ id: "a", price: 1_200 }), rate({ id: "b", price: 800 })], zone, { weightGrams: 300, subtotalNet: 10_000 });
    expect(choice).toMatchObject({ fee: 800, rateId: "b", source: "rate" });
  });

  it("respecte un tarif choisi explicitement par l'acheteur", () => {
    const choice = chooseShippingFee([rate({ id: "a", price: 1_200 }), rate({ id: "b", price: 800 })], zone, { weightGrams: 300, subtotalNet: 10_000 }, "a");
    expect(choice.rateId).toBe("a");
    expect(choice.fee).toBe(1_200);
  });

  it("aucun tarif applicable : repli sur le forfait de la zone", () => {
    const choice = chooseShippingFee([rate({ minWeightGrams: 10_000 })], zone, { weightGrams: 300, subtotalNet: 10_000 });
    expect(choice).toMatchObject({ fee: 2_000, rateId: null, source: "zone" });
  });

  it("repli sur la zone : le seuil de gratuité de la zone s'applique", () => {
    const choice = chooseShippingFee([], zone, { weightGrams: 300, subtotalNet: 60_000 });
    expect(choice.fee).toBe(0);
  });
});
