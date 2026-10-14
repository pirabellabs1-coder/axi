import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Saisie en unités majeures → stockage en unités mineures, selon la devise de la boutique : caisse (fond, mouvements,
 * espèces comptées, contrôle des paiements), résolution d'un retour, bornes des cartes cadeaux. EUR (centimes) et XOF.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
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
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    effectivePlanId: () => "BUSINESS",
    requireStore: vi.fn(async (storeId: string) => {
      const store = state.fake!.tables.store.find((s) => s.id === storeId);
      if (!store) throw new AuthError("Boutique introuvable ou accès refusé");
      return { user: { id: "user_A", name: "Awa" }, store, role: "OWNER", planId: "BUSINESS", can: () => true };
    }),
  };
});
vi.mock("@/lib/pos/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/pos/session")>();
  return {
    ...orig,
    openSession: vi.fn(async (args: Record<string, unknown>) => (state.calls.push({ fn: "open", args }), { id: "sess_A_0001", reopened: false })),
    addCashMovement: vi.fn(async (args: Record<string, unknown>) => (state.calls.push({ fn: "move", args }), {})),
    closeSession: vi.fn(async (args: Record<string, unknown>) => (state.calls.push({ fn: "close", args }), { discrepancy: -250 })),
  };
});
vi.mock("@/lib/returns/service", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/returns/service")>();
  return { ...orig, resolveReturn: vi.fn(async (args: Record<string, unknown>) => (state.calls.push({ fn: "resolve", args }), {})) };
});

import { openPosSession, addPosCashMovement, closePosSession } from "@/lib/pos/actions";
import { checkPayments } from "@/lib/pos/cash";
import { resolveReturn } from "@/lib/returns/actions";
import { giftCardLimits } from "@/lib/giftcards/state";
import { STORE_CURRENCIES } from "@/lib/currency/store-currencies";


const S = "store_A_0001";
const DEV = "dev_A_00001";
const SESS = "sess_A_0001";
const RET = "ret_A_00001";

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
const n = (s: string) => s.replace(/[\s  ]/g, " ");
const last = (fn: string) => [...state.calls].reverse().find((c) => c.fn === fn)?.args;

function setup(currency: string) {
  state.calls = [];
  state.fake = createFakeDb({
    store: [{ id: S, slug: "boutique-a", name: "Boutique A", country: "BJ", currency, returnPolicy: null }],
    posDevice: [{ id: DEV, storeId: S, revokedAt: null, locationId: "loc_A_0001" }],
  });
}

describe("caisse : montants saisis en unités majeures", () => {
  beforeEach(() => setup("EUR"));

  it("EUR : fond de caisse, mouvement et espèces comptées convertis en centimes", async () => {
    expect(await openPosSession(undefined, fd({ storeId: S, deviceId: DEV, openingFloat: "50,00" }))).toMatchObject({ ok: true });
    expect(last("open")!.openingFloat).toBe(5000);

    expect(await addPosCashMovement(undefined, fd({ storeId: S, sessionId: SESS, kind: "out", amount: "3,20", reason: "Sachets" }))).toMatchObject({ ok: true });
    expect(last("move")!.amount).toBe(320);

    const r = await closePosSession(undefined, fd({ storeId: S, sessionId: SESS, countedCash: "47.30" }));
    expect(r).toMatchObject({ ok: true });
    expect(last("close")!.countedCash).toBe(4730);
    if (r.ok) expect(n(r.message ?? "")).toContain("−2,50 €");
  });

  it("EUR : 3 décimales, montant vide ou nul refusés", async () => {
    expect(await openPosSession(undefined, fd({ storeId: S, deviceId: DEV, openingFloat: "1,234" }))).toMatchObject({ ok: false, fieldErrors: { openingFloat: expect.any(Array) } });
    expect(await addPosCashMovement(undefined, fd({ storeId: S, sessionId: SESS, kind: "in", amount: "0", reason: "Test" }))).toMatchObject({ ok: false });
    expect(await closePosSession(undefined, fd({ storeId: S, sessionId: SESS, countedCash: "" }))).toMatchObject({ ok: false, fieldErrors: { countedCash: expect.any(Array) } });
    expect(state.calls).toHaveLength(0);
  });

  it("XOF : entiers inchangés, décimales refusées", async () => {
    setup("XOF");
    expect(await openPosSession(undefined, fd({ storeId: S, deviceId: DEV, openingFloat: "25 000" }))).toMatchObject({ ok: true });
    expect(last("open")!.openingFloat).toBe(25000);
    expect(await addPosCashMovement(undefined, fd({ storeId: S, sessionId: SESS, kind: "out", amount: "500,5", reason: "Sachets" }))).toMatchObject({ ok: false });
    const r = await closePosSession(undefined, fd({ storeId: S, sessionId: SESS, countedCash: "24750" }));
    expect(last("close")!.countedCash).toBe(24750);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(n(r.message ?? "")).toContain("−250 FCFA");
  });

  it("contrôle des paiements : message dans la devise de la boutique", () => {
    const eur = checkPayments(1250, [{ kind: "pos_cash", amount: 1000 }], "EUR");
    expect(eur.ok).toBe(false);
    if (!eur.ok) expect(n(eur.error)).toBe("Il manque 2,50 €.");
    const xof = checkPayments(10_000, [{ kind: "pos_cash", amount: 9_500 }], "XOF");
    expect(xof.ok).toBe(false);
    if (!xof.ok) expect(n(xof.error)).toBe("Il manque 500 FCFA.");
    expect(checkPayments(1250, [{ kind: "pos_cash", amount: 2000 }], "EUR")).toEqual({ ok: true, paid: 2000, change: 750 });
  });
});

