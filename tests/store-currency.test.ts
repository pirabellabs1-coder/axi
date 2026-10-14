import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Devise de la boutique : choix à la création (liste fermée), changement tant qu'il n'y a ni commande ni carte
 * cadeau, et saisie des montants en unités majeures pour les devises à centimes (EUR, USD…).
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/locations/service", () => ({ ensureDefaultLocationTx: vi.fn(async () => ({})) }));
vi.mock("@/lib/commerce/quotas", () => ({ checkStoresQuota: vi.fn(async () => ({ allowed: true })), quotaMessage: () => "" }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    effectivePlanId: () => "FREE",
    requireUserOrThrow: vi.fn(async () => ({ id: "user_A", email: "a@example.com" })),
    requireStore: vi.fn(async (storeId: string) => {
      const store = state.fake!.tables.store.find((s) => s.id === storeId);
      if (!store) throw new AuthError("Boutique introuvable ou accès refusé");
      return { user: { id: "user_A" }, store, role: "OWNER", planId: "BUSINESS", can: () => true };
    }),
  };
});

import { changeStoreCurrency, createStore, updateStoreSettings } from "@/lib/store/actions";
import { STORE_CURRENCIES, canChangeStoreCurrency, defaultStoreCurrency, isStoreCurrency } from "@/lib/currency/store-currencies";
import { currencyDecimals, formatMoney, minorToInput, parseMoneyInput, readMoneyField, sanitizeMoneyInput } from "@/lib/money";

const S = "store_A_0001";

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.fake = createFakeDb({
    store: [{ id: S, slug: "boutique-a", name: "Boutique A", country: "BJ", currency: "XOF", marketplaceBlocked: false }],
    paymentMethod: [
      { id: "pm_cod_0001", storeId: S, kind: "CASH_ON_DELIVERY", provider: null, active: true },
      { id: "pm_feda_001", storeId: S, kind: "GATEWAY", provider: "fedapay", active: true },
      { id: "pm_strp_001", storeId: S, kind: "GATEWAY", provider: "stripe", active: true },
    ],
    storeCurrency: [{ id: "sc_eur_0001", storeId: S, currency: "EUR", enabled: true }],
    order: [],
    giftCard: [],
    membership: [],
  });
});

describe("liste des devises de boutique", () => {
  it("liste fermée et pré-sélection par pays", () => {
    expect(isStoreCurrency("EUR")).toBe(true);
    expect(isStoreCurrency("eur")).toBe(false);
    expect(isStoreCurrency("BTC")).toBe(false);
    expect(defaultStoreCurrency("BJ")).toBe("XOF");
    expect(defaultStoreCurrency("CM")).toBe("XAF");
    expect(defaultStoreCurrency("FR")).toBe("EUR");
    expect(defaultStoreCurrency("US")).toBe("USD");
    expect(defaultStoreCurrency("ZZ")).toBe("XOF");
  });

  it("chaque devise proposée est formatable par Intl, avec les bonnes décimales", () => {
    for (const c of STORE_CURRENCIES) {
      expect(() => formatMoney(12345, c)).not.toThrow();
      expect([0, 2]).toContain(currencyDecimals(c));
    }
    expect(currencyDecimals("XOF")).toBe(0);
    expect(currencyDecimals("GNF")).toBe(0);
    expect(currencyDecimals("EUR")).toBe(2);
    expect(currencyDecimals("NGN")).toBe(2);
  });

  it("règle de verrouillage", () => {
    expect(canChangeStoreCurrency(0)).toBe(true);
    expect(canChangeStoreCurrency(1)).toBe(false);
  });
});

