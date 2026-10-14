import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Réglages de taxes : SOURCE UNIQUE (`src/lib/tax/settings.ts`). Le cœur commerce (`previewTotals`,
 * `createOrder`, `createExchangeOrder` via `src/lib/commerce/checkout-context.ts`) et les factures doivent
 * répondre EXACTEMENT la même chose, sinon une boutique collecte la TVA au checkout et imprime autre chose
 * sur sa facture (régime TPS, plan rétrogradé).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));

import { loadTaxSettings as loadByStoreId, storeCollectsTax } from "@/lib/tax/settings";
import { loadTaxSettings as loadForCommerce } from "@/lib/commerce/checkout-context";

const S = "store_tax1";
const future = new Date("2030-01-01T00:00:00Z");
const reg = { legalName: "Boutique", taxId: "IFU 1", rccm: "", address: "Cotonou", regime: "TVA", exemptionMention: "", autoIssueInvoices: true };

type Over = { regime?: string; taxesEnabled?: boolean; planId?: string; country?: string; taxRegistration?: unknown };

function seed(over: Over = {}) {
  state.fake = createFakeDb({
    store: [
      {
        id: S,
        country: over.country ?? "BJ",
        taxesEnabled: over.taxesEnabled ?? true,
        pricesIncludeTax: true,
        taxRegistration: "taxRegistration" in over ? over.taxRegistration : { ...reg, regime: over.regime ?? "TVA" },
      },
    ],
    subscription: [{ id: "sub_1", storeId: S, planId: over.planId ?? "BUSINESS", status: "ACTIVE", currentPeriodEnd: future, trialEndsAt: null }],
    taxRate: [{ id: "tr_1", storeId: S, name: "TVA", country: "BJ", regionKey: "*", taxCategory: "standard", rateBps: 1800, appliesToShipping: true, active: true }],
  });
}

/** La boutique telle que le pipeline la charge (avec son abonnement et son identité fiscale). */
const storeRow = () => {
  const s = state.fake.tables.store[0];
  return { ...s, subscription: state.fake.tables.subscription.find((x: any) => x.storeId === s.id) ?? null };
};

/** Les DEUX chemins : par identifiant (factures) et avec la boutique déjà chargée (checkout). */
async function both() {
  const byId = await loadByStoreId(S, state.fake.db);
  const commerce = await loadForCommerce(state.fake.db, storeRow() as any);
  return { byId, commerce };
}

beforeEach(() => seed());

describe("régime fiscal", () => {
  it("TVA : les deux chemins collectent le taux actif du pays", async () => {
    const { byId, commerce } = await both();
    expect(byId).toMatchObject({ enabled: true, pricesIncludeTax: true });
    expect(byId.rates).toHaveLength(1);
    expect(byId.rates[0]).toMatchObject({ name: "TVA", rateBps: 1800, taxCategory: "standard", appliesToShipping: true });
    expect(commerce).toEqual(byId);
  });

  it("TPS : aucune taxe collectée sur les DEUX chemins (même avec un taux actif)", async () => {
    seed({ regime: "TPS" });
    const { byId, commerce } = await both();
    expect(byId).toEqual({ enabled: false, pricesIncludeTax: true, rates: [] });
    expect(commerce).toBeNull(); // le pipeline attend null = aucune taxe
    expect(storeCollectsTax(storeRow() as any)).toBe(false);
  });

  it("taxes désactivées par le commerçant : aucune taxe, les deux chemins", async () => {
    seed({ taxesEnabled: false });
    const { byId, commerce } = await both();
    expect(byId.enabled).toBe(false);
    expect(commerce).toBeNull();
  });
});

describe("contrôle de plan (features.taxes)", () => {
  it("plan gratuit (ou rétrogradé) : aucune taxe au checkout NI sur les factures", async () => {
    seed({ planId: "FREE" });
    const { byId, commerce } = await both();
    expect(byId).toEqual({ enabled: false, pricesIncludeTax: true, rates: [] });
    expect(commerce).toBeNull();
  });

  it("plan Starter : taxes incluses", async () => {
    seed({ planId: "STARTER" });
    const { byId, commerce } = await both();
    expect(byId.enabled).toBe(true);
    expect(commerce?.enabled).toBe(true);
  });
});

describe("pays de taxation", () => {
  it("le pays de la boutique est normalisé en majuscules sur les deux chemins", async () => {
    seed({ country: "bj" });
    const { byId, commerce } = await both();
    expect(byId.rates).toHaveLength(1);
    expect(commerce?.rates).toHaveLength(1);
  });
});

describe("identité fiscale absente", () => {
  it("aucune identité enregistrée : la taxe est collectée (régime TVA par défaut) mais l'émission automatique non", async () => {
    seed({ taxRegistration: null });
    const { byId, commerce } = await both();
    expect(byId.enabled).toBe(true);
    expect(commerce?.enabled).toBe(true);
  });
});
