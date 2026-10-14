import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Vente en caisse (`createPosSale`) — correctifs de la revue de la vague 3 :
 *
 *  - bloquant n° 3 : un refus RÉCUPÉRABLE (session fermée, article indisponible, plafond de remise)
 *    porte `permanent: false` → l'appareil garde la vente en file ; seule une vente définitivement
 *    invalide (sans article, quantité aberrante) est `permanent: true` ;
 *  - bloquant n° 4 : l'horodatage d'une vente hors ligne est borné par l'OUVERTURE DE LA SESSION, pas
 *    par `lastSyncAt` : elle garde sa date réelle et la tarification de ce moment-là ;
 *  - majeur n° 6 : la remise manuelle de caisse recalcule la TVA (plus de surdéclaration).
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
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));
vi.mock("@/lib/pos/manager-code", () => ({ verifyManagerCode: vi.fn(async () => ({ ok: false, error: "Code du gérant incorrect." })) }));

import { createPosSale, PosError } from "@/lib/pos/service";

const STORE = "store_pos_1";
const DEVICE = "device_pos_1";
const SESSION = "session_pos_1";
const LOCATION = "loc_pos_1";

const OPENED_AT = new Date("2026-10-10T08:00:00.000Z");
const SOLD_AT = new Date("2026-10-10T10:00:00.000Z");
/** La promotion s'arrête APRÈS la vente et AVANT la dernière synchronisation : enjeu du bloquant n° 4. */
const PROMO_END = new Date("2026-10-10T10:15:00.000Z");
/**
 * Dernière synchronisation connue de l'appareil, POSTÉRIEURE à la vente : c'est le cas réel (un
 * rafraîchissement de catalogue, puis le réseau retombe). Elle ne doit pas servir de borne d'horloge.
 */
const LAST_SYNC_AT = new Date("2026-10-10T10:30:00.000Z");
const SYNCED_AT = new Date("2026-10-10T18:00:00.000Z");

