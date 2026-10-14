import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Isolation entre boutiques des actions marchandes du lot 1 (spec §8 et §9, `security-lot1.test.ts`).
 * Pour CHAQUE action qui reçoit un identifiant : un membre de la boutique A (toutes capacités, plan Business) qui vise
 * un identifiant de la boutique B obtient « introuvable », et aucune ligne n'est modifiée (instantané des tables
 * identique, aucun audit, aucun job). Toute écriture éventuellement tentée est filtrée par la boutique du membre.
 * Complète `giftcards-isolation.test.ts` et `returns-isolation.test.ts`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({
  fake: null as any,
  member: "store_AAAAAAAA",
  audits: [] as unknown[],
  jobs: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));
vi.mock("@/lib/audit", () => ({
  audit: async (entry: unknown) => {
    state.audits.push(entry);
  },
}));
vi.mock("@/lib/jobs", () => ({
  enqueue: async (type: string, payload: unknown) => {
    state.jobs.push({ type, payload });
  },
}));
vi.mock("@/lib/email", () => ({ sendMail: async () => ({ ok: true }) }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s.replace(/^enc:/, "") }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitAll: async () => ({ ok: true, retryAfter: 0 }),
  clientIp: async () => "1.2.3.4",
  normalizeIp: (ip: string) => ip,
  rateLimitMessage: () => "Trop de tentatives.",
}));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    effectivePlanId: () => "BUSINESS",
    requireStore: async (storeId: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      const store = state.fake.tables.store.find((s: any) => s.id === storeId);
      return { user: { id: "user_AAAAAAAA", name: "Awa" }, store, role: "OWNER", planId: "BUSINESS", can: () => true };
    },
  };
});

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import {
  deleteAutomaticDiscount,
  deleteCartOffer,
  duplicateAutomaticDiscount,
  toggleAutomaticDiscount,
  toggleCartOffer,
  upsertAutomaticDiscount,
  upsertCartOffer,
} from "@/lib/discounts/actions";
import { revokeBuyerSessions } from "@/lib/buyer/merchant-actions";
import { extendGiftCard } from "@/lib/giftcards/actions";
import { quoteReturnAction } from "@/lib/returns/actions";
import { refundOrder } from "@/lib/orders/actions";
import { adjustLoyaltyPoints } from "@/lib/loyalty/actions";

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";
const FAR = new Date(Date.now() + 60 * 86_400_000);
const tomorrow = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

function seed() {
  const store = (id: string, slug: string) => ({ id, slug, status: "PUBLISHED", currency: "XOF", country: "BJ", timezone: "Africa/Porto-Novo", returnPolicy: null });
  state.fake = createFakeDb({
    store: [store(A, "boutique-a"), store(B, "boutique-b")],
    product: [
      { id: "prod_A_0001", storeId: A, name: "Pagne A", status: "ACTIVE", isGiftCard: false },
      { id: "prod_A_0002", storeId: A, name: "Sac A", status: "ACTIVE", isGiftCard: false },
      { id: "prod_B_0001", storeId: B, name: "Pagne B", status: "ACTIVE", isGiftCard: false },
      { id: "prod_B_0002", storeId: B, name: "Sac B", status: "ACTIVE", isGiftCard: false },
    ],
    category: [{ id: "col_B_00001", storeId: B, name: "Wax B" }],
    automaticDiscount: [
      { id: "disc_B_00001", storeId: B, title: "Remise B", kind: "PRODUCT_AMOUNT", config: { target: { all: true }, value: { type: "PERCENT", amount: 10 }, perUnit: false, excludeOnSale: true }, priority: 0, combinesWithCoupons: true, combinesWithOtherAutomatic: true, startsAt: null, endsAt: null, active: true, maxUses: null, usesCount: 0 },
    ],
    cartOffer: [
      { id: "offer_B_0001", storeId: B, title: "Offre B", placement: "CART", mode: "add", triggerProductIds: ["prod_B_0001"], triggerCollectionIds: [], offerProductIds: ["prod_B_0002"], automaticDiscountId: null, position: 0, active: true, conversions: 0, revenue: 0 },
    ],
    customer: [
      { id: "cust_B_00001", storeId: B, name: "Koffi", phone: "2290197000001", loyaltyPoints: 120, storeCreditBalance: 5_000 },
      { id: "cust_A_00001", storeId: A, name: "Awa", phone: "2290197000002", loyaltyPoints: 10, storeCreditBalance: 0 },
    ],
    customerSession: [{ id: "sess_B_00001", storeId: B, customerId: "cust_B_00001", tokenHash: "h".repeat(64), expiresAt: FAR, revokedAt: null }],
    giftCard: [{ id: "giftcard_B_01", storeId: B, codeHash: "x".repeat(64), codeEnc: "enc:KD7M4XQ29PRTH3VW", last4: "H3VW", currency: "XOF", initialValue: 25_000, balance: 25_000, status: "EXPIRED", expiresAt: new Date(Date.now() - 86_400_000) }],
    giftCardTransaction: [],
    order: [{ id: "order_B_0001", storeId: B, reference: "AX-B0001", status: "DELIVERED", paymentStatus: "PAID", total: 20_000, subtotal: 20_000, deliveryFee: 0, discount: 0, currency: "XOF", customerId: "cust_B_00001", deliveredAt: new Date() }],
    orderItem: [{ id: "item_B_0001", orderId: "order_B_0001", productId: "prod_B_0001", name: "Pagne B", unitPrice: 10_000, quantity: 2, lineTotal: 20_000, discountAllocated: 0, isGiftCard: false }],
    returnRequest: [{ id: "ret_B_000001", storeId: B, orderId: "order_B_0001", customerId: "cust_B_00001", reference: "RT-BBBBBB", status: "RECEIVED", resolution: "NONE", requestedBy: "customer", reason: "size", refundAmount: 0, storeCreditAmount: 0, refundShipping: false, restockingFee: 0 }],
    returnItem: [{ id: "ritem_B_0001", returnId: "ret_B_000001", orderItemId: "item_B_0001", quantity: 1, restock: true, restockedQty: 0 }],
    refund: [],
    storeCreditTransaction: [],
    loyaltyLedger: [],
  });
  state.member = A;
  state.audits = [];
  state.jobs = [];
}

