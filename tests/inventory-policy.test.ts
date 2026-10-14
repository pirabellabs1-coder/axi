import { describe, it, expect } from "vitest";
import {
  canSell,
  crossesLowStock,
  crossesOversold,
  effectiveLowStockThreshold,
  isBackorder,
  isLowStock,
  isSellable,
  lowStockCrossing,
  oversoldCrossing,
  parseInventoryPolicy,
  policyToCsv,
  schemaAvailability,
  stockState,
  DEFAULT_LOW_STOCK_THRESHOLD,
} from "@/lib/inventory/policy";
import { checkQuantity } from "@/lib/commerce/pricing";
import { restockPlan } from "@/lib/commerce/restock";
import { isPurchasable } from "@/lib/storefront/variants";

describe("politique de rupture (DENY / CONTINUE)", () => {
  it("DENY refuse au-delà du stock, CONTINUE autorise (précommande)", () => {
    expect(canSell({ trackStock: true, stock: 2, policy: "DENY" }, 3)).toBe(false);
    expect(canSell({ trackStock: true, stock: 2, policy: "DENY" }, 2)).toBe(true);
    expect(canSell({ trackStock: true, stock: 0, policy: "CONTINUE" }, 5)).toBe(true);
    expect(canSell({ trackStock: true, stock: -3, policy: "CONTINUE" }, 1)).toBe(true);
    expect(canSell({ trackStock: false, stock: 0, policy: "DENY" }, 99)).toBe(true);
  });

  it("précommande = suivi + CONTINUE + stock insuffisant", () => {
    expect(isBackorder({ trackStock: true, stock: 0, policy: "CONTINUE" })).toBe(true);
    expect(isBackorder({ trackStock: true, stock: 2, policy: "CONTINUE" }, 3)).toBe(true);
    expect(isBackorder({ trackStock: true, stock: 2, policy: "CONTINUE" }, 2)).toBe(false);
    expect(isBackorder({ trackStock: true, stock: 0, policy: "DENY" })).toBe(false);
    expect(isBackorder({ trackStock: false, stock: 0, policy: "CONTINUE" })).toBe(false);
    expect(isSellable({ trackStock: true, stock: 0, policy: "DENY" })).toBe(false);
  });

  it("checkQuantity : le contrôle de stock est levé en CONTINUE, pas les min/max", () => {
    const base = { name: "Robe", minQty: 1, maxQty: 5, trackStock: true, stock: 0 };
    expect(checkQuantity({ ...base, inventoryPolicy: "DENY" }, 1)).toMatch(/épuisé/);
    expect(checkQuantity({ ...base }, 1)).toMatch(/épuisé/); // défaut = DENY
    expect(checkQuantity({ ...base, inventoryPolicy: "CONTINUE" }, 3)).toBeNull();
    expect(checkQuantity({ ...base, inventoryPolicy: "CONTINUE" }, 6)).toMatch(/Maximum 5/);
  });

  it("vitrine : une variante en rupture avec CONTINUE reste achetable (non barrée)", () => {
    const v = (stock: number, policy: string) => ({ id: "v", attributes: {}, stock, available: true, inStock: isSellable({ trackStock: true, stock, policy }) });
    expect(isPurchasable(v(0, "CONTINUE"), true)).toBe(true);
    expect(isPurchasable(v(0, "DENY"), true)).toBe(false);
    expect(isPurchasable({ ...v(0, "CONTINUE"), available: false }, true)).toBe(false);
  });

  it("états marchand : survente > précommande > rupture > stock bas", () => {
    expect(stockState({ trackStock: true, stock: -2, policy: "CONTINUE" }, 5)).toBe("oversold");
    expect(stockState({ trackStock: true, stock: 0, policy: "CONTINUE" }, 5)).toBe("backorder");
    expect(stockState({ trackStock: true, stock: 0, policy: "DENY" }, 5)).toBe("out");
    expect(stockState({ trackStock: true, stock: 5, policy: "DENY" }, 5)).toBe("low");
    expect(stockState({ trackStock: true, stock: 6, policy: "DENY" }, 5)).toBe("in_stock");
    expect(stockState({ trackStock: false, stock: 0 }, 5)).toBe("untracked");
  });

  it("schema.org : BackOrder si seule la précommande est possible", () => {
    expect(schemaAvailability({ sellable: true, backorder: false })).toBe("https://schema.org/InStock");
    expect(schemaAvailability({ sellable: true, backorder: true })).toBe("https://schema.org/BackOrder");
    expect(schemaAvailability({ sellable: false, backorder: false })).toBe("https://schema.org/OutOfStock");
  });

  it("CSV : valeurs Shopify deny / continue (et variantes françaises)", () => {
    expect(parseInventoryPolicy("continue")).toBe("CONTINUE");
    expect(parseInventoryPolicy("DENY")).toBe("DENY");
    expect(parseInventoryPolicy("oui")).toBe("CONTINUE");
    expect(parseInventoryPolicy("")).toBeNull();
    expect(parseInventoryPolicy("peut-être")).toBeNull();
    expect(policyToCsv("CONTINUE")).toBe("continue");
    expect(policyToCsv(undefined)).toBe("deny");
  });
});

