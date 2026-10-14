import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ db: null as any, fake: null as any, jobs: [] as any[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/jobs", () => ({
  enqueue: async (type: string, payload: unknown) => {
    state.jobs.push({ type, payload });
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "1.2.3.4",
  rateLimitAll: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitMessage: () => "Trop de tentatives",
}));
vi.mock("@/lib/buyer/session", () => ({ getBuyer: async () => null }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    effectivePlanId: () => "BUSINESS",
    requireStore: async (storeId: string) => {
      const store = state.fake.tables.store.find((s: any) => s.id === storeId);
      if (storeId !== "store_aaa" || !store) throw new AuthError("Boutique introuvable ou accès refusé");
      return { store, user: { id: "user_a", name: "Awa" }, role: "OWNER", planId: "BUSINESS", can: () => true };
    },
  };
});

import { approveReturn, cancelMyReturn, cancelReturn, createReturn, receiveReturn, rejectReturn, requestReturn, resolveReturn } from "@/lib/returns/actions";

const POLICY = { enabled: true, windowDays: 7, allowRefund: true, allowStoreCredit: true, allowExchange: true, storeCreditBonusPercent: 10, restockingFeePercent: 0, nonReturnableTags: [], requirePhotos: false, returnShippingPaidBy: "customer", instructions: "" };
const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);

function seed() {
  const delivered = new Date(Date.now() - 2 * 86_400_000);
  const future = new Date(Date.now() + 30 * 86_400_000);
  const store = (id: string) => ({ id, slug: id.replace("_", "-"), status: "PUBLISHED", currency: "XOF", returnPolicy: POLICY, subscription: null });
  const order = (id: string, storeId: string, token: string, customerId: string) => ({
    id, storeId, reference: `AX-${id.toUpperCase().slice(-4)}`, trackingToken: token, trackingExpiresAt: future, status: "DELIVERED", deliveredAt: delivered,
    paymentStatus: "UNPAID", total: 20_000, deliveryFee: 0, subtotal: 20_000, discount: 0, currency: "XOF", customerId, customerName: "Client", customerPhone: "22901000000", customerEmail: null, refunds: [],
  });
  state.fake = createFakeDb({
    store: [store("store_aaa"), store("store_bbb")],
    customer: [
      { id: "cust_a", storeId: "store_aaa", phone: "22901000000", name: "Client A", loyaltyPoints: 0, storeCreditBalance: 0 },
      { id: "cust_b", storeId: "store_bbb", phone: "22901000000", name: "Client B", loyaltyPoints: 0, storeCreditBalance: 0 },
    ],
    product: [
      { id: "prod_a1", storeId: "store_aaa", trackStock: true, stock: 5, tags: [], images: [] },
      { id: "prod_b1", storeId: "store_bbb", trackStock: true, stock: 5, tags: [], images: [] },
    ],
    order: [order("order_aaaa", "store_aaa", TOKEN_A, "cust_a"), order("order_bbbb", "store_bbb", TOKEN_B, "cust_b")],
    orderItem: [
      { id: "item_aaa1", orderId: "order_aaaa", productId: "prod_a1", variantId: null, variantName: null, name: "Pagne", unitPrice: 10_000, quantity: 2, lineTotal: 20_000, discountAllocated: 0, isGiftCard: false },
      { id: "item_bbb1", orderId: "order_bbbb", productId: "prod_b1", variantId: null, variantName: null, name: "Sac", unitPrice: 10_000, quantity: 2, lineTotal: 20_000, discountAllocated: 0, isGiftCard: false },
    ],
    inventoryMovement: [
      { id: "mv_a", storeId: "store_aaa", productId: "prod_a1", variantId: null, delta: -2, reason: "SALE", orderId: "order_aaaa" },
      { id: "mv_b", storeId: "store_bbb", productId: "prod_b1", variantId: null, delta: -2, reason: "SALE", orderId: "order_bbbb" },
    ],
    returnRequest: [
      { id: "ret_bbbbbb", storeId: "store_bbb", orderId: "order_bbbb", customerId: "cust_b", reference: "RT-BBBBBB", status: "REQUESTED", resolution: "NONE", requestedBy: "customer", reason: "size", refundAmount: 0, storeCreditAmount: 0, refundShipping: false, createdAt: new Date() },
    ],
    returnItem: [{ id: "ritem_bbb1", returnId: "ret_bbbbbb", orderItemId: "item_bbb1", quantity: 1, restock: true, restockedQty: 0 }],
  });
  const inner = state.fake.db;
  const wrapped: any = new Proxy(inner, {
    get(t, p: string) {
      if (p === "$executeRaw") return async () => 0;
      if (p === "$transaction") return async (fn: any) => fn(wrapped);
      return t[p];
    },
  });
  state.db = wrapped;
  state.jobs = [];
}