function fd(o: Record<string, unknown>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) for (const x of v) f.append(`${k}[]`, String(x)); // comme MultiPicker (`name[]`)
    else f.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  return f;
}

const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/**
 * Exécute l'action et vérifie : échec « introuvable », tables strictement identiques, aucun audit ni job, et toute
 * écriture tentée (ex. `updateMany` servant de contrôle d'existence) filtrée par la boutique du membre.
 */
async function expectNotFound(run: () => Promise<{ ok: boolean; error?: string }>, message: RegExp = /introuvable/i) {
  const before = JSON.stringify(state.fake.tables);
  const callsBefore = state.fake.calls.length;
  const r = await run();
  expect(r.ok).toBe(false);
  expect(r.error ?? "").toMatch(message);
  expect(JSON.stringify(state.fake.tables)).toBe(before);
  expect(state.audits).toEqual([]);
  expect(state.jobs).toEqual([]);
  for (const c of state.fake.calls.slice(callsBefore).filter((c: any) => WRITES.has(c.op))) {
    const scope = c.args?.where?.storeId ?? c.args?.data?.storeId;
    expect(scope, `${c.model}.${c.op} sans filtre de boutique`).toBe(A);
  }
}

const discountForm = (extra: Record<string, unknown> = {}) =>
  fd({ storeId: A, title: "Remise piratée", kind: "PRODUCT_AMOUNT", config: { target: { all: true }, value: { type: "PERCENT", amount: 90 }, perUnit: false, excludeOnSale: true }, priority: "0", active: "on", ...extra });

const offerForm = (extra: Record<string, unknown> = {}) =>
  fd({ storeId: A, title: "Offre piratée", placement: "CART", mode: "add", triggerProductIds: ["prod_A_0001"], offerProductIds: ["prod_A_0002"], position: "0", active: "on", ...extra });

beforeEach(seed);

describe("remises automatiques : identifiant de B visé par un membre de A", () => {
  it("upsertAutomaticDiscount (mise à jour)", async () => {
    await expectNotFound(() => upsertAutomaticDiscount(undefined, discountForm({ id: "disc_B_00001" })));
  });
  it("toggleAutomaticDiscount (désactiver et activer)", async () => {
    await expectNotFound(() => toggleAutomaticDiscount(A, "disc_B_00001", false));
    await expectNotFound(() => toggleAutomaticDiscount(A, "disc_B_00001", true));
  });
  it("duplicateAutomaticDiscount", async () => {
    await expectNotFound(() => duplicateAutomaticDiscount(A, "disc_B_00001"));
  });
  it("deleteAutomaticDiscount", async () => {
    await expectNotFound(() => deleteAutomaticDiscount(A, "disc_B_00001"));
  });
  it("création référençant un produit ou une collection de B : refusée", async () => {
    await expectNotFound(
      () => upsertAutomaticDiscount(undefined, discountForm({ config: { target: { productIds: ["prod_B_0001"] }, value: { type: "PERCENT", amount: 10 }, perUnit: false, excludeOnSale: true } })),
      /n'existe plus/,
    );
    await expectNotFound(
      () => upsertAutomaticDiscount(undefined, discountForm({ config: { target: { collectionIds: ["col_B_00001"] }, value: { type: "PERCENT", amount: 10 }, perUnit: false, excludeOnSale: true } })),
      /n'existe plus/,
    );
  });
});

