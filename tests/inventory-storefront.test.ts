import { describe, it, expect, vi } from "vitest";

/** Vitrine : une rupture vendue en « continuer à vendre » est affichée « Précommande », jamais « Épuisé ». */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { toCardProduct } from "@/lib/theme-engine/resolve";

type Row = Parameters<typeof toCardProduct>[0];
type VariantRow = Row["variants"][number];
const now = new Date("2026-10-11T10:00:00Z");

function row(over: Omit<Partial<Row>, "variants"> & { variants?: Partial<VariantRow>[] } = {}): Row {
  const { variants = [], ...rest } = over;
  return {
    id: "prod_1", storeId: "s", categoryId: null, name: "Robe", slug: "robe", description: null, status: "ACTIVE", price: 15000, compareAtPrice: null, promoPrice: null, promoStart: null, promoEnd: null,
    costPrice: null, sku: null, barcode: null, trackStock: true, stock: 0, inventoryPolicy: "DENY", lowStockThreshold: null, minQty: 1, maxQty: null, weightGrams: null, isFeatured: false, position: 0,
    images: [], options: null, tags: [], vendor: null, productType: null, seoTitle: null, seoDescription: null, details: null, createdAt: now, updatedAt: now,
    _count: { optionGroups: 0 },
    ...rest,
    variants: variants.map((v, i): VariantRow => {
      const base: VariantRow = {
        id: `var_${i}`, productId: "prod_1", name: `V${i}`, attributes: { Taille: `T${i}` }, price: null, compareAtPrice: null, sku: null, barcode: null, weightGrams: null, imageUrl: null,
        available: true, stock: 0, inventoryPolicy: "DENY", position: i,
      };
      return { ...base, ...v };
    }),
  } as Row;
}

describe("carte produit : précommande", () => {
  it("produit simple à zéro en CONTINUE : achetable, badge précommande, pas épuisé", () => {
    const c = toCardProduct(row({ stock: 0, inventoryPolicy: "CONTINUE" }), now);
    expect(c.soldOut).toBe(false);
    expect(c.preorder).toBe(true);
  });

  it("produit simple à zéro en DENY : épuisé", () => {
    const c = toCardProduct(row({ stock: 0 }), now);
    expect(c.soldOut).toBe(true);
    expect(c.preorder).toBe(false);
  });

  it("variante à zéro en CONTINUE : achetable (non barrée dans les filtres d'options)", () => {
    const c = toCardProduct(row({ variants: [{ stock: 0, inventoryPolicy: "CONTINUE" }, { stock: 0 }] }), now);
    expect(c.soldOut).toBe(false);
    expect(c.preorder).toBe(true);
    expect(c.variants.map((v) => v.purchasable)).toEqual([true, false]);
  });

  it("une variante en stock suffit : pas de badge précommande", () => {
    const c = toCardProduct(row({ variants: [{ stock: 0, inventoryPolicy: "CONTINUE" }, { stock: 3 }] }), now);
    expect(c.soldOut).toBe(false);
    expect(c.preorder).toBe(false);
  });

  it("variante désactivée : jamais achetable, même en CONTINUE", () => {
    const c = toCardProduct(row({ variants: [{ stock: 0, inventoryPolicy: "CONTINUE", available: false }] }), now);
    expect(c.soldOut).toBe(true);
  });
});
