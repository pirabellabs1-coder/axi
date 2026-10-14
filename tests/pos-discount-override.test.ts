import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * BLOQUANT n° 1 (suite) — `createPosSale` de bout en bout : la remise au-delà du plafond du rôle
 * n'existe QUE si le code du gérant est vérifié par le serveur.
 *
 * Trois assertions tiennent la correction :
 *  1. un STAFF qui demande 100 % SANS code est refusé (plus de marchandise gratuite) ;
 *  2. avec le bon code, la remise s'applique et la mention « validée par le code du gérant » est
 *     inscrite — elle ne peut donc plus apparaître sans vérification (preuve d'audit non falsifiable) ;
 *  3. l'entrée API n'expose plus aucun champ de dérogation : passer `managerOverride: true` dans la
 *     charge utile ne change rien.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  /** Code gérant accepté par le module de vérification (mocké : la vérification a ses propres tests). */
  goodCode: "4731" as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));
vi.mock("@/lib/pos/manager-code", () => ({
  verifyManagerCode: vi.fn(async (_storeId: string, code: string | null) =>
    state.goodCode && code === state.goodCode ? { ok: true } : { ok: false, reason: "mismatch", error: "Code du gérant incorrect." },
  ),
}));

import { createPosSale, PosError } from "@/lib/pos/service";

const STORE = "store_disc_1";
const DEVICE = "device_disc_1";
const SESSION = "session_disc_1";
const LOCATION = "loc_disc_1";
const OPENED_AT = new Date("2026-10-12T08:00:00.000Z");
const RECEIVED = new Date("2026-10-12T10:00:00.000Z");

function seed() {
  state.goodCode = "4731";
  state.fake = createFakeDb({
    store: [{ id: STORE, slug: "b", name: "Boutique", status: "PUBLISHED", country: "BJ", currency: "XOF", taxesEnabled: false, pricesIncludeTax: true, taxRegistration: null }],
    subscription: [{ id: "sub", storeId: STORE, planId: "BUSINESS", status: "ACTIVE", currentPeriodEnd: new Date("2026-12-31T00:00:00.000Z") }],
    location: [{ id: LOCATION, storeId: STORE, name: "Comptoir", active: true, isDefault: true }],
    posDevice: [{ id: DEVICE, storeId: STORE, locationId: LOCATION, name: "Tablette", lastSyncAt: RECEIVED, revokedAt: null }],
    posSession: [{ id: SESSION, storeId: STORE, deviceId: DEVICE, locationId: LOCATION, status: "OPEN", openedById: "user_staff", openingFloat: 0, openedAt: OPENED_AT }],
    product: [
      {
        id: "prod_1",
        storeId: STORE,
        name: "Pagne",
        status: "ACTIVE",
        kind: "PHYSICAL",
        price: 10_000,
        promoPrice: null,
        trackStock: true,
        stock: 10,
        inventoryPolicy: "CONTINUE",
        taxable: true,
        taxCategory: "standard",
        isGiftCard: false,
        variants: [],
        optionGroups: [],
      },
    ],
    inventoryLevel: [{ id: "lvl", storeId: STORE, locationId: LOCATION, productId: "prod_1", variantId: null, itemKey: "prod_1", available: 10 }],
    order: [],
    customer: [],
  });
}

let n = 0;
type Options = Partial<Parameters<typeof createPosSale>[0]>;
const sale = (o: Options = {}) =>
  createPosSale({
    storeId: STORE,
    deviceId: DEVICE,
    sessionId: SESSION,
    locationId: LOCATION,
    actorId: "user_staff",
    role: "STAFF",
    idempotencyKey: `0190d3${(++n).toString().padStart(2, "0")}-2222-4222-8222-222222222222`,
    items: [{ productId: "prod_1", quantity: 1 }],
    payments: [{ kind: "pos_cash", amount: 10_000 }],
    receivedAt: RECEIVED,
    ...o,
  });

const lastOrder = () => state.fake!.tables.order[state.fake!.tables.order.length - 1];
/** Événements de la commande : créés en relation imbriquée, donc portés par la ligne elle-même. */
const notes = (): string[] => {
  const order = lastOrder() as { events?: { create?: { message?: string }[] } } | undefined;
  const created = order?.events?.create ?? [];
  return created.map((e) => String(e.message ?? ""));
};

beforeEach(() => seed());

describe("remise au-delà du plafond du rôle", () => {
  it("refuse 100 % à un STAFF sans code du gérant (plus de marchandise gratuite)", async () => {
    const error = await sale({ discountPercent: 100, payments: [{ kind: "pos_cash", amount: 1 }] }).catch((e) => e);
    expect(error).toBeInstanceOf(PosError);
    expect((error as PosError).message).toContain("gérant");
    expect(state.fake!.tables.order).toHaveLength(0);
  });

  it("refuse un code du gérant ERRONÉ", async () => {
    await expect(sale({ discountPercent: 100, managerCode: "0000", payments: [{ kind: "pos_cash", amount: 1 }] })).rejects.toBeInstanceOf(PosError);
    expect(state.fake!.tables.order).toHaveLength(0);
  });

  it("ignore un faux drapeau `managerOverride` dans la charge utile (champ supprimé de l'entrée)", async () => {
    const forged = { discountPercent: 100, managerOverride: true, payments: [{ kind: "pos_cash" as const, amount: 1 }] };
    await expect(sale(forged as Options)).rejects.toBeInstanceOf(PosError);
    expect(state.fake!.tables.order).toHaveLength(0);
  });

  it("accepte avec le BON code et trace « validée par le code du gérant »", async () => {
    const result = await sale({ discountPercent: 100, managerCode: "4731", payments: [{ kind: "pos_cash", amount: 1 }] });
    expect(result.total).toBe(0);
    expect(lastOrder().discount).toBe(10_000);
    expect(notes().some((m) => m.includes("validée par le code du gérant"))).toBe(true);
  });

  it("n'exige aucun code dans le plafond du rôle, et n'inscrit alors aucune validation du gérant", async () => {
    const result = await sale({ discountPercent: 10, payments: [{ kind: "pos_cash", amount: 9_000 }] });
    expect(result.total).toBe(9_000);
    expect(notes().some((m) => m.includes("gérant"))).toBe(false);
  });
});
