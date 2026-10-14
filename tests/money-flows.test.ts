import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import { computeRefundable, externalRefunded, refundNote } from "@/lib/commerce/refunds";
import { loyaltyBaseAmount } from "@/lib/commerce/loyalty-base";

/**
 * Revue « argent » du lot 1 : aucun flux de sortie ne rend deux fois la même valeur.
 * Remboursements (deux destinations), annulation, retours, cartes achetées, commande d'échange.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ fake: null as any }));

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
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })), rateLimitAll: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));
vi.mock("@/lib/commerce/quotas", () => ({ checkOrdersQuota: vi.fn(async () => ({ allowed: true })), incrementUsage: vi.fn(async () => ({})) }));
vi.mock("@/lib/loyalty/service", () => ({
  awardLoyaltyForOrder: vi.fn(async () => ({ awarded: 0 })),
  revokeLoyaltyForOrder: vi.fn(async () => ({ revoked: 0 })),
  reverseRedeemedPointsTx: vi.fn(async () => ({ restored: 0 })),
  redeemPointsTx: vi.fn(async () => ({ ok: true, balance: 0 })),
}));

import { requestRefund } from "@/lib/payments/service";
import { transitionOrder } from "@/lib/commerce/orders";
import { createExchangeOrder } from "@/lib/commerce/exchange";
import { issueGiftCardsForOrder } from "@/lib/giftcards/service";

const S = "store_s1";
const C = "cust_1";
const O = "ord_main";

type Over = Record<string, unknown>;
function seed(o: { order?: Over; items?: Over[]; cards?: Over[]; gcTx?: Over[]; scTx?: Over[]; returns?: Over[]; customer?: Over; products?: Over[] } = {}) {
  state.fake = createFakeDb({
    store: [{ id: S, slug: "boutique", status: "PUBLISHED", currency: "XOF", country: "BJ" }],
    customer: [{ id: C, storeId: S, name: "Awa", phone: "22997000000", storeCreditBalance: 0, loyaltyPoints: 0, ...o.customer }],
    order: [
      {
        id: O, storeId: S, customerId: C, reference: "AX-TEST01", status: "CONFIRMED", paymentStatus: "PAID", currency: "XOF",
        total: 10_000, amountDue: 6_000, giftCardAmount: 4_000, storeCreditAmount: 0, loyaltyPointsRedeemed: 0, discount: 0, deliveryFee: 0,
        customerName: "Awa", customerPhone: "22997000000", customerEmail: null, fulfillmentType: "PICKUP",
        ...o.order,
      },
    ],
    orderItem: (o.items ?? [{ id: "item_1", orderId: O, productId: "prod_1", name: "Robe", quantity: 1, unitPrice: 10_000, lineTotal: 10_000, discountAllocated: 0, isGiftCard: false }]) as any[],
    giftCard: (o.cards ?? [{ id: "gc_1", storeId: S, last4: "AAAA", currency: "XOF", balance: 1_000, initialValue: 5_000, status: "ACTIVE" }]) as any[],
    giftCardTransaction: (o.gcTx ?? [{ id: "gct_1", storeId: S, giftCardId: "gc_1", orderId: O, kind: "REDEEM", amount: -4_000, balanceAfter: 1_000, note: null }]) as any[],
    storeCreditTransaction: (o.scTx ?? []) as any[],
    returnRequest: (o.returns ?? []) as any[],
    refund: [],
    product: (o.products ?? []) as any[],
    variant: [],
    optionGroup: [],
    inventoryMovement: [],
  });
}

const t = (name: string) => state.fake.tables[name] as any[];
const card = (id = "gc_1") => t("giftCard").find((c) => c.id === id);
const customer = () => t("customer").find((c) => c.id === C);
const order = (id = O) => t("order").find((x) => x.id === id);
const refund = (amount: number, destination: "original" | "store_credit" = "original", over: Over = {}) =>
  requestRefund({ orderId: O, storeId: S, actorId: "user_1", actorLabel: "Test", amount, destination, ...over } as any);
const cancel = (orderId = O) => transitionOrder({ orderId, storeId: S, to: "CANCELLED", actorId: "user_1", actorLabel: "Test", reason: "test" });

beforeEach(() => seed());

/* ───────────────────────── Calcul pur ───────────────────────── */

