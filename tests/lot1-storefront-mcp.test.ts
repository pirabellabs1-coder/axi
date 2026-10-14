import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Lot 1, équipe E : fonctions pures de la vitrine (paliers, destinataire de carte cadeau, badges de remise)
 * et garde-fous des outils MCP de src/lib/mcp/merchant/promotions.ts (confirmations, plan, scopes, transitions).
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/commerce/orders", () => ({ transitionOrder: vi.fn() }));

import { tierState } from "@/components/storefront/promotions/tier-progress";
import { cleanRecipient, giftCardRecipientError } from "@/components/storefront/product/gift-card-form";
import { discountConcernsProduct } from "@/components/storefront/lot1-data";
import { readDiscountConfig } from "@/lib/discounts/schema";
import { createAutomaticDiscount, grantStoreCredit, issueGiftCard, listGiftCards, updateReturnStatus } from "@/lib/mcp/merchant/promotions";
import type { MerchantContext } from "@/lib/mcp/auth";

describe("vitrine : paliers de panier", () => {
  const tiers = [
    { minSubtotal: 20_000, label: "−5 %" },
    { minSubtotal: 50_000, label: "−10 %" },
  ];
  it("palier suivant et progression", () => {
    expect(tierState(tiers, 10_000)).toEqual({ reached: null, next: tiers[0], pct: 50 });
    const mid = tierState(tiers, 35_000);
    expect(mid.reached).toEqual(tiers[0]);
    expect(mid.next).toEqual(tiers[1]);
    expect(mid.pct).toBe(50);
  });
  it("dernier palier atteint : 100 %, plus de palier suivant", () => {
    expect(tierState(tiers, 60_000)).toEqual({ reached: tiers[1], next: null, pct: 100 });
  });
});

describe("vitrine : destinataire de carte cadeau", () => {
  it("exige un nom et un téléphone ou un e-mail", () => {
    const e = giftCardRecipientError({});
    expect(e.recipientName).toBeTruthy();
    expect(e.recipientPhone).toBeTruthy();
    expect(giftCardRecipientError({ recipientName: "Codjo", recipientEmail: "codjo@exemple.com" })).toEqual({});
  });
  it("refuse un e-mail invalide, un message trop long et une date passée", () => {
    const e = giftCardRecipientError({ recipientName: "A", recipientEmail: "pas-un-mail", message: "x".repeat(301), sendAt: "2000-01-01" });
    expect(Object.keys(e).sort()).toEqual(["message", "recipientEmail", "sendAt"]);
  });
  it("nettoie les champs vides et convertit la date", () => {
    const c = cleanRecipient({ recipientName: "  Codjo ", recipientPhone: "", message: "", sendAt: "2099-05-01" });
    expect(c.recipientName).toBe("Codjo");
    expect(c.recipientPhone).toBeUndefined();
    expect(c.message).toBeUndefined();
    expect(c.sendAt).toMatch(/^2099-05-01T/);
  });
});

describe("vitrine : badges « Offres disponibles »", () => {
  const p = { id: "prod_1", collectionIds: ["col_acc"], onSale: false, isGiftCard: false };
  it("2 achetés = 1 offert sur la collection du produit", () => {
    const d = readDiscountConfig("BUY_X_GET_Y", { buy: { target: { collectionIds: ["col_acc"] }, quantity: 2 }, get: { target: { collectionIds: ["col_acc"] }, quantity: 1, value: { type: "PERCENT", amount: 100 } }, maxApplicationsPerOrder: 1, excludeOnSale: true })!;
    expect(discountConcernsProduct(d, p)).toBe(true);
    expect(discountConcernsProduct(d, { ...p, collectionIds: ["autre"] })).toBe(false);
    // Anti-cumul avec les promos datées, et jamais sur une carte cadeau.
    expect(discountConcernsProduct(d, { ...p, onSale: true })).toBe(false);
    expect(discountConcernsProduct(d, { ...p, isGiftCard: true })).toBe(false);
  });
  it("lot : seulement les produits du lot", () => {
    const d = readDiscountConfig("BUNDLE", { items: [{ productId: "prod_1", quantity: 1 }, { productId: "prod_2", quantity: 1 }], price: { type: "FIXED_PRICE", amount: 10_000 }, maxSets: 1 })!;
    expect(discountConcernsProduct(d, p)).toBe(true);
    expect(discountConcernsProduct(d, { ...p, id: "prod_9" })).toBe(false);
  });
});

/* ───────────────────────── MCP ───────────────────────── */

function ctx(over: Partial<MerchantContext> = {}): MerchantContext {
  return {
    store: { id: "store_a", name: "Boutique A", slug: "boutique-a", currency: "XOF", timezone: "Africa/Porto-Novo", status: "PUBLISHED", country: "BJ", whatsappNumber: null } as MerchantContext["store"],
    planId: "BUSINESS",
    role: "OWNER",
    scopes: ["store:read", "orders:read", "orders:write", "customers:read", "marketing:write", "giftcards:write"],
    droppedScopes: [],
    actor: { kind: "token", userId: "uA", label: "api:test", tokenId: "tok_1", grantId: null, clientName: null },
    ip: "127.0.0.1",
    ...over,
  };
}

async function toolError(p: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await p;
  } catch (e) {
    return { message: (e as Error).message, code: (e as { code?: string }).code };
  }
  throw new Error("aurait dû échouer");
}

