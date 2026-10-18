import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Import des commandes TikTok Shop : montants tels que payés (multi-devises), idempotence (pas de double import ni
 * double décrément), stock, lignes non reliées, expédition par TikTok, annulation, isolation entre boutiques.
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})), queueNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/webhooks/emit", () => ({ emitDomainEvent: vi.fn(async () => ({ eventId: "evt" })) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/commerce/orders", () => ({ transitionOrder: vi.fn(async () => ({})) }));
vi.mock("@/lib/currency/rates", () => ({ loadPlatformRates: vi.fn(async () => [{ base: "EUR", quote: "USD", rate: "1.08", source: "ECB", fetchedAt: new Date() }]) }));
vi.mock("@/lib/inventory/order-levels", () => ({ planOrderAllocation: vi.fn(async () => ({ allocations: [], defaultLocationId: null })) }));

import { importTiktokOrder } from "@/lib/tiktok-shop/orders";
import { planOrder, usablePhone, matchShippingProvider } from "@/lib/tiktok-shop/order-plan";
import { readConfig } from "@/lib/tiktok-shop/model";
import { enqueue } from "@/lib/jobs";
import { transitionOrder } from "@/lib/commerce/orders";
import { ONE } from "@/lib/currency/convert";
import type { TiktokOrder } from "@/lib/tiktok-shop/types";

const A = "store_A_0001";
const B = "store_B_0001";

const configA = readConfig({
  shop: { id: "7494", name: "Shop FR", region: "FR", cipher: "c", currency: "EUR" },
  warehouseId: "WH1",
  products: {
    prod_A_0001: { categoryId: "601226", categoryName: "Robes", tiktokProductId: "17001", skus: { var_A_0001: "SKU_M", var_A_0002: "SKU_L" }, status: "ACTIVATE" },
    prod_A_0002: { categoryId: "601226", categoryName: "Robes", tiktokProductId: "17002", skus: { _: "SKU_SIMPLE" }, status: "ACTIVATE" },
    // Lien corrompu pointant vers un produit d'une AUTRE boutique : ne doit jamais être touché.
    prod_B_0001: { categoryId: "601226", categoryName: "x", tiktokProductId: "17003", skus: { _: "SKU_FOREIGN" }, status: "ACTIVATE" },
  },
});

function seed() {
  return createFakeDb({
    store: [
      { id: A, slug: "a", name: "A", currency: "XOF", country: "BJ", status: "PUBLISHED" },
      { id: B, slug: "b", name: "B", currency: "XOF", country: "BJ", status: "PUBLISHED" },
    ],
    product: [
      { id: "prod_A_0001", storeId: A, name: "Robe", status: "ACTIVE", kind: "PHYSICAL", isGiftCard: false, trackStock: true, stock: 0, taxable: true, taxCategory: "standard" },
      { id: "prod_A_0002", storeId: A, name: "Sac", status: "ACTIVE", kind: "PHYSICAL", isGiftCard: false, trackStock: true, stock: 5, taxable: true, taxCategory: "standard" },
      { id: "prod_B_0001", storeId: B, name: "Autre", status: "ACTIVE", kind: "PHYSICAL", isGiftCard: false, trackStock: true, stock: 7, taxable: true, taxCategory: "standard" },
    ],
    variant: [
      { id: "var_A_0001", productId: "prod_A_0001", name: "M", stock: 3 },
      { id: "var_A_0002", productId: "prod_A_0002", name: "L", stock: 1 }, // variante d'un autre produit : lien incohérent
    ],
  });
}

function order(over: Partial<TiktokOrder> = {}): TiktokOrder {
  return {
    id: "576000000000000001",
    status: "AWAITING_SHIPMENT",
    createTime: 1_700_000_000,
    updateTime: 1_700_000_100,
    fulfillmentType: "FULFILLMENT_BY_SELLER",
    shippingType: "SELLER",
    deliveryOptionId: "DO1",
    buyerMessage: null,
    payment: { currency: "EUR", subTotal: "45.74", shippingFee: "4.99", sellerDiscount: "0", platformDiscount: "3.00", tax: "0", totalAmount: "47.73" },
    recipient: { name: "Awa K.", phone: "(+33)612345678", fullAddress: "10 rue X, 75011 Paris", regionCode: "FR" },
    lineItems: [
      { id: "li1", skuId: "SKU_M", productId: "17001", sellerSku: "AXI-var_A_0001", productName: "Robe", skuName: "M", salePrice: "22.87", originalPrice: "22.87", currency: "EUR" },
      { id: "li2", skuId: "SKU_M", productId: "17001", sellerSku: "AXI-var_A_0001", productName: "Robe", skuName: "M", salePrice: "22.87", originalPrice: "22.87", currency: "EUR" },
    ],
    ...over,
  };
}

