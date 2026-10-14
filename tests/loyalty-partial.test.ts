import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ db: null as any, fake: null as any }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));

import { revokeLoyaltyPartial, redeemPointsTx, reverseRedeemedPointsTx } from "@/lib/loyalty/service";

/** Base factice + $executeRaw (verrou consultatif) ; $transaction rappelle la même base enrichie. */
function setup(customerPoints: number, ledger: { delta: number; reason: string; orderId?: string; storeId?: string; customerId?: string }[]) {
  state.fake = createFakeDb({
    store: [{ id: "store_a" }, { id: "store_b" }],
    customer: [
      { id: "cust_a", storeId: "store_a", loyaltyPoints: customerPoints },
      { id: "cust_b", storeId: "store_b", loyaltyPoints: 100 },
    ],
    order: [
      // Base des points (loyalty-base.ts) : net marchandise des lignes hors cartes cadeaux, moins cartes et avoir.
      { id: "order_a", storeId: "store_a", customerId: "cust_a", subtotal: 30_000, discount: 0, giftCardAmount: 0, storeCreditAmount: 0, items: [{ lineTotal: 30_000, discountAllocated: 0, isGiftCard: false }] },
      { id: "order_b", storeId: "store_b", customerId: "cust_b", subtotal: 30_000, discount: 0, giftCardAmount: 0, storeCreditAmount: 0, items: [{ lineTotal: 30_000, discountAllocated: 0, isGiftCard: false }] },
    ],
    loyaltyLedger: ledger.map((l, i) => ({ id: `led_${i}`, storeId: l.storeId ?? "store_a", customerId: l.customerId ?? "cust_a", orderId: l.orderId ?? "order_a", delta: l.delta, reason: l.reason })),
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
  return wrapped;
}

const points = (id = "cust_a") => state.fake.tables.customer.find((c: any) => c.id === id).loyaltyPoints;
const ledgerRows = (reason: string) => state.fake.tables.loyaltyLedger.filter((l: any) => l.reason === reason);

describe("revokeLoyaltyPartial", () => {
  beforeEach(() => setup(0, []));

  it("retire points × montant remboursé / net marchandise, arrondi à l'inférieur", async () => {
    setup(40, [{ delta: 30, reason: "order" }]);
    const r = await revokeLoyaltyPartial("order_a", 10_000);
    expect(r.revoked).toBe(10);
    expect(points()).toBe(30);
    expect(ledgerRows("return")).toHaveLength(1);
    expect(ledgerRows("return")[0].delta).toBe(-10);
    const r2 = await revokeLoyaltyPartial("order_a", 5_000); // 30 × 5000 / 30000 = 5
    expect(r2.revoked).toBe(5);
  });

  it("solde jamais négatif (points déjà dépensés)", async () => {
    setup(3, [{ delta: 30, reason: "order" }]);
    const r = await revokeLoyaltyPartial("order_a", 30_000);
    expect(r.revoked).toBe(3);
    expect(points()).toBe(0);
  });

  it("jamais plus que les points gagnés encore attachés à la commande", async () => {
    setup(100, [{ delta: 30, reason: "order" }, { delta: -25, reason: "refund" }]);
    const r = await revokeLoyaltyPartial("order_a", 30_000);
    expect(r.revoked).toBe(5);
  });

  it("les points utilisés pour payer la commande ne comptent pas comme gagnés", async () => {
    setup(100, [{ delta: -50, reason: "redeem" }]);
    expect((await revokeLoyaltyPartial("order_a", 30_000)).revoked).toBe(0);
  });

  it("sans effet : montant nul, commande sans client, autre boutique", async () => {
    setup(40, [{ delta: 30, reason: "order" }]);
    expect((await revokeLoyaltyPartial("order_a", 0)).revoked).toBe(0);
    expect((await revokeLoyaltyPartial("order_a", 10_000, { storeId: "store_b" })).revoked).toBe(0);
    expect(points()).toBe(40);
  });
});

describe("redeemPointsTx / reverseRedeemedPointsTx", () => {
  it("débit conditionnel puis restitution idempotente", async () => {
    const tx = setup(120, []);
    const ok = await redeemPointsTx(tx, { storeId: "store_a", customerId: "cust_a", points: 100, orderId: "order_a" });
    expect(ok).toMatchObject({ ok: true, balance: 20 });
    const ko = await redeemPointsTx(tx, { storeId: "store_a", customerId: "cust_a", points: 50, orderId: "order_a" });
    expect(ko).toMatchObject({ ok: false, balance: 20 });
    expect((await reverseRedeemedPointsTx(tx, { storeId: "store_a", orderId: "order_a" })).restored).toBe(100);
    expect((await reverseRedeemedPointsTx(tx, { storeId: "store_a", orderId: "order_a" })).restored).toBe(0);
    expect(points()).toBe(120);
  });

  it("isolation : un client d'une autre boutique n'est jamais débité", async () => {
    const tx = setup(0, []);
    const r = await redeemPointsTx(tx, { storeId: "store_a", customerId: "cust_b", points: 10, orderId: "order_a" });
    expect(r.ok).toBe(false);
    expect(points("cust_b")).toBe(100);
  });
});