describe("offres au panier : identifiant de B visé par un membre de A", () => {
  it("upsertCartOffer (mise à jour)", async () => {
    await expectNotFound(() => upsertCartOffer(undefined, offerForm({ id: "offer_B_0001" })));
  });
  it("toggleCartOffer (désactiver et activer)", async () => {
    await expectNotFound(() => toggleCartOffer(A, "offer_B_0001", false));
    await expectNotFound(() => toggleCartOffer(A, "offer_B_0001", true));
  });
  it("deleteCartOffer", async () => {
    await expectNotFound(() => deleteCartOffer(A, "offer_B_0001"));
  });
  it("création avec un produit de B ou une remise liée de B : refusée", async () => {
    await expectNotFound(() => upsertCartOffer(undefined, offerForm({ offerProductIds: ["prod_B_0002"] })), /n'existe plus/);
    await expectNotFound(() => upsertCartOffer(undefined, offerForm({ automaticDiscountId: "disc_B_00001" })), /remise sur des produits de votre boutique/);
  });
});

describe("comptes acheteurs, cartes, retours, remboursements, fidélité", () => {
  it("revokeBuyerSessions : client de B introuvable, session intacte", async () => {
    await expectNotFound(() => revokeBuyerSessions(A, "cust_B_00001"));
    expect(state.fake.tables.customerSession[0].revokedAt).toBeNull();
  });
  it("extendGiftCard : carte de B introuvable, toujours expirée", async () => {
    await expectNotFound(() => extendGiftCard(undefined, fd({ storeId: A, id: "giftcard_B_01", expiresOn: tomorrow() })));
    expect(state.fake.tables.giftCard[0].status).toBe("EXPIRED");
  });
  it("quoteReturnAction : retour de B introuvable (aucun montant divulgué)", async () => {
    await expectNotFound(() => quoteReturnAction(A, "ret_B_000001", { refundShipping: true, waiveRestockingFee: true }));
  });
  it("refundOrder : commande de B introuvable, vers l'original comme vers l'avoir", async () => {
    await expectNotFound(() => refundOrder(A, "order_B_0001", 5_000, "test", "original"));
    await expectNotFound(() => refundOrder(A, "order_B_0001", 5_000, "test", "store_credit"));
  });
  it("adjustLoyaltyPoints : client de B introuvable, points inchangés", async () => {
    await expectNotFound(() => adjustLoyaltyPoints(undefined, fd({ storeId: A, customerId: "cust_B_00001", kind: "remove", points: "100", note: "Correction" })));
    await expectNotFound(() => adjustLoyaltyPoints(undefined, fd({ storeId: A, customerId: "cust_B_00001", kind: "add", points: "100", note: "Cadeau" })));
    expect(state.fake.tables.customer.find((c: any) => c.id === "cust_B_00001").loyaltyPoints).toBe(120);
  });
  it("storeId de B falsifié par un membre de A : accès refusé, sans écriture", async () => {
    const denied = /accès refusé/;
    await expectNotFound(() => toggleAutomaticDiscount(B, "disc_B_00001", false), denied);
    await expectNotFound(() => deleteCartOffer(B, "offer_B_0001"), denied);
    await expectNotFound(() => revokeBuyerSessions(B, "cust_B_00001"), denied);
    await expectNotFound(() => upsertCartOffer(undefined, offerForm({ storeId: B, id: "offer_B_0001" })), denied);
  });
});

describe("témoin : les mêmes actions fonctionnent dans la boutique du membre", () => {
  it("création puis désactivation d'une remise et d'une offre de A, points d'un client de A", async () => {
    expect(await upsertAutomaticDiscount(undefined, discountForm({ config: { target: { all: true }, value: { type: "PERCENT", amount: 10 }, perUnit: false, excludeOnSale: true } }))).toMatchObject({ ok: true });
    const disc = state.fake.tables.automaticDiscount.find((d: any) => d.storeId === A);
    expect(await toggleAutomaticDiscount(A, disc.id, false)).toMatchObject({ ok: true });
    expect(await upsertCartOffer(undefined, offerForm())).toMatchObject({ ok: true });
    const offer = state.fake.tables.cartOffer.find((o: any) => o.storeId === A);
    expect(await toggleCartOffer(A, offer.id, false)).toMatchObject({ ok: true });
    // Points de fidélité d'un client de A : ajout puis retrait, journalisés dans A.
    expect(await adjustLoyaltyPoints(undefined, fd({ storeId: A, customerId: "cust_A_00001", kind: "add", points: "50", note: "Cadeau" }))).toMatchObject({ ok: true });
    expect(await adjustLoyaltyPoints(undefined, fd({ storeId: A, customerId: "cust_A_00001", kind: "remove", points: "20", note: "Correction" }))).toMatchObject({ ok: true });
    expect(state.fake.tables.customer.find((c: any) => c.id === "cust_A_00001").loyaltyPoints).toBe(40);
    expect(state.fake.tables.loyaltyLedger.map((l: any) => [l.storeId, l.delta])).toEqual([[A, 50], [A, -20]]);
    // B intacte.
    expect(state.fake.tables.customer.find((c: any) => c.id === "cust_B_00001").loyaltyPoints).toBe(120);
    expect(state.fake.tables.automaticDiscount.find((d: any) => d.id === "disc_B_00001").active).toBe(true);
    expect(state.fake.tables.cartOffer.find((o: any) => o.id === "offer_B_0001").active).toBe(true);
  });
});
