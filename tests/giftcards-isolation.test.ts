import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Isolation entre boutiques des actions cartes cadeaux et avoir (§8) : un membre de la boutique A ne peut ni lire,
 * ni révéler, ni modifier une carte ou un avoir de la boutique B ; une carte de A est invalide sur la vitrine de B.
 * Contrôle de plan et capacité vérifiés.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_A" as string,
  planId: "BUSINESS" as string,
  caps: new Set<string>(["giftcards.manage", "customers.manage"]),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s.replace(/^enc:/, "") }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  rateLimitAll: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  clientIp: vi.fn(async () => "1.2.3.4"),
  rateLimitMessage: () => "Trop de tentatives.",
}));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (!state.caps.has(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: { id: "user_A" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import { hashGiftCardCode } from "@/lib/giftcards/code";
import { revealGiftCardCode, disableGiftCard, adjustGiftCardBalance, enableGiftCard, resendGiftCard, createGiftCard, checkGiftCardBalance } from "@/lib/giftcards/actions";
import { grantStoreCredit, deductStoreCredit } from "@/lib/store-credit/actions";

const CODE = "KD7M4XQ29PRTH3VW";
const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.member = A;
  state.planId = "BUSINESS";
  state.caps = new Set(["giftcards.manage", "customers.manage"]);
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "boutique-a", status: "PUBLISHED", currency: "XOF", country: "BJ", timezone: "Africa/Porto-Novo" },
      { id: B, slug: "boutique-b", status: "PUBLISHED", currency: "XOF", country: "BJ", timezone: "Africa/Porto-Novo" },
    ],
    giftCard: [
      { id: "giftcard_B1", storeId: B, codeHash: hashGiftCardCode(B, CODE), codeEnc: `enc:${CODE}`, last4: "H3VW", currency: "XOF", initialValue: 25_000, balance: 25_000, status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000 * 30), recipientEmail: "x@y.bj" },
    ],
    giftCardTransaction: [],
    customer: [{ id: "customer_B1", storeId: B, name: "Koffi", phone: "2290197000001", storeCreditBalance: 5_000 }],
    storeCreditTransaction: [],
    platformSetting: [],
  });
});

const cardB = () => state.fake!.tables.giftCard.find((c) => c.id === "giftcard_B1")!;

describe("isolation : un membre de A n'agit jamais sur une carte de B", () => {
  it("révélation, renvoi, réactivation : introuvable", async () => {
    expect(await revealGiftCardCode(A, "giftcard_B1")).toMatchObject({ ok: false, error: "Carte cadeau introuvable." });
    expect(await resendGiftCard(A, "giftcard_B1")).toMatchObject({ ok: false });
    expect(await enableGiftCard(A, "giftcard_B1")).toMatchObject({ ok: false });
  });
  it("en se faisant passer pour B (storeId falsifié) : accès refusé", async () => {
    expect(await revealGiftCardCode(B, "giftcard_B1")).toMatchObject({ ok: false, error: "Boutique introuvable ou accès refusé" });
  });
  it("désactivation et ajustement : introuvable, carte inchangée", async () => {
    expect(await disableGiftCard(undefined, fd({ storeId: A, id: "giftcard_B1", reason: "Fraude" }))).toMatchObject({ ok: false });
    expect(await adjustGiftCardBalance(undefined, fd({ storeId: A, id: "giftcard_B1", direction: "debit", amount: "25000", reason: "Vol" }))).toMatchObject({ ok: false });
    expect(cardB()).toMatchObject({ status: "ACTIVE", balance: 25_000 });
  });
  it("avoir d'un client de B : introuvable, solde inchangé", async () => {
    expect(await grantStoreCredit(undefined, fd({ storeId: A, customerId: "customer_B1", amount: "1000", reason: "Geste" }))).toMatchObject({ ok: false, error: "Client introuvable." });
    expect(await deductStoreCredit(undefined, fd({ storeId: A, customerId: "customer_B1", amount: "5000", reason: "Correction" }))).toMatchObject({ ok: false });
    expect(state.fake!.tables.customer[0].storeCreditBalance).toBe(5_000);
  });
});

describe("vérification publique du solde", () => {
  it("code de B sur la vitrine de A : message unique « Carte cadeau invalide »", async () => {
    expect(await checkGiftCardBalance(undefined, fd({ slug: "boutique-a", code: CODE }))).toEqual({ ok: false, error: "Carte cadeau invalide", fieldErrors: undefined });
  });
  it("code de B sur la vitrine de B : solde et 4 derniers caractères uniquement", async () => {
    const r = await checkGiftCardBalance(undefined, fd({ slug: "boutique-b", code: "kd7m-4xq2-9prt-h3vw" }));
    expect(r).toMatchObject({ ok: true, data: { last4: "H3VW", balance: 25_000, currency: "XOF" } });
    expect(JSON.stringify(r)).not.toContain(CODE);
  });
  it("carte désactivée, code inconnu ou mal formé : même message", async () => {
    cardB().status = "DISABLED";
    for (const code of [CODE, "ABCDEFGHJKMNPQRS", "n'importe quoi"]) {
      expect(await checkGiftCardBalance(undefined, fd({ slug: "boutique-b", code }))).toMatchObject({ ok: false, error: "Carte cadeau invalide" });
    }
  });
  it("arrêt d'urgence : vérification suspendue", async () => {
    state.fake!.tables.platformSetting.push({ key: "giftcards.kill_switch", value: { enabled: true, message: "Maintenance" } });
    expect(await checkGiftCardBalance(undefined, fd({ slug: "boutique-b", code: CODE }))).toMatchObject({ ok: false, error: "Maintenance" });
  });
});

describe("création manuelle : capacité et plan", () => {
  it("rôle sans giftcards.manage : refus", async () => {
    state.caps = new Set(["customers.manage"]);
    expect(await createGiftCard(undefined, fd({ storeId: A, value: "10000" }))).toMatchObject({ ok: false, error: "Votre rôle ne permet pas cette action" });
  });
  it("plan Gratuit : upsell, aucune carte créée", async () => {
    state.planId = "FREE";
    const r = await createGiftCard(undefined, fd({ storeId: A, value: "10000" }));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/abonnement/);
    expect(state.fake!.tables.giftCard).toHaveLength(1);
  });
  it("plan Business : carte créée dans la boutique du membre, code affiché une fois", async () => {
    const r = await createGiftCard(undefined, fd({ storeId: A, value: "10 000", expiresOn: "", recipientName: "Awa" }));
    expect(r).toMatchObject({ ok: true });
    const code = r.ok ? r.data!.code : "";
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const created = state.fake!.tables.giftCard.find((c) => c.id !== "giftcard_B1")!;
    expect(created).toMatchObject({ storeId: A, initialValue: 10_000, balance: 10_000, source: "MANUAL", expiresAt: null });
    expect(created.codeHash).toBe(hashGiftCardCode(A, code.replace(/-/g, "")));
  });
  it("valeur hors limites refusée", async () => {
    expect(await createGiftCard(undefined, fd({ storeId: A, value: "500" }))).toMatchObject({ ok: false });
    expect(await createGiftCard(undefined, fd({ storeId: A, value: "600000" }))).toMatchObject({ ok: false });
  });
});