const t = (): Record<string, any[]> => state.fake!.tables as any;

beforeEach(() => {
  state.fake = seed();
  vi.mocked(enqueue).mockClear();
  vi.mocked(transitionOrder).mockClear();
});

describe("planOrder (pur)", () => {
  it("regroupe les unités par SKU et dérive remise et total payés", () => {
    const p = planOrder(order(), { storeCurrency: "EUR", region: "FR", resolveSku: () => null, rate: ONE });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ quantity: 2, unitPrice: 2287, lineItemIds: ["li1", "li2"] });
    expect(p).toMatchObject({ subtotal: 4574, deliveryFee: 499, discount: 300, total: 4773, taxesIncluded: true, presentment: null });
    expect(p.subtotal - p.discount + p.deliveryFee).toBe(p.total);
  });
  it("US : taxe en sus incluse dans l'invariant", () => {
    const p = planOrder(order({ payment: { currency: "USD", subTotal: "20.00", shippingFee: "0", sellerDiscount: "0", platformDiscount: "0", tax: "1.60", totalAmount: "21.60" }, lineItems: [{ ...order().lineItems[0], salePrice: "20.00", currency: "USD" }] }), {
      storeCurrency: "USD",
      region: "US",
      resolveSku: () => null,
      rate: ONE,
    });
    expect(p).toMatchObject({ subtotal: 2000, taxTotal: 160, taxesIncluded: false, discount: 0, deliveryFee: 0, total: 2160 });
  });
  it("téléphone masqué rejeté ; transporteur reconnu par nom", () => {
    expect(usablePhone("(+33)6****678")).toBeNull();
    expect(usablePhone("+33 6 12 34 56 78")).toBe("33612345678");
    expect(matchShippingProvider("colissimo", [{ id: "1", name: "Colissimo" }, { id: "2", name: "DHL" }])?.id).toBe("1");
    expect(matchShippingProvider("DHL Express", [{ id: "2", name: "DHL" }])?.id).toBe("2");
    expect(matchShippingProvider("manual", [{ id: "2", name: "DHL" }])).toBeNull();
  });
});

