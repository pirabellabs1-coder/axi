import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Consolidation vague 2 (paiements) : un avoir fiscal est demandé dans la transaction de CHAQUE remboursement,
 * et les webhooks `order.paid` / `order.refunded` sont émis une seule fois par passage d'état, sans coordonnées.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ fake: null as any, events: [] as { storeId: string; event: string; data: any; tx: unknown }[], creditNotes: [] as { storeId: string; refundId: string; tx: unknown }[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})), queueNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s.replace(/^enc:/, "") }));
vi.mock("@/lib/loyalty/service", () => ({ revokeLoyaltyForOrder: vi.fn(async () => ({ revoked: 0 })) }));
vi.mock("@/lib/webhooks/emit", () => ({
  emitDomainEvent: vi.fn(async (tx: unknown, storeId: string, event: string, data: any) => {
    state.events.push({ storeId, event, data, tx });
    return { eventId: `evt_${state.events.length}` };
  }),
}));
vi.mock("@/lib/tax/invoice", () => ({
  issueCreditNoteForRefundTx: vi.fn(async (tx: unknown, p: { storeId: string; refundId: string }) => {
    state.creditNotes.push({ storeId: p.storeId, refundId: p.refundId, tx });
    return { id: `cn_${state.creditNotes.length}`, number: `A-2026-00000${state.creditNotes.length}`, kind: "CREDIT_NOTE", created: true };
  }),
}));

import { requestRefund, confirmManualPayment, applyAttemptStatus } from "@/lib/payments/service";
import { approveReturn, rejectReturn } from "@/lib/returns/service";
import { createGiftCardRecord } from "@/lib/giftcards/service";

const S = "store_s1";
const O = "ord_main";

function seed(order: Record<string, unknown> = {}) {
  state.events = [];
  state.creditNotes = [];
  state.fake = createFakeDb({
    store: [{ id: S, slug: "boutique", status: "PUBLISHED", currency: "XOF", country: "BJ" }],
    customer: [{ id: "cust_1", storeId: S, name: "Awa", phone: "22997000000", storeCreditBalance: 0 }],
    order: [
      {
        id: O, storeId: S, customerId: "cust_1", reference: "AX-TEST01", status: "CONFIRMED", paymentStatus: "PAID", currency: "XOF",
        subtotal: 10_000, total: 10_000, amountDue: 10_000, giftCardAmount: 0, storeCreditAmount: 0, loyaltyPointsRedeemed: 0, discount: 0, deliveryFee: 0,
        customerName: "Awa", customerPhone: "22997000000", customerEmail: "awa@example.com", fulfillmentType: "PICKUP", channel: "STORE", createdAt: new Date(),
        ...order,
      },
    ],
    orderItem: [{ id: "item_1", orderId: O, productId: "prod_1", name: "Robe", quantity: 1, unitPrice: 10_000, lineTotal: 10_000, discountAllocated: 0, isGiftCard: false }],
    giftCard: [],
    giftCardTransaction: [],
    storeCreditTransaction: [],
    returnRequest: [],
    refund: [],
    paymentAttempt: [],
    paymentMethod: [],
    orderEvent: [],
  });
}

const refund = (amount: number) => requestRefund({ orderId: O, storeId: S, actorId: "user_1", actorLabel: "Test", amount });
const named = (e: string) => state.events.filter((x) => x.event === e);

beforeEach(() => seed());

describe("remboursement : avoir fiscal et webhook", () => {
  it("un avoir demandé dans la transaction de chaque remboursement, avec le bon identifiant", async () => {
    const r1 = await refund(4_000);
    const r2 = await refund(6_000);
    expect(state.creditNotes.map((c) => c.refundId)).toEqual([r1.id, r2.id]);
    expect(state.creditNotes.every((c) => c.storeId === S)).toBe(true);
    // Même client de transaction que l'émission du webhook : tout ou rien.
    expect(state.creditNotes[0].tx).toBe(named("order.refunded")[0].tx);
  });

  it("order.refunded : une fois par remboursement, statut à jour, sans coordonnées ni motif", async () => {
    await refund(4_000);
    await refund(6_000);
    const ev = named("order.refunded");
    expect(ev).toHaveLength(2);
    expect(ev[0].data).toMatchObject({ id: O, reference: "AX-TEST01", amount: 4_000, paymentStatus: "PARTIALLY_REFUNDED", destination: "original" });
    expect(ev[1].data).toMatchObject({ amount: 6_000, paymentStatus: "REFUNDED" });
    const json = JSON.stringify(ev.map((e) => e.data));
    expect(json).not.toContain("Awa");
    expect(json).not.toContain("22997000000");
    expect(json).not.toContain("awa@example.com");
  });

  it("remboursement refusé (montant excessif) : ni avoir ni événement", async () => {
    await expect(refund(20_000)).rejects.toThrow();
    expect(state.creditNotes).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });
});