describe("retours : montant retenu saisi à la main", () => {
  it("EUR : « 12,50 » → 1250 centimes ; vide = montant suggéré ; 3 décimales refusées", async () => {
    setup("EUR");
    expect(await resolveReturn(undefined, fd({ storeId: S, returnId: RET, resolution: "STORE_CREDIT", amount: "12,50" }))).toMatchObject({ ok: true });
    expect(last("resolve")!.amount).toBe(1250);
    await resolveReturn(undefined, fd({ storeId: S, returnId: RET, resolution: "STORE_CREDIT", amount: "" }));
    expect(last("resolve")!.amount).toBeNull();
    const bad = await resolveReturn(undefined, fd({ storeId: S, returnId: RET, resolution: "STORE_CREDIT", amount: "12,505" }));
    expect(bad).toMatchObject({ ok: false, fieldErrors: { amount: expect.any(Array) } });
  });

  it("XOF : entier inchangé, décimales refusées", async () => {
    setup("XOF");
    await resolveReturn(undefined, fd({ storeId: S, returnId: RET, resolution: "STORE_CREDIT", amount: "7 500" }));
    expect(last("resolve")!.amount).toBe(7500);
    expect(await resolveReturn(undefined, fd({ storeId: S, returnId: RET, resolution: "STORE_CREDIT", amount: "7500,5" }))).toMatchObject({ ok: false });
  });
});

describe("cartes cadeaux : bornes pour toutes les devises de boutique", () => {
  it("XOF et EUR inchangés", () => {
    expect(giftCardLimits("XOF")).toMatchObject({ minValue: 1_000, maxValue: 500_000, maxPerOrder: 1_000_000 });
    expect(giftCardLimits("EUR")).toMatchObject({ minValue: 152, maxValue: 76_225, maxPerOrder: 152_449 });
  });

  it("USD en centimes (2 $ à 800 $), plus de copie des nombres FCFA", () => {
    expect(giftCardLimits("USD")).toMatchObject({ minValue: 200, maxValue: 80_000, maxPerOrder: 160_000 });
    expect(giftCardLimits("GNF")).toMatchObject({ minValue: 15_000, maxValue: 7_000_000 });
  });

  it("chaque devise proposée a des bornes cohérentes (min < max ≤ total, ordre de grandeur ≈ 1 000 à 500 000 FCFA)", () => {
    const xofMax = giftCardLimits("XOF").maxValue;
    for (const c of STORE_CURRENCIES) {
      const l = giftCardLimits(c);
      expect(l.minValue, c).toBeGreaterThan(0);
      expect(l.minValue, c).toBeLessThan(l.maxValue);
      expect(l.maxValue, c).toBeLessThanOrEqual(l.maxPerOrder);
      expect(l.maxPerOrder, c).toBeLessThanOrEqual(1_000_000_000);
      // Rapport max/min ≈ 500 (FCFA) : entre 300 et 1 000 pour toutes les devises.
      const ratio = l.maxValue / l.minValue;
      expect(ratio, c).toBeGreaterThanOrEqual(300);
      expect(ratio, c).toBeLessThanOrEqual(1000);
    }
    expect(xofMax).toBe(500_000);
  });
});