describe("seuil « stock bas » : produit, sinon boutique", () => {
  it("le seuil du produit prime sur celui de la boutique, puis le défaut (5)", () => {
    expect(effectiveLowStockThreshold(2, 10)).toBe(2);
    expect(effectiveLowStockThreshold(0, 10)).toBe(0);
    expect(effectiveLowStockThreshold(null, 10)).toBe(10);
    expect(effectiveLowStockThreshold(undefined, null)).toBe(DEFAULT_LOW_STOCK_THRESHOLD);
    expect(DEFAULT_LOW_STOCK_THRESHOLD).toBe(5);
  });

  it("stock bas = stock ≤ seuil effectif (ruptures et surventes comprises)", () => {
    const item = { trackStock: true, stock: 3 };
    expect(isLowStock(item, effectiveLowStockThreshold(2, 10))).toBe(false); // seuil produit 2
    expect(isLowStock(item, effectiveLowStockThreshold(null, 10))).toBe(true); // seuil boutique 10
    expect(isLowStock({ trackStock: true, stock: -1 }, 0)).toBe(true);
    expect(isLowStock({ trackStock: false, stock: 0 }, 5)).toBe(false);
  });
});

describe("franchissements de seuil : une seule alerte par passage", () => {
  it("franchissement simple (au-dessus → au plus le seuil) et passage en négatif", () => {
    expect(crossesLowStock(6, 5, 5)).toBe(true);
    expect(crossesLowStock(5, 4, 5)).toBe(false); // déjà sous le seuil
    expect(crossesLowStock(4, 8, 5)).toBe(false);
    expect(crossesOversold(1, -1)).toBe(true);
    expect(crossesOversold(-1, -2)).toBe(false);
  });

  it("la clé reste celle du mouvement de franchissement tant que le stock reste bas", () => {
    // Historique (du plus récent au plus ancien) : +10 initial, vente -6 (→4, franchit 5), vente -1 (→3).
    const after1 = [{ id: "m_sale6", delta: -6 }, { id: "m_init", delta: 10 }];
    expect(lowStockCrossing(4, after1, 5)).toBe("m_sale6");
    const after2 = [{ id: "m_sale1", delta: -1 }, ...after1];
    expect(lowStockCrossing(3, after2, 5)).toBe("m_sale6"); // même clé → pas de 2e alerte
  });

  it("un réassort au-dessus du seuil réarme l'alerte (nouvelle clé au prochain passage)", () => {
    const h = [{ id: "m_sale6", delta: -6 }, { id: "m_init", delta: 10 }];
    const restocked = [{ id: "m_restock", delta: 10 }, ...h]; // 14
    expect(lowStockCrossing(14, restocked, 5)).toBeNull();
    const again = [{ id: "m_sale10", delta: -10 }, ...restocked]; // 4
    expect(lowStockCrossing(4, again, 5)).toBe("m_sale10");
  });

  it("sans passage identifiable (créé sous le seuil, seuil relevé, historique tronqué) : pas d'alerte", () => {
    expect(lowStockCrossing(2, [{ id: "m_init", delta: 2 }], 5)).toBeNull();
    expect(lowStockCrossing(2, [{ id: "m_sale", delta: -1 }], 5)).toBeNull(); // 3 → 2 : déjà sous 5
    expect(lowStockCrossing(2, [], 5)).toBeNull();
  });

  it("survente : clé du mouvement qui a rendu le stock négatif", () => {
    const h = [{ id: "m_sale2", delta: -2 }, { id: "m_sale3", delta: -3 }, { id: "m_init", delta: 4 }]; // 4 → 1 → -1
    expect(oversoldCrossing(-1, h)).toBe("m_sale2");
    expect(oversoldCrossing(1, h.slice(1))).toBeNull();
  });
});

describe("annulation : restock à partir des mouvements de la commande", () => {
  it("rend les quantités vendues (survente comprise), net des restocks déjà faits", () => {
    const plan = restockPlan([
      { productId: "p1", variantId: "v1", delta: -3 },
      { productId: "p1", variantId: "v1", delta: -1 },
      { productId: "p2", variantId: null, delta: -2 },
      { productId: "p2", variantId: null, delta: 2 },
    ]);
    expect(plan).toEqual([{ productId: "p1", variantId: "v1", quantity: 4 }]);
  });

  it("aucun mouvement (stock non suivi à la vente) : rien à rendre", () => {
    expect(restockPlan([])).toEqual([]);
  });
});