const form = (data: Record<string, unknown>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
  return fd;
};
const retB = () => state.fake.tables.returnRequest.find((r: any) => r.id === "ret_bbbbbb");

describe("retours : isolation entre boutiques", () => {
  beforeEach(seed);

  it("le commerçant A ne peut ni approuver, ni refuser, ni annuler, ni réceptionner, ni résoudre un retour de B", async () => {
    expect(await approveReturn("store_aaa", "ret_bbbbbb")).toMatchObject({ ok: false, error: "Retour introuvable." });
    expect(await cancelReturn("store_aaa", "ret_bbbbbb")).toMatchObject({ ok: false });
    expect(await rejectReturn(undefined, form({ storeId: "store_aaa", returnId: "ret_bbbbbb", reason: "Article porté" }))).toMatchObject({ ok: false });
    expect(await receiveReturn(undefined, form({ storeId: "store_aaa", returnId: "ret_bbbbbb", lines: [{ returnItemId: "ritem_bbb1", receivedQty: 1, condition: "neuf", restock: true }] }))).toMatchObject({ ok: false });
    expect(await resolveReturn(undefined, form({ storeId: "store_aaa", returnId: "ret_bbbbbb", resolution: "NONE" }))).toMatchObject({ ok: false });
    // Boutique B demandée explicitement : refus d'accès.
    expect(await approveReturn("store_bbb", "ret_bbbbbb")).toMatchObject({ ok: false });
    expect(retB().status).toBe("REQUESTED");
    expect(state.jobs).toHaveLength(0);
  });

  it("le commerçant A ne peut pas créer un retour sur une commande de B", async () => {
    const r = await createReturn(undefined, form({ storeId: "store_aaa", orderId: "order_bbbb", mode: "RECEIVED", reason: "other", items: [{ orderItemId: "item_bbb1", quantity: 1 }] }));
    expect(r).toMatchObject({ ok: false, error: "Commande introuvable." });
    expect(state.fake.tables.inventoryMovement.filter((m: any) => m.reason === "RETURN")).toHaveLength(0);
  });

  it("acheteur : le jeton de A ne donne accès ni aux articles ni aux retours de B", async () => {
    const r = await requestReturn(undefined, form({ token: TOKEN_A, reason: "size", resolution: "STORE_CREDIT", items: [{ orderItemId: "item_bbb1", quantity: 1 }] }));
    expect(r).toMatchObject({ ok: false, error: "Article invalide." });
    expect(await cancelMyReturn(undefined, form({ token: TOKEN_A, returnId: "ret_bbbbbb" }))).toMatchObject({ ok: false, error: "Retour introuvable." });
    expect(await cancelMyReturn(undefined, form({ token: "f".repeat(32), returnId: "ret_bbbbbb" }))).toMatchObject({ ok: false });
    expect(retB().status).toBe("REQUESTED");
  });
});