describe("paiement confirmé : order.paid émis une seule fois", () => {
  it("confirmation manuelle puis seconde confirmation : un seul événement", async () => {
    seed({ paymentStatus: "PENDING" });
    await confirmManualPayment({ orderId: O, storeId: S, actorId: "user_1", actorLabel: "Test" });
    await confirmManualPayment({ orderId: O, storeId: S, actorId: "user_1", actorLabel: "Test" });
    expect(named("order.paid")).toHaveLength(1);
    expect(named("order.paid")[0].data).toMatchObject({ id: O, paymentStatus: "PAID" });
  });

  // M : passage à PAID conditionnel. Un double clic (ou deux membres) ne doit créer qu'UNE tentative
  // CONFIRMED et qu'UN `order.paid` (deux eventId différents ne seraient pas dédoublonnés chez le client).
  it("deux confirmations manuelles CONCURRENTES : une seule tentative CONFIRMED, un seul order.paid", async () => {
    seed({ paymentStatus: "PENDING" });
    const confirm = (n: number) => confirmManualPayment({ orderId: O, storeId: S, actorId: `user_${n}`, actorLabel: "Test" });
    const [a, b] = await Promise.all([confirm(1), confirm(2)]);
    expect(a.paymentStatus).toBe("PAID");
    expect(b.paymentStatus).toBe("PAID");
    expect(named("order.paid")).toHaveLength(1);
    const attempts = state.fake.tables.paymentAttempt;
    expect(attempts).toHaveLength(1);
    expect(attempts.filter((x: any) => x.status === "CONFIRMED")).toHaveLength(1);
    expect(state.fake.tables.orderEvent.filter((e: any) => e.type === "payment_changed")).toHaveLength(1);
  });

  it("webhook passerelle rejoué (CONFIRMED deux fois) : un seul order.paid ; échec : aucun", async () => {
    seed({ paymentStatus: "PENDING" });
    state.fake.tables.paymentAttempt.push({ id: "att_1", orderId: O, provider: "pawapay", status: "INITIATED", providerRef: "dep_1", amount: 10_000, currency: "XOF", metadata: null, createdAt: new Date(), updatedAt: new Date() });
    await applyAttemptStatus("att_1", "CONFIRMED", "dep_1");
    await applyAttemptStatus("att_1", "CONFIRMED", "dep_1");
    expect(named("order.paid")).toHaveLength(1);

    seed({ paymentStatus: "PENDING" });
    state.fake.tables.paymentAttempt.push({ id: "att_2", orderId: O, provider: "pawapay", status: "INITIATED", providerRef: "dep_2", amount: 10_000, currency: "XOF", metadata: null, createdAt: new Date(), updatedAt: new Date() });
    await applyAttemptStatus("att_2", "FAILED", "dep_2");
    expect(named("order.paid")).toHaveLength(0);
  });
});

describe("retours et cartes cadeaux : événements dans la transaction, sans données personnelles", () => {
  it("transition de retour : return.status_changed, sans note du client", async () => {
    state.fake.tables.returnRequest.push({ id: "ret_1", storeId: S, orderId: O, reference: "RT-1", status: "REQUESTED", resolution: "NONE", customerNote: "Mon adresse : rue 12" });
    state.fake.tables.returnEvent = [];
    await approveReturn({ storeId: S, returnId: "ret_1", actor: { kind: "merchant", id: "user_1", label: "Test" } });
    const ev = named("return.status_changed");
    expect(ev).toHaveLength(1);
    expect(ev[0].data).toMatchObject({ return_id: "ret_1", reference: "RT-1", order_id: O, from: "REQUESTED", status: "APPROVED", by: "merchant" });
    expect(JSON.stringify(ev[0].data)).not.toContain("rue 12");
    // Transition refusée : aucun événement de plus.
    await expect(rejectReturn({ storeId: S, returnId: "ret_1", actor: { kind: "customer", id: null, label: "Client" }, reason: "Pas content" })).rejects.toThrow();
    expect(named("return.status_changed")).toHaveLength(1);
  });

  it("carte émise : giftcard.issued avec les 4 derniers caractères, jamais le code", async () => {
    const card = await createGiftCardRecord(state.fake.db, { storeId: S, currency: "XOF", initialValue: 25_000, status: "ACTIVE", recipientName: "Koffi" } as any, { orderId: O });
    const ev = named("giftcard.issued");
    expect(ev).toHaveLength(1);
    expect(ev[0].data).toMatchObject({ gift_card_id: card.id, last4: card.last4, initial_value: 25_000, currency: "XOF", order_id: O, source: "order" });
    const json = JSON.stringify(ev[0].data);
    expect(json).not.toContain(card.code);
    expect(json).not.toContain("Koffi");
  });
});
