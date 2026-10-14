import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * createOrder (lot 2) : taxes intégrées (Order / OrderItem), instantané de devise d'affichage (presentment*),
 * encaissement en devise boutique avec mention, cartes cadeaux refusées en devise étrangère, webhooks émis dans la
 * transaction, isolation entre boutiques (taux de taxe et devises d'une autre boutique jamais utilisés).
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>, jobs: [] as { type: string; payload: Record<string, unknown>; storeId?: string | null }[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({
  enqueue: vi.fn(async (type: string, payload: Record<string, unknown>, opts: { storeId?: string | null } = {}) => {
    state.jobs.push({ type, payload, storeId: opts.storeId });
    return {};
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/commerce/quotas", () => ({ checkOrdersQuota: vi.fn(async () => ({ allowed: true })), incrementUsage: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));
vi.mock("@/lib/loyalty/service", () => ({ awardLoyaltyForOrder: vi.fn(), revokeLoyaltyForOrder: vi.fn() }));

import { createOrder, transitionOrder } from "@/lib/commerce/orders";
import { clearRatesMemo } from "@/lib/currency/rates";

const T0 = new Date("2026-01-01T00:00:00Z");

function seed(over: { pricesIncludeTax?: boolean; taxesEnabled?: boolean } = {}) {
  state.jobs = [];
  clearRatesMemo();
  state.fake = createFakeDb({
    store: [
      { id: "store_1", slug: "boutique", status: "PUBLISHED", country: "BJ", currency: "XOF", pickupEnabled: true, deliveryEnabled: true, whatsappOrdering: true, minOrderAmount: 0, taxesEnabled: over.taxesEnabled ?? true, pricesIncludeTax: over.pricesIncludeTax ?? true },
      { id: "store_2", slug: "autre", status: "PUBLISHED", country: "BJ", currency: "XOF", pickupEnabled: true, minOrderAmount: 0, taxesEnabled: true, pricesIncludeTax: true },
    ],
    // Plan Business actif : les taxes et les devises sont incluses (contrôle de plan dans src/lib/tax/settings.ts).
    subscription: [
      { id: "sub_1", storeId: "store_1", planId: "BUSINESS", status: "ACTIVE", currentPeriodEnd: new Date("2027-01-01T00:00:00Z"), trialEndsAt: null },
      { id: "sub_2", storeId: "store_2", planId: "BUSINESS", status: "ACTIVE", currentPeriodEnd: new Date("2027-01-01T00:00:00Z"), trialEndsAt: null },
    ],
    product: [{ id: "prod_tshirt", storeId: "store_1", name: "T-shirt", status: "ACTIVE", price: 11800, promoPrice: null, promoStart: null, promoEnd: null, trackStock: false, stock: 0, inventoryPolicy: "DENY", minQty: 1, maxQty: null, isGiftCard: false, taxable: true, taxCategory: "standard" }],
    variant: [],
    optionGroup: [],
    order: [],
    customer: [],
    taxRate: [
      { id: "tr_1", storeId: "store_1", name: "TVA", country: "BJ", regionKey: "*", taxCategory: "standard", rateBps: 1800, appliesToShipping: true, active: true },
      { id: "tr_2", storeId: "store_2", name: "TVA autre", country: "BJ", regionKey: "*", taxCategory: "standard", rateBps: 2000, appliesToShipping: true, active: true },
    ],
    storeCurrency: [
      { id: "sc_1", storeId: "store_1", currency: "EUR", enabled: true, rateMode: "auto", manualRate: null, markupBps: 0, rounding: "NONE", createdAt: T0 },
      { id: "sc_2", storeId: "store_2", currency: "USD", enabled: true, rateMode: "manual", manualRate: "600", markupBps: 0, rounding: "NONE", createdAt: T0 },
    ],
    exchangeRate: [],
    productPrice: [],
    paymentMethod: [{ id: "pm_momo", storeId: "store_1", kind: "MOBILE_MONEY_MANUAL", label: "MTN MoMo", active: true, currencies: ["EUR"] }],
    paymentAttempt: [],
  });
}

let n = 0;
const order = (over: Partial<Parameters<typeof createOrder>[0]> = {}) =>
  createOrder({ storeSlug: "boutique", idempotencyKey: `lot2-${++n}-abcdef`, items: [{ productId: "prod_tshirt", quantity: 1 }], fulfillmentType: "PICKUP", customer: { name: "Awa Test", phone: "97000000" }, ...over });

const row = (table: string, id: string) => state.fake!.tables[table].find((r) => r.id === id)!;
const webhookEvents = () => state.jobs.filter((j) => j.type === "webhook.fanout").map((j) => j.payload.event);

beforeEach(() => seed());

describe("createOrder : taxes", () => {
  it("TTC 18 % : taxTotal, taxLines, montants par ligne ; total inchangé", async () => {
    const r = await order();
    expect(r.ok).toBe(true);
    const o = row("order", r.ok ? r.orderId : "");
    expect(o).toMatchObject({ total: 11800, taxTotal: 1800, taxesIncluded: true });
    expect(o.taxLines).toEqual([{ name: "TVA", rateBps: 1800, base: 10000, amount: 1800 }]);
    const item = state.fake!.tables.orderItem.find((i) => i.orderId === o.id)!;
    expect(item).toMatchObject({ taxAmount: 1800, taxRateBps: 1800, presentmentUnitPrice: null });
  });

  it("HT : taxes ajoutées au total et au montant dû", async () => {
    seed({ pricesIncludeTax: false });
    const r = await order({ paymentMethodId: "pm_momo" });
    const o = row("order", r.ok ? r.orderId : "");
    expect(o).toMatchObject({ subtotal: 11800, taxTotal: 2124, taxesIncluded: false, total: 13924, amountDue: 13924 });
  });

  it("taxes désactivées : aucune taxe (et jamais le taux d'une autre boutique)", async () => {
    seed({ taxesEnabled: false });
    const r = await order();
    expect(row("order", r.ok ? r.orderId : "")).toMatchObject({ total: 11800, taxTotal: 0, taxesIncluded: true });
  });
});

describe("createOrder : devise d'affichage", () => {
  it("instantané EUR, encaissement en FCFA avec la mention (Mobile Money jamais converti)", async () => {
    const r = await order({ presentmentCurrency: "EUR", paymentMethodId: "pm_momo" });
    expect(r.ok).toBe(true);
    const o = row("order", r.ok ? r.orderId : "");
    // 11 800 FCFA = 17,989… € → 17,99 €.
    expect(o).toMatchObject({ currency: "XOF", total: 11800, presentmentCurrency: "EUR", presentmentRate: "0.0015244902", presentmentTotal: 1799 });
    expect(o.presentmentAmounts.taxTotal).toBe(274); // round(1799 × 1800 / 11800)
    expect(o.presentmentAmounts.charge.currency).toBe("XOF");
    expect(String(o.presentmentAmounts.charge.mention).replace(/\s/g, " ")).toBe("Vous serez débité de 11 800 FCFA (≈ 17,99 €)");
    const attempt = state.fake!.tables.paymentAttempt.find((a) => a.orderId === o.id)!;
    expect(attempt).toMatchObject({ amount: 11800, currency: "XOF" });
    const item = state.fake!.tables.orderItem.find((i) => i.orderId === o.id)!;
    expect(item.presentmentUnitPrice).toBe(1799);
  });

  it("devise non activée par la boutique (activée ailleurs) : aucun instantané", async () => {
    const r = await order({ presentmentCurrency: "USD" });
    const o = row("order", r.ok ? r.orderId : "");
    expect(o.presentmentCurrency ?? null).toBeNull();
    expect(o.total).toBe(11800);
  });

  it("cartes cadeaux refusées en devise étrangère", async () => {
    const r = await order({ presentmentCurrency: "EUR", giftCardCodes: ["AXI-AAAA-BBBB-CCCC"] });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.field).toBe("giftCardCodes");
    expect(r.ok ? "" : r.error).toMatch(/uniquement dans la devise de la boutique/);
  });

  it("facture au nom d'une entreprise : raison sociale et numéro fiscal enregistrés", async () => {
    const r = await order({ buyerCompany: "  Awa SARL ", buyerTaxId: "IFU 3202400000000" });
    expect(row("order", r.ok ? r.orderId : "")).toMatchObject({ buyerCompany: "Awa SARL", buyerTaxId: "IFU 3202400000000" });
  });
});

describe("webhooks sortants", () => {
  it("order.created émis dans la transaction, sans coordonnées personnelles", async () => {
    const r = await order({ presentmentCurrency: "EUR" });
    // Nouveau client : customer.created (consolidation vague 2), coordonnées uniquement sous `customer` (filtrées au fan-out).
    expect(webhookEvents()).toEqual(["customer.created", "order.created"]);
    const customerJob = state.jobs.find((j) => j.type === "webhook.fanout" && j.payload.event === "customer.created")!;
    const customerData = customerJob.payload.data as Record<string, unknown>;
    expect(Object.keys(customerData).sort()).toEqual(["customer", "customer_id", "source"]);
    expect(customerData).toMatchObject({ source: "checkout" });
    const job = state.jobs.find((j) => j.type === "webhook.fanout" && j.payload.event === "order.created")!;
    expect(job.storeId).toBe("store_1");
    const data = job.payload.data as Record<string, unknown>;
    // (La base factice n'applique pas les défauts Prisma : `status` n'y est pas renseigné.)
    expect(data).toMatchObject({ id: r.ok ? r.orderId : "", total: 11800, taxTotal: 1800, presentmentCurrency: "EUR", presentmentTotal: 1799 });
    expect(JSON.stringify(data)).not.toMatch(/Awa|97000000/);
  });

  it("annulation : order.status_changed puis order.cancelled", async () => {
    const r = await order();
    const id = r.ok ? r.orderId : "";
    Object.assign(row("order", id), { status: "NEW", paymentStatus: "UNPAID" });
    state.jobs = [];
    await transitionOrder({ orderId: id, storeId: "store_1", to: "CANCELLED", actorId: "u1", actorLabel: "Test" });
    expect(webhookEvents()).toEqual(["order.status_changed", "order.cancelled"]);
    const data = state.jobs.find((j) => j.payload.event === "order.cancelled")!.payload.data as Record<string, unknown>;
    expect(data).toMatchObject({ from: "NEW", to: "CANCELLED", status: "CANCELLED" });
  });

  it("une transition refusée n'émet rien", async () => {
    const r = await order();
    const id = r.ok ? r.orderId : "";
    Object.assign(row("order", id), { status: "DELIVERED", paymentStatus: "PAID" });
    state.jobs = [];
    await expect(transitionOrder({ orderId: id, storeId: "store_1", to: "NEW", actorId: "u1", actorLabel: "Test" })).rejects.toThrow();
    expect(webhookEvents()).toEqual([]);
  });
});