describe("unités mineures (devises à centimes)", () => {
  const n = (s: string) => s.replace(/[\s  ]/g, " ");
  it("formatage EUR / USD avec centimes, XOF sans", () => {
    expect(n(formatMoney(1250, "EUR"))).toBe("12,50 €");
    expect(n(formatMoney(199, "USD"))).toBe("1,99 $US");
    expect(n(formatMoney(15000, "XOF"))).toBe("15 000 FCFA");
  });

  it("saisie en unités majeures → stockage en unités mineures", () => {
    expect(parseMoneyInput("12,50", "EUR")).toBe(1250);
    expect(parseMoneyInput("19.9", "USD")).toBe(1990);
    expect(parseMoneyInput("15 000", "XOF")).toBe(15000);
    expect(minorToInput(1250, "EUR")).toBe("12.50");
    expect(minorToInput(1200, "EUR")).toBe("12");
    expect(minorToInput(5, "EUR")).toBe("0.05");
    expect(minorToInput(-250, "EUR")).toBe("-2.50");
    expect(minorToInput(15000, "XOF")).toBe("15000");
    expect(minorToInput(null, "EUR")).toBe("");
  });

  it("filtre de frappe et lecture serveur stricte", () => {
    expect(sanitizeMoneyInput("12,505", "EUR")).toBe("12.50");
    expect(sanitizeMoneyInput("1.2.3", "EUR")).toBe("1.23");
    expect(sanitizeMoneyInput("12,5", "XOF")).toBe("125");
    expect(readMoneyField("12,50", "EUR", 0)).toEqual({ ok: true, value: 1250 });
    expect(readMoneyField("", "EUR", null)).toEqual({ ok: true, value: null });
    expect(readMoneyField("12.505", "EUR", 0)).toEqual({ ok: false });
    expect(readMoneyField("12.5", "XOF", 0)).toEqual({ ok: false });
    expect(readMoneyField("-3", "EUR", 0)).toEqual({ ok: false });
    expect(readMoneyField("99999999999", "XOF", 0)).toEqual({ ok: false });
  });

  it("paramètres : minimum de commande saisi en euros", async () => {
    state.fake!.tables.store[0].currency = "EUR";
    const r = await updateStoreSettings(undefined, fd({ storeId: S, name: "Boutique A", category: "general", minOrderAmount: "12,50" }));
    expect(r).toMatchObject({ ok: true });
    expect(state.fake!.tables.store[0].minOrderAmount).toBe(1250);
    const bad = await updateStoreSettings(undefined, fd({ storeId: S, name: "Boutique A", category: "general", minOrderAmount: "1,234" }));
    expect(bad).toMatchObject({ ok: false, fieldErrors: { minOrderAmount: expect.any(Array) } });
  });
});

describe("création : devise choisie (validation serveur)", () => {
  const base = { name: "Ma boutique", slug: "ma-boutique", country: "BJ", sector: "general" };

  it("refuse une devise hors liste ou absente", async () => {
    for (const currency of ["BTC", "", "EURO"]) {
      const r = await createStore(undefined, fd({ ...base, currency }));
      expect(r).toMatchObject({ ok: false, fieldErrors: { currency: expect.any(Array) } });
    }
    expect(state.fake!.tables.store).toHaveLength(1);
  });

  it("enregistre la devise choisie, indépendante du pays", async () => {
    await expect(createStore(undefined, fd({ ...base, currency: "eur" }))).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT/) });
    const created = state.fake!.tables.store.find((s) => s.slug === "ma-boutique")!;
    expect(created.currency).toBe("EUR");
    expect(created.country).toBe("BJ");
  });
});

describe("paramètres : changement de devise", () => {
  it("autorisé sans commande : désactive les passerelles incompatibles et la devise d'affichage identique", async () => {
    const r = await changeStoreCurrency(undefined, fd({ storeId: S, currency: "EUR" }));
    expect(r).toMatchObject({ ok: true });
    const t = state.fake!.tables;
    expect(t.store[0].currency).toBe("EUR");
    expect(t.paymentMethod.find((m) => m.id === "pm_feda_001")!.active).toBe(false);
    expect(t.paymentMethod.find((m) => m.id === "pm_strp_001")!.active).toBe(true);
    expect(t.paymentMethod.find((m) => m.id === "pm_cod_0001")!.active).toBe(true);
    expect(t.storeCurrency).toHaveLength(0);
  });

  it("bloqué dès qu'une commande existe (historique comptable)", async () => {
    state.fake!.tables.order.push({ id: "order_A_0001", storeId: S, currency: "XOF" });
    const r = await changeStoreCurrency(undefined, fd({ storeId: S, currency: "EUR" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/historique comptable/);
    expect(state.fake!.tables.store[0].currency).toBe("XOF");
  });

  it("bloqué si une carte cadeau a été émise", async () => {
    state.fake!.tables.giftCard.push({ id: "gc_A_000001", storeId: S, currency: "XOF" });
    const r = await changeStoreCurrency(undefined, fd({ storeId: S, currency: "USD" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.store[0].currency).toBe("XOF");
  });

  it("les commandes d'une AUTRE boutique ne bloquent pas", async () => {
    state.fake!.tables.order.push({ id: "order_B_0001", storeId: "store_B_0001", currency: "XOF" });
    const r = await changeStoreCurrency(undefined, fd({ storeId: S, currency: "USD" }));
    expect(r).toMatchObject({ ok: true });
  });

  it("refuse une devise non proposée", async () => {
    const r = await changeStoreCurrency(undefined, fd({ storeId: S, currency: "BTC" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { currency: expect.any(Array) } });
  });
});
