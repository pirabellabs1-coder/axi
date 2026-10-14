import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import {
  acceptFromRevokedDevice,
  chunk,
  clampOfflineCreatedAt,
  decidePrice,
  dedupeByKey,
  isSnapshotExpired,
  isUuidV4,
  needsCatalogRefresh,
  validateQueuedSale,
  MAX_OFFLINE_PRICE_DEVIATION,
  OFFLINE_MAX_HOURS,
  REVOKED_GRACE_HOURS,
  SALES_BATCH_SIZE,
} from "@/lib/pos/sync";

/**
 * Caisse hors ligne (lot 3 §2) : idempotence, écart de prix, survente, appareil révoqué, horloge
 * faussée. Partie pure, puis service transactionnel `createPosSale` sur base factice.
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})), queueNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/commerce/checkout-context", () => ({ loadTaxSettings: vi.fn(async () => null) }));
vi.mock("@/lib/discounts/service", () => ({ loadActiveAutomaticDiscounts: vi.fn(async () => []) }));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import { createPosSale, PosError } from "@/lib/pos/service";
import { managerCodeFingerprint } from "@/lib/pos/manager-code";
import { audit } from "@/lib/audit";

const STORE = "store_POS_0001";
const LOCATION = "loc_shop_0001";
const DEVICE = "dev_pos_0001";
const SESSION = "sess_pos_0001";
const PRODUCT = "prod_savon_001";
/** Code du gérant de la boutique factice (bloquant n° 1) : seule son empreinte est en base. */
const MANAGER_CODE = "4731";

