import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Services transactionnels des cartes cadeaux (src/lib/giftcards/service.ts) sur base factice :
 * débit conditionnel concurrent, contrôles (expirée, désactivée, devise), recrédit à l'annulation (idempotent),
 * remboursement partiel au prorata, PaymentAttempt gift_card, arrêt d'urgence, idempotence d'émission.
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })), rateLimitAll: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s.replace(/^enc:/, "") }));

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import { hashGiftCardCode } from "@/lib/giftcards/code";
import { redeemGiftCardsTx, reverseGiftCardsTx, lockGiftCardsTx, issueGiftCardsForOrder, previewGiftCardTenders } from "@/lib/giftcards/service";
import { GiftCardError } from "@/lib/giftcards/errors";
import { enqueue } from "@/lib/jobs";

const S = "store_A";
const CODE1 = "KD7M4XQ29PRTH3VW";
const CODE2 = "ABCDEFGHJKMNPQRS";
const CODE3 = "0123456789ABCDEF";
const future = new Date(Date.now() + 90 * 86_400_000);
const sooner = new Date(Date.now() + 10 * 86_400_000);

function card(id: string, code: string, over: Record<string, unknown> = {}) {
  return { id, storeId: S, codeHash: hashGiftCardCode(S, code), codeEnc: `enc:${code}`, last4: code.slice(-4), currency: "XOF", initialValue: 10_000, balance: 10_000, status: "ACTIVE", expiresAt: future, ...over };
}

function seed(cards: Record<string, unknown>[] = [card("gc_1", CODE1)], extra: Record<string, Record<string, unknown>[]> = {}) {
  state.fake = createFakeDb({
    store: [{ id: S, slug: "a", currency: "XOF", status: "PUBLISHED" }],
    order: [{ id: "order_1", storeId: S, currency: "XOF" }],
    giftCard: cards,
    giftCardTransaction: [],
    paymentAttempt: [],
    platformSetting: [],
    ...extra,
  });
}

const tables = () => state.fake!.tables;
const gc = (id: string) => tables().giftCard.find((c) => c.id === id)!;
const tx = () => state.fake!.db;

beforeEach(() => {
  seed();
  vi.mocked(enqueue).mockClear();
});