describe("importTiktokOrder", () => {
  it("crée une commande payée en devise boutique (montants TikTok convertis), décrémente le stock une seule fois", async () => {
    expect(await importTiktokOrder(A, order(), configA)).toBe("imported");
    const o = t().order[0];
    expect(o).toMatchObject({ storeId: A, idempotencyKey: "tiktok_shop:576000000000000001", status: "CONFIRMED", paymentStatus: "PAID", amountDue: 0, currency: "XOF", channel: "MANUAL", paymentMethodLabel: "TikTok Shop", customerEmail: null });
    expect(o.reference).toMatch(/^TT/);
    // 47,73 € payés → 31 309 FCFA (parité fixe), invariant respecté.
    expect(o.total).toBe(31_309);
    expect(o.subtotal - o.discount + o.deliveryFee).toBe(o.total);
    expect(o).toMatchObject({ presentmentCurrency: "EUR", presentmentTotal: 4773 });
    expect(o.attribution).toMatchObject({ source: "tiktok_shop", tiktok: { orderId: "576000000000000001", fulfilledBy: "seller" } });
    expect(Object.values(o.attribution.tiktok.lineItems)).toEqual([["li1", "li2"]]);
    // Stock de la variante : 3 − 2 ; mouvement SALE écrit.
    expect(t().variant.find((v: any) => v.id === "var_A_0001").stock).toBe(1);
    expect(t().inventoryMovement).toEqual([expect.objectContaining({ storeId: A, productId: "prod_A_0001", variantId: "var_A_0001", delta: -2, reason: "SALE" })]);
    expect(t().orderItem[0]).toMatchObject({ productId: "prod_A_0001", variantId: "var_A_0001", quantity: 2, presentmentUnitPrice: 2287 });
    expect(t().customer[0]).toMatchObject({ storeId: A, phone: "33612345678" });
    expect(vi.mocked(enqueue).mock.calls.map((c) => c[0])).toContain("order.created");

    // Rejeu (webhook + relève) : aucun effet.
    expect(await importTiktokOrder(A, order(), configA)).toBe("duplicate");
    expect(t().order).toHaveLength(1);
    expect(t().variant.find((v: any) => v.id === "var_A_0001").stock).toBe(1);
    expect(t().inventoryMovement).toHaveLength(1);
  });

  it("survente signalée : la vente TikTok est enregistrée même sans stock Axi", async () => {
    await importTiktokOrder(A, order({ lineItems: [{ ...order().lineItems[0], skuId: "SKU_SIMPLE", productName: "Sac", salePrice: "10.00" }] }), configA);
    expect(t().product.find((p: any) => p.id === "prod_A_0002").stock).toBe(4);
    await importTiktokOrder(A, order({ id: "576000000000000009", lineItems: Array.from({ length: 6 }, (_, i) => ({ ...order().lineItems[0], id: `x${i}`, skuId: "SKU_SIMPLE", productName: "Sac", salePrice: "10.00" })) }), configA);
    expect(t().product.find((p: any) => p.id === "prod_A_0002").stock).toBe(-2);
    expect(JSON.stringify(t().order[1].events)).toMatch(/survente de 2/);
  });

  it("isolation : un SKU relié à un produit d'une autre boutique n'est jamais décrémenté", async () => {
    await importTiktokOrder(A, order({ lineItems: [{ ...order().lineItems[0], skuId: "SKU_FOREIGN" }] }), configA);
    expect(t().product.find((p: any) => p.id === "prod_B_0001").stock).toBe(7);
    expect(t().orderItem[0]).toMatchObject({ productId: null, quantity: 1 });
    expect(t().inventoryMovement ?? []).toHaveLength(0);
    // Variante d'un autre produit (lien incohérent) : idem.
    await importTiktokOrder(A, order({ id: "576000000000000002", lineItems: [{ ...order().lineItems[0], skuId: "SKU_L" }] }), configA);
    expect(t().variant.find((v: any) => v.id === "var_A_0002").stock).toBe(1);
  });

  it("expédiée par TikTok : pas de décrément, note explicative", async () => {
    await importTiktokOrder(A, order({ fulfillmentType: "FULFILLMENT_BY_TIKTOK" }), configA);
    expect(t().variant.find((v: any) => v.id === "var_A_0001").stock).toBe(3);
    expect(t().order[0].attribution.tiktok.fulfilledBy).toBe("tiktok");
  });

  it("non payée ignorée ; annulée → annulation Axi (restock par transitionOrder) ; annulée jamais importée → rien", async () => {
    expect(await importTiktokOrder(A, order({ status: "UNPAID" }), configA)).toBe("skipped");
    expect(t().order ?? []).toHaveLength(0);
    expect(await importTiktokOrder(A, order({ status: "CANCELLED" }), configA)).toBe("skipped");
    expect(transitionOrder).not.toHaveBeenCalled();

    await importTiktokOrder(A, order(), configA);
    expect(await importTiktokOrder(A, order({ status: "CANCELLED" }), configA)).toBe("cancelled");
    expect(transitionOrder).toHaveBeenCalledWith(expect.objectContaining({ storeId: A, orderId: t().order[0].id, to: "CANCELLED", actorId: null }));
  });

  it("la même commande TikTok importée dans une autre boutique reste distincte (clé par boutique)", async () => {
    await importTiktokOrder(A, order(), configA);
    expect(await importTiktokOrder(B, order(), readConfig({ shop: { id: "1", name: "x", region: "FR", cipher: "c" } }))).toBe("imported");
    expect(t().order.map((o: any) => o.storeId)).toEqual([A, B]);
    expect(t().product.find((p: any) => p.id === "prod_B_0001").stock).toBe(7);
  });
});