function uuid(n: number) {
  return `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
}

function seed(over: { stock?: number; level?: number; price?: number } = {}) {
  return createFakeDb({
    store: [
      {
        id: STORE,
        slug: "boutique",
        name: "Boutique",
        status: "PUBLISHED",
        currency: "XOF",
        country: "BJ",
        minOrderAmount: 0,
        taxesEnabled: false,
        pricesIncludeTax: true,
        posManagerCodeHash: managerCodeFingerprint(STORE, MANAGER_CODE),
        posManagerCodeSetAt: new Date(),
      },
    ],
    subscription: [{ id: "sub_1", storeId: STORE, planId: "BUSINESS", status: "ACTIVE" }],
    location: [{ id: LOCATION, storeId: STORE, name: "Magasin", active: true, isDefault: true }],
    posDevice: [{ id: DEVICE, storeId: STORE, locationId: LOCATION, name: "Tablette", tokenHash: "h", tokenPrefix: "abc123", revokedAt: null, lastSyncAt: null }],
    posSession: [{ id: SESSION, storeId: STORE, deviceId: DEVICE, locationId: LOCATION, status: "OPEN", openedById: "user_1", openingFloat: 10_000 }],
    product: [
      {
        id: PRODUCT,
        storeId: STORE,
        name: "Savon",
        status: "ACTIVE",
        price: over.price ?? 1_000,
        promoPrice: null,
        promoStart: null,
        promoEnd: null,
        trackStock: true,
        stock: over.stock ?? 5,
        inventoryPolicy: "DENY",
        isGiftCard: false,
        kind: "PHYSICAL",
        taxable: true,
        taxCategory: "standard",
        variants: [],
        optionGroups: [],
      },
    ],
    inventoryLevel: [{ id: "lvl_1", storeId: STORE, locationId: LOCATION, productId: PRODUCT, variantId: null, itemKey: PRODUCT, available: over.level ?? 5 }],
  });
}

function sale(key: string, over: Record<string, unknown> = {}) {
  return {
    storeId: STORE,
    deviceId: DEVICE,
    sessionId: SESSION,
    locationId: LOCATION,
    actorId: "user_1",
    role: "MANAGER" as const,
    idempotencyKey: key,
    items: [{ productId: PRODUCT, quantity: 1 }],
    payments: [{ kind: "pos_cash" as const, amount: 1_000 }],
    ...over,
  };
}

beforeEach(() => {
  state.fake = seed();
  vi.mocked(audit).mockClear();
});

describe("partie pure : file et horloge", () => {
  it("lots de 20 au maximum", () => {
    expect(SALES_BATCH_SIZE).toBe(20);
    const items = Array.from({ length: 45 }, (_, i) => i);
    const batches = chunk(items);
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
  });

  it("dédoublonnage sur la clé d'idempotence (le premier gagne)", () => {
    const { unique, duplicates } = dedupeByKey([{ idempotencyKey: "a" }, { idempotencyKey: "b" }, { idempotencyKey: "a" }]);
    expect(unique.map((u) => u.idempotencyKey)).toEqual(["a", "b"]);
    expect(duplicates).toEqual(["a"]);
  });

  it("instantané périmé au-delà de 72 h", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(isSnapshotExpired(new Date("2026-10-10T11:00:00Z"), now)).toBe(false);
    expect(isSnapshotExpired(new Date(now.getTime() - OFFLINE_MAX_HOURS * 3_600_000), now)).toBe(true);
    expect(isSnapshotExpired(null, now)).toBe(true);
  });

  it("rafraîchissement du catalogue toutes les 15 minutes", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(needsCatalogRefresh(new Date(now.getTime() - 5 * 60_000), now)).toBe(false);
    expect(needsCatalogRefresh(new Date(now.getTime() - 16 * 60_000), now)).toBe(true);
  });

  it("appareil révoqué : accepté 24 h, refusé ensuite", () => {
    const revoked = new Date("2026-10-10T00:00:00Z");
    expect(acceptFromRevokedDevice(null)).toBe(true);
    expect(acceptFromRevokedDevice(revoked, new Date(revoked.getTime() + (REVOKED_GRACE_HOURS - 1) * 3_600_000))).toBe(true);
    expect(acceptFromRevokedDevice(revoked, new Date(revoked.getTime() + (REVOKED_GRACE_HOURS + 1) * 3_600_000))).toBe(false);
  });

  it("horloge faussée : date bornée entre la dernière synchronisation et la réception", () => {
    const lastSyncAt = new Date("2026-10-10T08:00:00Z");
    const receivedAt = new Date("2026-10-10T12:00:00Z");
    expect(clampOfflineCreatedAt({ claimed: new Date("2026-10-10T10:00:00Z"), lastSyncAt, receivedAt })).toEqual({ at: new Date("2026-10-10T10:00:00Z"), clamped: false });
    expect(clampOfflineCreatedAt({ claimed: new Date("2020-01-01T00:00:00Z"), lastSyncAt, receivedAt })).toEqual({ at: lastSyncAt, clamped: true });
    expect(clampOfflineCreatedAt({ claimed: new Date("2030-01-01T00:00:00Z"), lastSyncAt, receivedAt })).toEqual({ at: receivedAt, clamped: true });
    expect(clampOfflineCreatedAt({ claimed: null, lastSyncAt, receivedAt })).toEqual({ at: receivedAt, clamped: true });
  });

  it("écart de prix : prix encaissé conservé hors ligne, dans la tolérance", () => {
    expect(decidePrice({ serverTotal: 1_000, collectedTotal: 1_200, offline: true })).toEqual({ total: 1_200, priceSource: "offline_snapshot", gap: 200 });
    expect(decidePrice({ serverTotal: 1_000, collectedTotal: 1_000, offline: true })).toEqual({ total: 1_000, priceSource: "server", gap: 0 });
    // En ligne, le serveur impose toujours son prix.
    expect(decidePrice({ serverTotal: 1_000, collectedTotal: 500, offline: false })).toEqual({ total: 1_000, priceSource: "server", gap: 0 });
    // Hors tolérance : le prix serveur reprend la main (appareil compromis).
    const far = decidePrice({ serverTotal: 1_000, collectedTotal: 100, offline: true });
    expect(far.total).toBe(1_000);
    expect(far.priceSource).toBe("server");
    expect(MAX_OFFLINE_PRICE_DEVIATION).toBe(0.5);
  });

  it("validation de forme d'une vente reçue", () => {
    expect(isUuidV4(uuid(1))).toBe(true);
    expect(isUuidV4("pas-un-uuid")).toBe(false);
    expect(validateQueuedSale({ idempotencyKey: "x", items: [], payments: [] })).toMatchObject({ ok: false });
    expect(validateQueuedSale({ idempotencyKey: uuid(1), items: [{ productId: "p", quantity: 1 }], payments: [{ kind: "pos_cash", amount: 100 }] })).toMatchObject({ ok: true });
    expect(validateQueuedSale({ idempotencyKey: uuid(1), items: [{ productId: "p", quantity: 0 }], payments: [{ kind: "pos_cash", amount: 100 }] })).toMatchObject({ ok: false });
  });
});

describe("createPosSale", () => {
  it("encaisse une vente et décrémente l'agrégat ET le niveau du dépôt", async () => {
    const result = await createPosSale(sale(uuid(1)));
    expect(result.duplicate).toBe(false);
    expect(result.total).toBe(1_000);
    expect(result.priceSource).toBe("server");
    const product = state.fake!.tables.product[0];
    const level = state.fake!.tables.inventoryLevel[0];
    expect(product.stock).toBe(4);
    expect(level.available).toBe(4);
    const order = state.fake!.tables.order[0];
    expect(order).toMatchObject({ channel: "POS", status: "DELIVERED", paymentStatus: "PAID", fulfillmentType: "PICKUP", locationId: LOCATION, posSessionId: SESSION });
    expect(state.fake!.tables.paymentAttempt[0]).toMatchObject({ provider: "pos_cash", status: "CONFIRMED", amount: 1_000 });
  });

  it("idempotence : la même clé renvoie la vente existante sans doubler le stock", async () => {
    const first = await createPosSale(sale(uuid(2)));
    const second = await createPosSale(sale(uuid(2)));
    expect(second.duplicate).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(state.fake!.tables.order).toHaveLength(1);
    expect(state.fake!.tables.product[0].stock).toBe(4);
  });

  it("le serveur recalcule le prix : un total client plus bas est ignoré en ligne", async () => {
    const result = await createPosSale(sale(uuid(3), { collectedTotal: 200, payments: [{ kind: "pos_cash", amount: 1_000 }] }));
    expect(result.total).toBe(1_000);
    expect(result.priceSource).toBe("server");
  });

  it("hors ligne : la vente est enregistrée au prix encaissé, l'écart est audité", async () => {
    // Majeur n° 2 : le hors-ligne est PROUVÉ par le serveur. `deviceLastSyncAt` est l'instantané du
    // catalogue, écrit par le serveur ; un écart réel avec la réception atteste la coupure réseau.
    const result = await createPosSale(
      sale(uuid(4), {
        collectedTotal: 1_200,
        payments: [{ kind: "pos_cash", amount: 1_200 }],
        offlineCreatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        deviceLastSyncAt: new Date(Date.now() - 90 * 60_000),
      }),
    );
    expect(result.priceSource).toBe("offline_snapshot");
    expect(result.priceGap).toBe(200);
    expect(state.fake!.tables.order[0]).toMatchObject({ total: 1_200, priceSource: "offline_snapshot" });
    const actions = vi.mocked(audit).mock.calls.map((c) => c[0].action);
    expect(actions).toContain("pos.price_mismatch");
  });

  it("hors ligne : la survente est acceptée (stock négatif), avec alerte et audit", async () => {
    state.fake = seed({ stock: 1, level: 1 });
    const result = await createPosSale(
      sale(uuid(5), {
        items: [{ productId: PRODUCT, quantity: 3 }],
        payments: [{ kind: "pos_cash", amount: 3_000 }],
        offlineCreatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        deviceLastSyncAt: new Date(Date.now() - 90 * 60_000),
      }),
    );
    expect(result.oversold).toHaveLength(1);
    expect(state.fake!.tables.inventoryLevel[0].available).toBe(-2);
    expect(state.fake!.tables.product[0].stock).toBe(-2);
    const actions = vi.mocked(audit).mock.calls.map((c) => c[0].action);
    expect(actions).toContain("pos.oversold");
  });

  it("refuse un encaissement insuffisant", async () => {
    await expect(createPosSale(sale(uuid(6), { payments: [{ kind: "pos_cash", amount: 500 }] }))).rejects.toBeInstanceOf(PosError);
    expect(state.fake!.tables.order ?? []).toHaveLength(0);
  });

  it("refuse une remise au-delà du plafond du rôle, sauf CODE du gérant vérifié", async () => {
    // Bloquant n° 1 : il n'existe plus de drapeau de dérogation. Un `managerOverride` forgé dans la
    // charge utile est ignoré ; seul un `managerCode` validé par le serveur ouvre le dépassement.
    await expect(createPosSale(sale(uuid(7), { role: "STAFF", discountPercent: 40 }))).rejects.toThrow(/gérant/);
    await expect(createPosSale(sale(uuid(11), { role: "STAFF", discountPercent: 40, managerOverride: true, payments: [{ kind: "pos_cash", amount: 600 }] }))).rejects.toThrow(/gérant/);
    const ok = await createPosSale(sale(uuid(8), { role: "STAFF", discountPercent: 40, managerCode: MANAGER_CODE, payments: [{ kind: "pos_cash", amount: 600 }] }));
    expect(ok.total).toBe(600);
  });

  it("refuse une vente sur une session fermée", async () => {
    state.fake!.tables.posSession[0].status = "CLOSED";
    await expect(createPosSale(sale(uuid(9)))).rejects.toThrow(/fermée/);
  });

  it("refuse un article d'une autre boutique", async () => {
    state.fake!.tables.product[0].storeId = "store_AUTRE_01";
    await expect(createPosSale(sale(uuid(10)))).rejects.toThrow(/disponible/);
  });
});