describe("retours : parcours complet (boutique A)", () => {
  beforeEach(seed);

  it("demande par jeton → approbation → réception avec remise en stock → avoir avec bonus", async () => {
    const req = await requestReturn(undefined, form({ token: TOKEN_A, reason: "size", resolution: "STORE_CREDIT", note: "Trop petit", items: [{ orderItemId: "item_aaa1", quantity: 1 }] }));
    expect(req.ok).toBe(true);
    const ret = state.fake.tables.returnRequest.find((r: any) => r.storeId === "store_aaa");
    expect(ret).toMatchObject({ status: "REQUESTED", requestedBy: "customer", resolution: "STORE_CREDIT", customerId: "cust_a" });

    // Quantité déjà réservée : une seconde demande pour 2 unités est refusée.
    const over = await requestReturn(undefined, form({ token: TOKEN_A, reason: "size", resolution: "STORE_CREDIT", items: [{ orderItemId: "item_aaa1", quantity: 2 }] }));
    expect(over.ok).toBe(false);

    expect((await approveReturn("store_aaa", ret.id)).ok).toBe(true);
    expect(ret.status).toBe("APPROVED");
    // Une approbation ne s'applique qu'une fois (transition conditionnelle).
    expect((await approveReturn("store_aaa", ret.id)).ok).toBe(false);

    const item = state.fake.tables.returnItem.find((i: any) => i.returnId === ret.id);
    const rec = await receiveReturn(undefined, form({ storeId: "store_aaa", returnId: ret.id, lines: [{ returnItemId: item.id, receivedQty: 1, condition: "neuf", restock: true }] }));
    expect(rec.ok).toBe(true);
    expect(ret.status).toBe("RECEIVED");
    expect(state.fake.tables.product.find((p: any) => p.id === "prod_a1").stock).toBe(6);
    expect(state.fake.tables.inventoryMovement.filter((m: any) => m.reason === "RETURN")).toMatchObject([{ delta: 1, orderId: "order_aaaa", storeId: "store_aaa" }]);
    expect(item.restockedQty).toBe(1);

    const res = await resolveReturn(undefined, form({ storeId: "store_aaa", returnId: ret.id, resolution: "STORE_CREDIT" }));
    expect(res.ok).toBe(true);
    expect(ret).toMatchObject({ status: "RESOLVED", resolution: "STORE_CREDIT", refundAmount: 10_000, storeCreditAmount: 11_000 });
    expect(state.fake.tables.customer.find((c: any) => c.id === "cust_a").storeCreditBalance).toBe(11_000);
    expect(state.fake.tables.storeCreditTransaction).toMatchObject([{ kind: "REFUND_TO_CREDIT", amount: 11_000, returnId: ret.id, storeId: "store_aaa" }]);

    // Journal et jobs : une entrée par transition.
    expect(state.fake.tables.returnEvent.filter((e: any) => e.returnId === ret.id).map((e: any) => e.toStatus)).toEqual(["REQUESTED", "APPROVED", "RECEIVED", "RESOLVED"]);
    expect(state.jobs.filter((j) => j.type === "return.status_changed").map((j) => j.payload.to)).toEqual(["REQUESTED", "APPROVED", "RECEIVED", "RESOLVED"]);
    // Webhooks (consolidation vague 2) : return.created puis return.status_changed, sans données personnelles.
    const hooks = state.jobs.filter((j) => j.type === "webhook.fanout").map((j) => j.payload as any);
    expect(hooks.map((h) => [h.event, h.data.status])).toEqual([["return.created", "REQUESTED"], ["return.status_changed", "APPROVED"], ["return.status_changed", "RECEIVED"], ["return.status_changed", "RESOLVED"]]);
    // Boutique B intacte.
    expect(state.fake.tables.product.find((p: any) => p.id === "prod_b1").stock).toBe(5);
    expect(retB().status).toBe("REQUESTED");
  });

  it("remboursement refusé sur une commande non payée ; l'acheteur annule une demande en attente", async () => {
    const created = await createReturn(undefined, form({ storeId: "store_aaa", orderId: "order_aaaa", mode: "RECEIVED", reason: "defect", items: [{ orderItemId: "item_aaa1", quantity: 2, restock: false }] }));
    expect(created.ok).toBe(true);
    const ret = state.fake.tables.returnRequest.find((r: any) => r.storeId === "store_aaa");
    expect(ret.status).toBe("RECEIVED");
    expect(state.fake.tables.product.find((p: any) => p.id === "prod_a1").stock).toBe(5); // remise en stock refusée
    const refund = await resolveReturn(undefined, form({ storeId: "store_aaa", returnId: ret.id, resolution: "REFUND" }));
    expect(refund.ok).toBe(false);
    expect(ret.status).toBe("RECEIVED");

    seed();
    await requestReturn(undefined, form({ token: TOKEN_A, reason: "changed_mind", resolution: "REFUND", items: [{ orderItemId: "item_aaa1", quantity: 1 }] }));
    const mine = state.fake.tables.returnRequest.find((r: any) => r.storeId === "store_aaa");
    expect((await cancelMyReturn(undefined, form({ token: TOKEN_A, returnId: mine.id }))).ok).toBe(true);
    expect(mine.status).toBe("CANCELLED");
  });
});
