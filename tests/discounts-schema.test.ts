import { describe, it, expect } from "vitest";
import { parseDiscountConfig, readDiscountConfig, configReferences } from "@/lib/discounts/schema";

const ok = (kind: string, config: unknown) => parseDiscountConfig(kind, config).ok;

describe("schéma des remises automatiques", () => {
  it("accepte les 4 types valides et applique les défauts (excludeOnSale vrai)", () => {
    const pa = parseDiscountConfig("PRODUCT_AMOUNT", { target: { collectionIds: ["col_wax01"] }, value: { type: "PERCENT", amount: 15 } });
    expect(pa.ok).toBe(true);
    if (pa.ok && pa.value.kind === "PRODUCT_AMOUNT") {
      expect(pa.value.config.excludeOnSale).toBe(true);
      expect(pa.value.config.perUnit).toBe(false);
    }
    const bx = parseDiscountConfig("BUY_X_GET_Y", { buy: { target: { all: true }, quantity: 2 }, get: { target: { all: true }, quantity: 1, value: { type: "PERCENT", amount: 100 } } });
    expect(bx.ok).toBe(true);
    if (bx.ok && bx.value.kind === "BUY_X_GET_Y") expect(bx.value.config.maxApplicationsPerOrder).toBe(1);
    expect(ok("CART_TIER", { tiers: [{ minSubtotal: 20000, value: { type: "PERCENT", amount: 5 } }, { minSubtotal: 50000, value: { type: "FREE_DELIVERY" } }] })).toBe(true);
    expect(ok("BUNDLE", { items: [{ productId: "prod_a0001", quantity: 1 }, { productId: "prod_b0001", quantity: 2 }], price: { type: "FIXED_PRICE", amount: 15000 } })).toBe(true);
  });

  it("refuse un type inconnu ou une configuration d'un autre type", () => {
    expect(ok("FOO", {})).toBe(false);
    expect(ok("CART_TIER", { target: { all: true }, value: { type: "PERCENT", amount: 10 } })).toBe(false);
  });

  it("refuse les pourcentages hors 1..100 et les montants nuls", () => {
    expect(ok("PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount: 0 } })).toBe(false);
    expect(ok("PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount: 120 } })).toBe(false);
    expect(ok("PRODUCT_AMOUNT", { target: { all: true }, value: { type: "FIXED_AMOUNT", amount: 0 } })).toBe(false);
    expect(ok("PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount: 10.5 } })).toBe(false);
  });

  it("refuse une cible vide, ambiguë ou des clés inconnues (union stricte)", () => {
    expect(ok("PRODUCT_AMOUNT", { target: { productIds: [] }, value: { type: "PERCENT", amount: 10 } })).toBe(false);
    expect(ok("PRODUCT_AMOUNT", { target: { all: true, productIds: ["x"] }, value: { type: "PERCENT", amount: 10 } })).toBe(false);
    expect(ok("PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount: 10 }, hack: 1 })).toBe(false);
  });

  it("paliers : 1 à 5, strictement croissants", () => {
    expect(ok("CART_TIER", { tiers: [] })).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ minSubtotal: (i + 1) * 1000, value: { type: "PERCENT", amount: 5 } }));
    expect(ok("CART_TIER", { tiers: six })).toBe(false);
    const r = parseDiscountConfig("CART_TIER", { tiers: [{ minSubtotal: 50000, value: { type: "PERCENT", amount: 10 } }, { minSubtotal: 20000, value: { type: "PERCENT", amount: 5 } }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/croissants/);
  });

  it("X achetés = Y offerts : quantités et applications bornées", () => {
    const base = { buy: { target: { all: true }, quantity: 2 }, get: { target: { all: true }, quantity: 1, value: { type: "PERCENT", amount: 100 } } };
    expect(ok("BUY_X_GET_Y", { ...base, maxApplicationsPerOrder: 0 })).toBe(false);
    expect(ok("BUY_X_GET_Y", { ...base, maxApplicationsPerOrder: 21 })).toBe(false);
    expect(ok("BUY_X_GET_Y", { ...base, buy: { target: { all: true }, quantity: 0 } })).toBe(false);
    expect(ok("BUY_X_GET_Y", { ...base, buy: { target: { all: true }, minAmount: 10000 } })).toBe(true);
  });

  it("lot : 2 à 6 produits, 1 à 10 lots, pas de doublon", () => {
    const item = (id: string) => ({ productId: id, quantity: 1 });
    expect(ok("BUNDLE", { items: [item("prod_a0001")], price: { type: "FIXED_PRICE", amount: 1000 } })).toBe(false);
    expect(ok("BUNDLE", { items: ["a", "b", "c", "d", "e", "f", "g"].map((x) => item(`prod_${x}0001`)), price: { type: "FIXED_PRICE", amount: 1000 } })).toBe(false);
    expect(ok("BUNDLE", { items: [item("prod_a0001"), item("prod_a0001")], price: { type: "FIXED_PRICE", amount: 1000 } })).toBe(false);
    expect(ok("BUNDLE", { items: [item("prod_a0001"), item("prod_b0001")], price: { type: "FIXED_PRICE", amount: 1000 }, maxSets: 11 })).toBe(false);
  });

  it("lecture tolérante : null pour une configuration stockée invalide", () => {
    expect(readDiscountConfig("PRODUCT_AMOUNT", { nope: true })).toBeNull();
    expect(readDiscountConfig("PRODUCT_AMOUNT", null)).toBeNull();
  });

  it("références extraites pour la vérification d'appartenance à la boutique", () => {
    const r = parseDiscountConfig("BUNDLE", { items: [{ productId: "prod_a0001", variantId: "var_a0001", quantity: 1 }, { productId: "prod_b0001", quantity: 1 }], price: { type: "PERCENT", amount: 20 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(configReferences(r.value)).toEqual({ productIds: ["prod_a0001", "prod_b0001"], collectionIds: [], variantIds: ["var_a0001"] });
  });
});