function seed(opts: { taxes?: boolean; sessionStatus?: "OPEN" | "CLOSED"; promo?: boolean } = {}) {
  state.fake = createFakeDb({
    store: [
      {
        id: STORE,
        slug: "boutique",
        name: "Boutique",
        status: "PUBLISHED",
        country: "BJ",
        currency: "XOF",
        taxesEnabled: opts.taxes === true,
        pricesIncludeTax: true,
        taxRegistration: null,
      },
    ],
    subscription: [{ id: "sub_1", storeId: STORE, planId: "BUSINESS", status: "ACTIVE", currentPeriodEnd: new Date("2026-12-31T00:00:00.000Z") }],
    taxRate: opts.taxes ? [{ id: "tr_1", storeId: STORE, country: "BJ", regionKey: "*", active: true, name: "TVA 18 %", rateBps: 1_800, taxCategory: "standard", appliesToShipping: true }] : [],
    location: [{ id: LOCATION, storeId: STORE, name: "Comptoir", active: true, isDefault: true }],
    posDevice: [{ id: DEVICE, storeId: STORE, locationId: LOCATION, name: "Tablette", lastSyncAt: LAST_SYNC_AT, revokedAt: null }],
    posSession: [{ id: SESSION, storeId: STORE, deviceId: DEVICE, locationId: LOCATION, status: opts.sessionStatus ?? "OPEN", openedById: "user_1", openingFloat: 0, openedAt: OPENED_AT }],
    product: [
      {
        id: "prod_pagne",
        storeId: STORE,
        name: "Pagne",
        status: "ACTIVE",
        kind: "PHYSICAL",
        price: 10_000,
        promoPrice: opts.promo ? 8_000 : null,
        promoStart: opts.promo ? OPENED_AT : null,
        promoEnd: opts.promo ? PROMO_END : null,
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
    inventoryLevel: [{ id: "lvl_1", storeId: STORE, locationId: LOCATION, productId: "prod_pagne", variantId: null, itemKey: "prod_pagne", available: 10 }],
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
    actorId: "user_1",
    role: "OWNER",
    idempotencyKey: `0190d2${(++n).toString().padStart(2, "0")}-1111-4111-8111-111111111111`,
    items: [{ productId: "prod_pagne", quantity: 1 }],
    payments: [{ kind: "pos_cash", amount: 10_000 }],
    receivedAt: SYNCED_AT,
    ...o,
  });

const lastOrder = () => state.fake!.tables.order[state.fake!.tables.order.length - 1];
const items = () => state.fake!.tables.orderItem ?? [];

beforeEach(() => seed());

describe("refus récupérable ou définitif (bloquant n° 3)", () => {
  it("vente sans article : refus DÉFINITIF (la vente peut quitter la file)", async () => {
    await expect(sale({ items: [] })).rejects.toMatchObject({ permanent: true });
  });

  it("quantité aberrante : refus DÉFINITIF", async () => {
    await expect(sale({ items: [{ productId: "prod_pagne", quantity: 100_000 }] })).rejects.toMatchObject({ permanent: true });
  });

  it("session fermée : refus RÉCUPÉRABLE, la vente reste en file", async () => {
    seed({ sessionStatus: "CLOSED" });
    const error = await sale().catch((e) => e);
    expect(error).toBeInstanceOf(PosError);
    expect((error as PosError).permanent).toBe(false);
    // Aucune commande créée : l'argent est en caisse, la vente doit être rejouée.
    expect(state.fake!.tables.order).toHaveLength(0);
  });

  it("article devenu indisponible : refus RÉCUPÉRABLE", async () => {
    state.fake!.tables.product[0].status = "ARCHIVED";
    await expect(sale()).rejects.toMatchObject({ permanent: false });
  });

  it("remise au-delà du plafond sans code gérant valide : refus RÉCUPÉRABLE", async () => {
    const error = await sale({ role: "STAFF", discountPercent: 40, payments: [{ kind: "pos_cash", amount: 6_000 }] }).catch((e) => e);
    expect(error).toBeInstanceOf(PosError);
    expect((error as PosError).permanent).toBe(false);
    expect(state.fake!.tables.order).toHaveLength(0);
  });

  it("le rôle du vendeur transmis par la file ne peut pas ÉLARGIR le plafond", async () => {
    // Un STAFF qui prétend être MANAGER : c'est le plafond le plus bas qui s'applique.
    await expect(sale({ role: "STAFF", claimedRole: "MANAGER", discountPercent: 40, payments: [{ kind: "pos_cash", amount: 6_000 }] })).rejects.toBeInstanceOf(PosError);
    // À l'inverse, un gérant qui synchronise la vente d'un STAFF est jugé au plafond du STAFF.
    await expect(sale({ role: "OWNER", claimedRole: "STAFF", discountPercent: 40, payments: [{ kind: "pos_cash", amount: 6_000 }] })).rejects.toBeInstanceOf(PosError);
  });
});

describe("horodatage et tarification d'une vente hors ligne (bloquant n° 4)", () => {
  it("garde la date réelle de l'encaissement et le prix promotionnel du moment", async () => {
    seed({ promo: true });
    const r = await sale({
      items: [{ productId: "prod_pagne", quantity: 1 }],
      payments: [{ kind: "pos_cash", amount: 8_000 }],
      collectedTotal: 8_000,
      offlineCreatedAt: SOLD_AT,
      deviceLastSyncAt: LAST_SYNC_AT, // postérieure à la vente : ne doit pas réhorodater la vente
      receivedAt: SYNCED_AT,
    });
    expect(r.total).toBe(8_000);
    // La vente n'est pas réhorodatée à l'instant de la synchronisation…
    expect(lastOrder().offlineCreatedAt).toEqual(SOLD_AT);
    // … et elle reste tarifée au prix du moment (promo encore valable à 10 h, finie à 18 h).
    expect(items()[0].unitPrice).toBe(8_000);
    expect(r.priceGap).toBe(0);
  });

  it("une date antérieure à l'ouverture de la session est bornée (horloge faussée)", async () => {
    const r = await sale({
      offlineCreatedAt: new Date("2026-10-09T06:00:00.000Z"),
      collectedTotal: 10_000,
      deviceLastSyncAt: LAST_SYNC_AT,
      receivedAt: SYNCED_AT,
    });
    expect(r.orderId).toBeTruthy();
    expect(lastOrder().offlineCreatedAt).toEqual(OPENED_AT);
  });
});

describe("remise manuelle et TVA (majeur n° 6)", () => {
  it("recalcule la TVA sur le net remisé", async () => {
    seed({ taxes: true });
    // 10 000 TTC remisés de 10 % → 9 000 encaissés ; TVA 18 % contenue = 9 000 × 18/118 ≈ 1 373.
    const r = await sale({ discountPercent: 10, payments: [{ kind: "pos_cash", amount: 9_000 }] });
    expect(r.total).toBe(9_000);
    const order = lastOrder();
    expect(order.taxTotal).toBe(1_373);
    expect(order.discount).toBe(1_000);
    // La taxe de la ligne suit son net après remise (cohérence facture / reçu).
    expect(items()[0].taxAmount).toBe(1_373);
    expect(items()[0].discountAllocated).toBe(1_000);
  });

  it("sans remise manuelle, la TVA reste celle du pipeline", async () => {
    seed({ taxes: true });
    const r = await sale();
    expect(r.total).toBe(10_000);
    expect(lastOrder().taxTotal).toBe(1_525);
  });
});
