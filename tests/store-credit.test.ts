import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/** Avoir : solde jamais négatif (débit conditionnel), journal, recrédit idempotent, refus en invité. */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));

import { redeemStoreCreditTx, reverseStoreCreditTx, grantTx, deductTx } from "@/lib/store-credit/service";
import { StoreCreditError } from "@/lib/store-credit/errors";
import { applicableStoreCredit, canUseStoreCredit, nextStoreCreditBalance } from "@/lib/store-credit/rules";

const S = "store_A";
const db = () => state.fake!.db;
const cust = () => state.fake!.tables.customer.find((c) => c.id === "cust_1")!;
const journal = () => state.fake!.tables.storeCreditTransaction ?? [];

beforeEach(() => {
  state.fake = createFakeDb({
    customer: [
      { id: "cust_1", storeId: S, name: "Awa", phone: "2290197000000", storeCreditBalance: 5_000 },
      { id: "cust_B", storeId: "store_B", name: "Koffi", phone: "2290197000001", storeCreditBalance: 5_000 },
    ],
    order: [{ id: "order_1", storeId: S, currency: "XOF" }],
    storeCreditTransaction: [],
    paymentAttempt: [],
  });
});

describe("règles d'éligibilité", () => {
  it("refus en invité ; acheteur connecté par code pour SA fiche ; commerçant", () => {
    expect(canUseStoreCredit({ customerId: "cust_1" })).toBe(false);
    expect(canUseStoreCredit({ customerId: "cust_1", buyerSessionCustomerId: null })).toBe(false);
    expect(canUseStoreCredit({ customerId: "cust_1", buyerSessionCustomerId: "cust_2" })).toBe(false);
    expect(canUseStoreCredit({ customerId: "cust_1", buyerSessionCustomerId: "cust_1" })).toBe(true);
    expect(canUseStoreCredit({ customerId: "cust_1", merchant: true })).toBe(true);
    expect(canUseStoreCredit({ customerId: null, merchant: true })).toBe(false);
  });
  it("montant applicable et solde jamais négatif", () => {
    expect(applicableStoreCredit(5_000, 8_000, 3_000)).toBe(3_000);
    expect(applicableStoreCredit(5_000, -1, 3_000)).toBe(0);
    expect(nextStoreCreditBalance(1_000, -1_001)).toBeNull();
    expect(nextStoreCreditBalance(1_000, -1_000)).toBe(0);
  });
});

describe("redeemStoreCreditTx", () => {
  it("débit conditionnel, journal REDEEM, PaymentAttempt store_credit", async () => {
    const m = await redeemStoreCreditTx(db(), S, "cust_1", 2_000, { orderId: "order_1" });
    expect(m).toMatchObject({ amount: 2_000, balanceAfter: 3_000 });
    expect(cust().storeCreditBalance).toBe(3_000);
    expect(journal()).toEqual([expect.objectContaining({ kind: "REDEEM", amount: -2_000, balanceAfter: 3_000, orderId: "order_1" })]);
    expect(state.fake!.tables.paymentAttempt).toEqual([expect.objectContaining({ provider: "store_credit", status: "CONFIRMED", amount: 2_000 })]);
  });

  it("solde insuffisant : refus, solde inchangé (jamais négatif)", async () => {
    await expect(redeemStoreCreditTx(db(), S, "cust_1", 5_001)).rejects.toMatchObject({ code: "insufficient" });
    expect(cust().storeCreditBalance).toBe(5_000);
    expect(journal()).toHaveLength(0);
  });

  it("deux débits concurrents : un seul passe", async () => {
    const r = await Promise.allSettled([redeemStoreCreditTx(db(), S, "cust_1", 4_000), redeemStoreCreditTx(db(), S, "cust_1", 4_000)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(cust().storeCreditBalance).toBe(1_000);
  });

  it("client d'une autre boutique : introuvable", async () => {
    await expect(redeemStoreCreditTx(db(), S, "cust_B", 100)).rejects.toMatchObject({ code: "not_found" });
    expect(state.fake!.tables.customer.find((c) => c.id === "cust_B")!.storeCreditBalance).toBe(5_000);
  });

  it("montant invalide refusé ; 0 = aucune opération", async () => {
    await expect(redeemStoreCreditTx(db(), S, "cust_1", -5)).rejects.toBeInstanceOf(StoreCreditError);
    await expect(redeemStoreCreditTx(db(), S, "cust_1", 1.5)).rejects.toBeInstanceOf(StoreCreditError);
    expect(await redeemStoreCreditTx(db(), S, "cust_1", 0)).toBeNull();
  });
});

describe("reverseStoreCreditTx, grantTx, deductTx", () => {
  it("annulation : recrédit du net débité, idempotent", async () => {
    await redeemStoreCreditTx(db(), S, "cust_1", 2_000, { orderId: "order_1" });
    expect((await reverseStoreCreditTx(db(), S, "order_1")).total).toBe(2_000);
    expect(cust().storeCreditBalance).toBe(5_000);
    expect((await reverseStoreCreditTx(db(), S, "order_1")).total).toBe(0);
    expect(cust().storeCreditBalance).toBe(5_000);
  });

  it("geste commercial : motif obligatoire ; REFUND_TO_CREDIT accepté", async () => {
    await expect(grantTx(db(), { storeId: S, customerId: "cust_1", amount: 1_000, note: " " })).rejects.toThrow(/motif/);
    const m = await grantTx(db(), { storeId: S, customerId: "cust_1", amount: 1_000, note: "Retard de livraison" });
    expect(m.balanceAfter).toBe(6_000);
    const r = await grantTx(db(), { storeId: S, customerId: "cust_1", amount: 500, kind: "REFUND_TO_CREDIT", returnId: "ret_1" });
    expect(r.balanceAfter).toBe(6_500);
    expect(journal().map((j) => j.kind)).toEqual(["GRANT", "REFUND_TO_CREDIT"]);
  });

  it("crédit sur un client d'une autre boutique : refus", async () => {
    await expect(grantTx(db(), { storeId: S, customerId: "cust_B", amount: 1_000, note: "x" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("débit marchand : conditionnel, ADJUST négatif", async () => {
    await expect(deductTx(db(), { storeId: S, customerId: "cust_1", amount: 6_000, note: "Correction" })).rejects.toMatchObject({ code: "insufficient" });
    const m = await deductTx(db(), { storeId: S, customerId: "cust_1", amount: 5_000, note: "Correction" });
    expect(m).toMatchObject({ amount: -5_000, balanceAfter: 0 });
  });
});