describe("computeRefundable (pur)", () => {
  it("total − remboursements − recrédits d'annulation − retours en avoir/échange ou réservés − cartes achetées dépensées", () => {
    const r = computeRefundable({
      total: 20_000,
      refunds: [{ amount: 3_000, status: "DONE" }, { amount: 999, status: "REJECTED" }],
      reversals: [{ amount: 1_000, note: refundNote("r1") }, { amount: 2_000, note: "Annulation de commande" }],
      returns: [
        { id: "ret_a", status: "RESOLVED", resolution: "STORE_CREDIT", refundAmount: 4_000, refundId: null },
        { id: "ret_b", status: "RESOLVED", resolution: "REFUND", refundAmount: 1_500, refundId: null },
        { id: "ret_c", status: "RESOLVED", resolution: "REFUND", refundAmount: 3_000, refundId: "r1" },
        { id: "ret_d", status: "RECEIVED", resolution: "NONE", refundAmount: 0, refundId: null },
      ],
      spentPurchasedGiftCards: 500,
    });
    // 20 000 − 3 000 − 2 000 − 4 000 − 1 500 − 500
    expect(r.remaining).toBe(9_000);
    expect(r.refundReversals).toBe(1_000);
  });
  it("le retour en cours de remboursement ne se réserve pas lui-même ; jamais négatif", () => {
    const l = { total: 1_000, refunds: [], reversals: [], returns: [{ id: "ret_b", status: "RESOLVED", resolution: "REFUND", refundAmount: 1_000, refundId: null }], spentPurchasedGiftCards: 0 };
    expect(computeRefundable(l).remaining).toBe(0);
    expect(computeRefundable(l, { excludeReturnId: "ret_b" }).remaining).toBe(1_000);
    expect(computeRefundable({ ...l, refunds: [{ amount: 5_000, status: "DONE" }] }).remaining).toBe(0);
  });
  it("part externe déjà rendue = Σ remboursements − recrédits rattachés", () => {
    expect(externalRefunded({ refunds: [{ amount: 5_000, status: "DONE" }], reversals: [{ amount: 2_000, note: refundNote("x") }, { amount: 700, note: "Annulation de commande" }] })).toBe(3_000);
  });
});

/* ───────────────────────── Enchaînements ───────────────────────── */

describe("remboursement en avoir puis annulation", () => {
  it("les tenders retournent d'abord à leurs instruments, seule la part externe va en avoir ; l'annulation ne rend rien de plus", async () => {
    await refund(7_000, "store_credit");
    expect(card().balance).toBe(5_000); // 4 000 recrédités sur la carte
    expect(customer().storeCreditBalance).toBe(3_000); // part externe seulement
    const reversal = t("giftCardTransaction").find((x) => x.kind === "REVERSAL");
    expect(reversal.note).toContain("refund:");
    await cancel();
    expect(card().balance).toBe(5_000);
    expect(customer().storeCreditBalance).toBe(3_000);
    expect(t("giftCardTransaction").filter((x) => x.kind === "REVERSAL")).toHaveLength(1);
  });
  it("remboursement en avoir partiel couvert par la carte, puis annulation : seul le reliquat de carte est recrédité", async () => {
    await refund(3_000, "store_credit");
    expect(card().balance).toBe(4_000);
    expect(customer().storeCreditBalance).toBe(0);
    await cancel();
    expect(card().balance).toBe(5_000); // 1 000 restants rendus, jamais plus que les 4 000 débités
  });
});

describe("annulation entre deux remboursements « original »", () => {
  it("le total rendu n'excède jamais le total de la commande", async () => {
    await refund(5_000); // part externe
    expect(card().balance).toBe(1_000);
    await cancel(); // recrédit de la carte (4 000), dans la limite du remboursable (5 000)
    expect(card().balance).toBe(5_000);
    await expect(refund(1_500)).rejects.toThrow(/supérieur au remboursable/);
    const last = await refund(1_000);
    expect((last as any).breakdown).toMatchObject({ external: 1_000, giftCards: 0 });
    const refunded = t("refund").reduce((s, r) => s + r.amount, 0);
    const cardsBack = t("giftCardTransaction").filter((x) => x.kind === "REVERSAL").reduce((s, r) => s + r.amount, 0);
    expect(refunded + cardsBack).toBe(10_000);
    await expect(refund(1)).rejects.toThrow();
  });
});