describe("redeemGiftCardsTx", () => {
  it("débite dans la limite de l'assiette, journalise REDEEM et crée un PaymentAttempt gift_card CONFIRMED", async () => {
    const r = await redeemGiftCardsTx(tx(), S, ["kd7m-4xq2-9prt-h3vw"], 4_000, { orderId: "order_1" });
    expect(r.total).toBe(4_000);
    expect(r.lines[0]).toMatchObject({ giftCardId: "gc_1", last4: "H3VW", amount: 4_000, remainingAfter: 6_000 });
    expect(gc("gc_1").balance).toBe(6_000);
    expect(tables().giftCardTransaction).toEqual([expect.objectContaining({ kind: "REDEEM", amount: -4_000, balanceAfter: 6_000, orderId: "order_1" })]);
    expect(tables().paymentAttempt).toEqual([expect.objectContaining({ orderId: "order_1", provider: "gift_card", status: "CONFIRMED", amount: 4_000, currency: "XOF" })]);
  });

  it("plusieurs cartes : expiration la plus proche d'abord, jamais au-delà du solde", async () => {
    seed([card("gc_1", CODE1), card("gc_2", CODE2, { balance: 3_000, expiresAt: sooner })]);
    const r = await redeemGiftCardsTx(tx(), S, [CODE1, CODE2], 20_000, { orderId: "order_1" });
    expect(r.lines.map((l) => [l.giftCardId, l.amount])).toEqual([["gc_2", 3_000], ["gc_1", 10_000]]);
    expect(r.total).toBe(13_000);
    expect(gc("gc_1").balance).toBe(0);
    expect(gc("gc_2").balance).toBe(0);
  });

  it("débit conditionnel : deux commandes concurrentes ne peuvent pas dépenser deux fois le même solde", async () => {
    seed([card("gc_1", CODE1, { balance: 10_000 })], { order: [{ id: "order_1", storeId: S, currency: "XOF" }, { id: "order_2", storeId: S, currency: "XOF" }] });
    const results = await Promise.allSettled([
      redeemGiftCardsTx(tx(), S, [CODE1], 8_000, { orderId: "order_1" }),
      redeemGiftCardsTx(tx(), S, [CODE1], 8_000, { orderId: "order_2" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const ko = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toBeInstanceOf(GiftCardError);
    expect(gc("gc_1").balance).toBe(2_000);
    expect(gc("gc_1").balance).toBeGreaterThanOrEqual(0);
  });

  it("verrouille les lignes (SELECT … FOR UPDATE) avant lecture du solde", async () => {
    await redeemGiftCardsTx(tx(), S, [CODE1], 1_000, { orderId: "order_1" });
    const raw = state.fake!.calls.filter((c) => c.model === "$raw");
    expect(raw.some((c) => /FOR UPDATE/.test(c.args.sql))).toBe(true);
  });

  it.each([
    ["expirée", { expiresAt: new Date(Date.now() - 1000) }],
    ["désactivée", { status: "DISABLED" }],
    ["statut EXPIRED", { status: "EXPIRED" }],
    ["autre devise", { currency: "EUR" }],
  ])("carte %s : message unique « Carte cadeau invalide », aucun débit", async (_label, over) => {
    seed([card("gc_1", CODE1, over)]);
    await expect(redeemGiftCardsTx(tx(), S, [CODE1], 1_000, { orderId: "order_1" })).rejects.toThrow("Carte cadeau invalide");
    expect(gc("gc_1").balance).toBe(10_000);
    expect(tables().giftCardTransaction).toHaveLength(0);
  });

  it("code inconnu ou mal formé : même message", async () => {
    await expect(redeemGiftCardsTx(tx(), S, [CODE2], 1_000)).rejects.toThrow("Carte cadeau invalide");
    await expect(redeemGiftCardsTx(tx(), S, ["pas-un-code"], 1_000)).rejects.toThrow("Carte cadeau invalide");
  });

  it("carte épuisée : même message unique qu'un code invalide (revue sécurité lot 1)", async () => {
    seed([card("gc_1", CODE1, { balance: 0 })]);
    await expect(redeemGiftCardsTx(tx(), S, [CODE1], 1_000)).rejects.toThrow("Carte cadeau invalide");
  });

  it("au plus 3 cartes, doublons fusionnés", async () => {
    await expect(lockGiftCardsTx(tx(), S, [CODE1, CODE2, CODE3, "ZZZZZZZZZZZZZZZZ"])).rejects.toMatchObject({ code: "too_many" });
    const locked = await lockGiftCardsTx(tx(), S, [CODE1, "kd7m 4xq2 9prt h3vw"]);
    expect(locked).toHaveLength(1);
  });

  it("assiette nulle (panier de cartes cadeaux) : rien n'est débité", async () => {
    const r = await redeemGiftCardsTx(tx(), S, [CODE1], 0, { orderId: "order_1" });
    expect(r.total).toBe(0);
    expect(gc("gc_1").balance).toBe(10_000);
    expect(tables().paymentAttempt).toHaveLength(0);
  });

  it("arrêt d'urgence plateforme : utilisation refusée", async () => {
    seed([card("gc_1", CODE1)], { platformSetting: [{ key: "giftcards.kill_switch", value: { enabled: true, message: "" } }] });
    await expect(redeemGiftCardsTx(tx(), S, [CODE1], 1_000)).rejects.toMatchObject({ code: "suspended" });
    expect(gc("gc_1").balance).toBe(10_000);
  });

  it("commande d'une autre boutique : refus", async () => {
    seed([card("gc_1", CODE1)], { order: [{ id: "order_1", storeId: "store_B", currency: "XOF" }] });
    await expect(redeemGiftCardsTx(tx(), S, [CODE1], 1_000, { orderId: "order_1" })).rejects.toThrow(/Commande introuvable/);
  });

  it("previewGiftCardTenders : même répartition, sans écriture", async () => {
    const p = await previewGiftCardTenders(S, [CODE1], 2_500);
    expect(p).toEqual({ total: 2_500, cards: [{ last4: "H3VW", applied: 2_500, remainingAfter: 7_500 }] });
    expect(gc("gc_1").balance).toBe(10_000);
  });
});

describe("reverseGiftCardsTx", () => {
  it("annulation : recrédite tout le net débité (REVERSAL), puis idempotent", async () => {
    seed([card("gc_1", CODE1), card("gc_2", CODE2, { balance: 3_000, expiresAt: sooner })]);
    await redeemGiftCardsTx(tx(), S, [CODE1, CODE2], 5_000, { orderId: "order_1" });
    expect(gc("gc_2").balance).toBe(0);
    expect(gc("gc_1").balance).toBe(8_000);
    const first = await reverseGiftCardsTx(tx(), S, "order_1");
    expect(first.total).toBe(5_000);
    expect(gc("gc_1").balance).toBe(10_000);
    expect(gc("gc_2").balance).toBe(3_000);
    const second = await reverseGiftCardsTx(tx(), S, "order_1");
    expect(second.total).toBe(0);
    expect(tables().giftCardTransaction.filter((t) => t.kind === "REVERSAL")).toHaveLength(2);
  });

  it("remboursement partiel : au prorata des montants débités, Σ = montant", async () => {
    seed([card("gc_1", CODE1), card("gc_2", CODE2, { balance: 3_000, expiresAt: sooner })]);
    await redeemGiftCardsTx(tx(), S, [CODE1, CODE2], 9_000, { orderId: "order_1" }); // gc_2: 3000, gc_1: 6000
    const r = await reverseGiftCardsTx(tx(), S, "order_1", { amount: 3_001 });
    expect(r.total).toBe(3_001);
    const byCard = Object.fromEntries(r.lines.map((l) => [l.giftCardId, l.amount]));
    expect(byCard.gc_1 + byCard.gc_2).toBe(3_001);
    expect(byCard.gc_1).toBe(2_001);
    expect(byCard.gc_2).toBe(1_000);
    // Le reste reste recréditable, jamais au-delà du débit initial
    const rest = await reverseGiftCardsTx(tx(), S, "order_1", { amount: 100_000 });
    expect(rest.total).toBe(9_000 - 3_001);
  });

  it("ne touche pas aux cartes d'une autre boutique", async () => {
    seed([card("gc_1", CODE1)], { giftCardTransaction: [{ id: "t1", storeId: "store_B", giftCardId: "gc_1", kind: "REDEEM", amount: -5_000, orderId: "order_1" }] });
    const r = await reverseGiftCardsTx(tx(), S, "order_1");
    expect(r.total).toBe(0);
    expect(gc("gc_1").balance).toBe(10_000);
  });
});

describe("issueGiftCardsForOrder", () => {
  // options en tableau : forme acceptée par readGiftCardRecipient (la base factice traite un objet `options` comme une relation).
  function seedOrder(paymentStatus: string) {
    seed([], {
      order: [{ id: "order_1", storeId: S, customerId: "cust_1", currency: "XOF", paymentStatus, customerName: "Awa" }],
      orderItem: [
        { id: "oi_1", orderId: "order_1", productId: "p_gc", unitPrice: 25_000, quantity: 2, isGiftCard: true, options: [{ giftCard: { recipientName: "Koffi", recipientEmail: "k@x.bj" } }] },
        { id: "oi_2", orderId: "order_1", productId: "p_robe", unitPrice: 15_000, quantity: 1, isGiftCard: false, options: [] },
      ],
      product: [{ id: "p_gc", storeId: S, giftCardValidityDays: null }],
    });
  }

  it("jamais avant paiement confirmé", async () => {
    seedOrder("PENDING");
    expect(await issueGiftCardsForOrder("order_1")).toMatchObject({ issued: 0, reason: "unpaid" });
    expect(tables().giftCard).toHaveLength(0);
  });

  it("une carte par unité, journal ISSUE, envoi programmé ; idempotent au second passage", async () => {
    seedOrder("PAID");
    const first = await issueGiftCardsForOrder("order_1");
    expect(first).toEqual({ issued: 2, skipped: 0 });
    expect(tables().giftCard).toHaveLength(2);
    expect(tables().giftCard.map((c) => c.sequence).sort()).toEqual([0, 1]);
    for (const c of tables().giftCard) {
      expect(c).toMatchObject({ storeId: S, source: "PURCHASE", initialValue: 25_000, balance: 25_000, sourceOrderItemId: "oi_1", recipientName: "Koffi", recipientEmail: "k@x.bj", customerId: "cust_1" });
      expect(c.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(c.last4).toHaveLength(4);
    }
    expect(tables().giftCardTransaction.filter((t) => t.kind === "ISSUE")).toHaveLength(2);
    expect(vi.mocked(enqueue).mock.calls.filter((c) => c[0] === "giftcard.deliver")).toHaveLength(2);

    const second = await issueGiftCardsForOrder("order_1");
    expect(second).toEqual({ issued: 0, skipped: 2 });
    expect(tables().giftCard).toHaveLength(2);
  });
});