describe("MCP lot 1 : garde-fous", () => {
  beforeEach(() => {
    state.fake = createFakeDb({
      store: [{ id: "store_a", returnPolicy: null }],
      customer: [{ id: "cust_aaaa1", storeId: "store_a", name: "Grâce", phone: "22997000001", storeCreditBalance: 0 }],
      giftCard: [{ id: "gc_aaaaaaa1", storeId: "store_a", last4: "H3VW", codeHash: "h", codeEnc: "v1.secret", currency: "XOF", initialValue: 25_000, balance: 25_000, status: "ACTIVE", source: "MANUAL", expiresAt: null, createdAt: new Date(), recipientName: "Grâce", customerId: null, sourceOrderId: null }],
      returnRequest: [{ id: "ret_aaaaaa1", storeId: "store_a", reference: "RT-AAAAAA", status: "REQUESTED", orderId: "ord_1", items: [] }],
      order: [],
      automaticDiscount: [],
    });
  });

  it("issue_gift_card : confirmation toujours exigée, rien n'est créé sans", async () => {
    const e = await toolError(issueGiftCard.handler(ctx(), issueGiftCard.input.parse({ value: 10_000, note: "Geste commercial" })));
    expect(e.code).toBe("confirmation_required");
    expect(await state.fake!.db.giftCard.count({ where: { storeId: "store_a" } })).toBe(1);
  });

  it("issue_gift_card : refusé hors plan Business", async () => {
    const e = await toolError(issueGiftCard.handler(ctx({ planId: "STARTER" }), issueGiftCard.input.parse({ value: 10_000, note: "Geste", confirm: true })));
    expect(e.code).toBe("plan_required");
  });

  it("list_gift_cards : 4 derniers caractères seulement, jamais le code chiffré", async () => {
    const out = await listGiftCards.handler(ctx(), listGiftCards.input.parse({}));
    const json = JSON.stringify(out);
    expect(json).toContain("H3VW");
    expect(json).not.toContain("v1.secret");
    expect(json).not.toContain("codeHash");
  });

  it("grant_store_credit : exige aussi customers:read, puis la confirmation", async () => {
    const noCustomers = ctx({ scopes: ["giftcards:write"] });
    expect((await toolError(grantStoreCredit.handler(noCustomers, grantStoreCredit.input.parse({ customer_id: "cust_aaaa1", amount: 1000, reason: "Retard" })))).code).toBe("insufficient_scope");
    expect((await toolError(grantStoreCredit.handler(ctx(), grantStoreCredit.input.parse({ customer_id: "cust_aaaa1", amount: 1000, reason: "Retard" })))).code).toBe("confirmation_required");
  });

  it("create_automatic_discount : −60 % exige une confirmation ; type avancé refusé au plan Starter", async () => {
    const big = { title: "Grosse remise", kind: "PRODUCT_AMOUNT", config: { target: { all: true }, value: { type: "PERCENT", amount: 60 }, perUnit: false, excludeOnSale: true } };
    expect((await toolError(createAutomaticDiscount.handler(ctx(), createAutomaticDiscount.input.parse(big)))).code).toBe("confirmation_required");
    const bxgy = { title: "2 = 1", kind: "BUY_X_GET_Y", config: { buy: { target: { all: true }, quantity: 2 }, get: { target: { all: true }, quantity: 1, value: { type: "PERCENT", amount: 100 } }, maxApplicationsPerOrder: 1, excludeOnSale: true } };
    expect((await toolError(createAutomaticDiscount.handler(ctx({ planId: "STARTER" }), createAutomaticDiscount.input.parse(bxgy)))).code).toBe("plan_required");
    expect(await state.fake!.db.automaticDiscount.count({ where: { storeId: "store_a" } })).toBe(0);
  });

  it("create_automatic_discount : configuration invalide refusée avec son chemin", async () => {
    const bad = { title: "Cassée", kind: "CART_TIER", config: { tiers: [] } };
    const e = await toolError(createAutomaticDiscount.handler(ctx(), createAutomaticDiscount.input.parse(bad)));
    expect(e.message).toMatch(/Invalid config/);
  });

  it("update_return_status : transitions de canTransitionReturn, motif obligatoire pour refuser", async () => {
    expect((await toolError(updateReturnStatus.handler(ctx(), updateReturnStatus.input.parse({ return_id: "ret_aaaaaa1", status: "RESOLVED", resolution: "STORE_CREDIT", confirm: true })))).message).toMatch(/Cannot move RT-AAAAAA from REQUESTED to RESOLVED/);
    expect((await toolError(updateReturnStatus.handler(ctx(), updateReturnStatus.input.parse({ return_id: "ret_aaaaaa1", status: "REJECTED" })))).message).toMatch(/reason/);
    // STAFF : orders:write possible, mais pas la capacité returns.manage.
    expect((await toolError(updateReturnStatus.handler(ctx({ role: "STAFF" }), updateReturnStatus.input.parse({ return_id: "ret_aaaaaa1", status: "APPROVED" })))).code).toBe("forbidden");
  });

  it("update_return_status : un retour d'une autre boutique est introuvable", async () => {
    const other = ctx({ store: { ...ctx().store, id: "store_b" } });
    expect((await toolError(updateReturnStatus.handler(other, updateReturnStatus.input.parse({ return_id: "ret_aaaaaa1", status: "APPROVED" })))).message).toMatch(/not found/);
  });
});