describe("retour résolu en avoir puis remboursement", () => {
  it("le plafond retire la valeur déjà accordée en avoir", async () => {
    seed({ order: { amountDue: 10_000, giftCardAmount: 0 }, cards: [], gcTx: [], returns: [{ id: "ret_1", storeId: S, orderId: O, status: "RESOLVED", resolution: "STORE_CREDIT", refundAmount: 10_000, refundId: null }] });
    await expect(refund(1)).rejects.toThrow(/supérieur au remboursable \(0/);
    seed({ order: { amountDue: 10_000, giftCardAmount: 0 }, cards: [], gcTx: [], returns: [{ id: "ret_1", storeId: S, orderId: O, status: "RESOLVED", resolution: "EXCHANGE", refundAmount: 6_000, refundId: null }] });
    await expect(refund(4_001)).rejects.toThrow(/remboursable/);
    await expect(refund(4_000)).resolves.toBeTruthy();
  });
});

describe("cartes cadeaux achetées par la commande", () => {
  const giftOrder = () =>
    seed({
      order: { total: 30_000, amountDue: 30_000, giftCardAmount: 0 },
      items: [
        { id: "item_gc", orderId: O, productId: "prod_gc", name: "Carte cadeau", quantity: 1, unitPrice: 25_000, lineTotal: 25_000, discountAllocated: 0, isGiftCard: true },
        { id: "item_robe", orderId: O, productId: "prod_1", name: "Robe", quantity: 1, unitPrice: 5_000, lineTotal: 5_000, discountAllocated: 0, isGiftCard: false },
      ],
      // Carte émise par la commande, déjà dépensée de 10 000 sur une autre commande.
      cards: [{ id: "gc_buy", storeId: S, last4: "BBBB", currency: "XOF", balance: 15_000, initialValue: 25_000, status: "ACTIVE", sourceOrderId: O, sourceOrderItemId: "item_gc", sequence: 0 }],
      gcTx: [{ id: "gct_x", storeId: S, giftCardId: "gc_buy", orderId: "order_other", kind: "REDEEM", amount: -10_000, balanceAfter: 15_000, note: null }],
    });

  it("remboursement : la valeur dépensée n'est pas remboursable, le solde restant est retiré et la carte désactivée", async () => {
    giftOrder();
    await expect(refund(20_001)).rejects.toThrow(/remboursable \(20/);
    const r = await refund(20_000);
    expect((r as any).breakdown).toMatchObject({ external: 20_000, purchasedGiftCards: 15_000 });
    expect(card("gc_buy")).toMatchObject({ balance: 0, status: "DISABLED" });
  });
  it("remboursement partiel : d'abord le reste de la commande, la carte n'est touchée qu'au-delà", async () => {
    giftOrder();
    await refund(5_000);
    expect(card("gc_buy").balance).toBe(15_000);
    await refund(2_000);
    expect(card("gc_buy").balance).toBe(13_000);
  });
  it("annulation : cartes désactivées, solde retiré ; le remboursement ensuite exclut la valeur dépensée", async () => {
    giftOrder();
    await cancel();
    expect(card("gc_buy")).toMatchObject({ balance: 0, status: "DISABLED" });
    await expect(refund(20_001)).rejects.toThrow(/remboursable/);
    const r = await refund(20_000);
    expect((r as any).breakdown.purchasedGiftCards).toBe(0); // déjà retiré à l'annulation
  });
  it("cartes pas encore toutes émises : remboursement refusé", async () => {
    giftOrder();
    t("giftCard").length = 0;
    await expect(refund(1_000)).rejects.toThrow(/pas encore toutes émises/);
  });
  it("job d'émission sur une commande annulée : aucune carte", async () => {
    giftOrder();
    t("giftCard").length = 0;
    order().status = "CANCELLED";
    expect(await issueGiftCardsForOrder(O)).toMatchObject({ issued: 0, reason: "cancelled" });
    order().status = "REFUNDED";
    expect(await issueGiftCardsForOrder(O)).toMatchObject({ issued: 0, reason: "cancelled" });
    expect(t("giftCard")).toHaveLength(0);
  });
});

describe("commande d'échange", () => {
  it("le crédit d'échange est un vrai avoir : annuler la commande d'échange le rend au client", async () => {
    seed({
      order: { status: "DELIVERED", amountDue: 10_000, giftCardAmount: 0 },
      cards: [],
      gcTx: [],
      products: [{ id: "prod_x", storeId: S, name: "Chemise", status: "ACTIVE", price: 8_000, promoPrice: null, promoStart: null, promoEnd: null, trackStock: false, stock: 0, inventoryPolicy: "DENY", minQty: 1, maxQty: null, isGiftCard: false }],
    });
    const db = state.fake.db;
    const ex = await createExchangeOrder(db, { storeId: S, sourceOrderId: O, returnId: "ret_ex", items: [{ productId: "prod_x", quantity: 1 }], credit: 10_000, actorId: "user_1", actorLabel: "Test" });
    expect(ex).toMatchObject({ total: 8_000, creditApplied: 8_000, amountDue: 0, surplus: 2_000 });
    expect(customer().storeCreditBalance).toBe(0); // crédité puis débité sur la commande d'échange
    const exOrder = order(ex.orderId);
    expect(exOrder).toMatchObject({ storeCreditAmount: 8_000, paymentStatus: "PAID" });
    Object.assign(exOrder, { status: "NEW", loyaltyPointsRedeemed: 0, giftCardAmount: 0 });
    await cancel(ex.orderId);
    expect(customer().storeCreditBalance).toBe(8_000);
  });
});

describe("base des points de fidélité", () => {
  it("net marchandise hors lignes carte cadeau, moins cartes et avoir utilisés, hors livraison", () => {
    const items = [
      { lineTotal: 25_000, discountAllocated: 0, isGiftCard: true },
      { lineTotal: 20_000, discountAllocated: 2_000, isGiftCard: false },
    ];
    expect(loyaltyBaseAmount({ items, giftCardAmount: 0, storeCreditAmount: 0 })).toBe(18_000);
    expect(loyaltyBaseAmount({ items, giftCardAmount: 5_000, storeCreditAmount: 3_000 })).toBe(10_000);
    expect(loyaltyBaseAmount({ items, giftCardAmount: 50_000 })).toBe(0);
    // Commande antérieure au lot 1 : remise globale retranchée.
    expect(loyaltyBaseAmount({ items: [{ lineTotal: 10_000 }], discount: 1_000 })).toBe(9_000);
  });
});
