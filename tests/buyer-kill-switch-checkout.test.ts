import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/** Arrêt d'urgence des comptes acheteurs : avoir et points refusés au checkout (revue sécurité lot 1, MAJEUR 7). */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ fake: null as any, kill: { enabled: true, message: "" }, createOrder: null as any }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "1.2.3.4",
  rateLimit: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitAll: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitMessage: () => "Trop de tentatives.",
}));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));
vi.mock("@/lib/buyer/settings", () => ({ getBuyerKillSwitch: async () => state.kill }));
vi.mock("@/lib/buyer/session", () => ({ getBuyer: async () => ({ customerId: "cust_1", customer: { id: "cust_1", loyaltyPoints: 500, storeCreditBalance: 5000 }, sessionId: "s" }) }));
vi.mock("@/lib/commerce/orders", () => ({ createOrder: (...a: unknown[]) => state.createOrder(...a) }));
vi.mock("@/lib/payments/service", () => ({ initiateGatewayPayment: vi.fn() }));

import { placeOrder, previewTotals } from "@/lib/storefront/actions";

const base = {
  storeSlug: "boutique",
  items: [{ productId: "prod_000001", quantity: 1 }],
  fulfillmentType: "PICKUP" as const,
};

beforeEach(() => {
  state.kill = { enabled: true, message: "" };
  state.createOrder = vi.fn(async () => ({ ok: false, error: "non appelé" }));
  state.fake = createFakeDb({
    store: [{ id: "store_1", slug: "boutique", status: "PUBLISHED", currency: "XOF", minOrderAmount: 0, loyaltyConfig: { enabled: true, rewardPoints: 100, rewardValue: 1000 } }],
    product: [],
    automaticDiscount: [],
  });
});

describe("kill switch acheteurs au checkout", () => {
  it("placeOrder refuse l'avoir et les points, sans créer de commande", async () => {
    const order = { ...base, idempotencyKey: "key-1234567890abcdef", customer: { name: "Awa", phone: "97000000" } };
    expect(await placeOrder({ ...order, useStoreCredit: true })).toMatchObject({ ok: false, field: "storeCredit" });
    expect(await placeOrder({ ...order, loyaltyPoints: 100 })).toMatchObject({ ok: false, field: "loyaltyPoints" });
    expect(state.createOrder).not.toHaveBeenCalled();
  });

  it("previewTotals refuse l'avoir et les points ; sans demande, le compte n'est pas proposé", async () => {
    expect(await previewTotals({ ...base, useStoreCredit: true })).toMatchObject({ ok: false, field: "storeCredit" });
    expect(await previewTotals({ ...base, loyaltyPoints: 100 })).toMatchObject({ ok: false, field: "loyaltyPoints" });
    const r = await previewTotals({ ...base, items: [] });
    expect(r).toMatchObject({ ok: true, account: null });
  });

  it("arrêt levé : l'avoir redevient utilisable (createOrder appelé avec l'acheteur)", async () => {
    state.kill = { enabled: false, message: "" };
    state.createOrder = vi.fn(async () => ({ ok: false, error: "stop" }));
    await placeOrder({ ...base, idempotencyKey: "key-1234567890abcdef", customer: { name: "Awa", phone: "97000000" }, useStoreCredit: true });
    expect(state.createOrder).toHaveBeenCalledWith(expect.objectContaining({ useStoreCredit: true, buyerCustomerId: "cust_1" }));
  });
});
