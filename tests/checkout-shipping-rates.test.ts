import { describe, it, expect, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Tarifs d'expédition appliqués au CHECKOUT (lot 3 §1.2, bloquant n° 2 de la revue de la vague 3).
 *
 *  - le tarif applicable le moins cher remplace le forfait de zone, et il est PERSISTÉ sur la commande
 *    (`shippingRateId`, `shippingRateName`) ;
 *  - les bornes de poids et de sous-total net sont respectées ;
 *  - une zone SANS tarif actif garde exactement le comportement d'origine (`DeliveryZone.fee`).
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
vi.mock("@/lib/commerce/quotas", () => ({ checkOrdersQuota: vi.fn(async () => ({ allowed: true })), incrementUsage: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));
vi.mock("@/lib/loyalty/service", () => ({ awardLoyaltyForOrder: vi.fn(), revokeLoyaltyForOrder: vi.fn() }));

import { createOrder } from "@/lib/commerce/orders";

const STORE = "store_ship_1";
const ZONE = "zone_cotonou";

type Rate = {
  id: string;
  name: string;
  price: number;
  minWeightGrams?: number | null;
  maxWeightGrams?: number | null;
  minSubtotal?: number | null;
  maxSubtotal?: number | null;
  freeAbove?: number | null;
};

function seed(rates: Rate[], opts: { productWeight?: number | null } = {}) {
  state.fake = createFakeDb({
    store: [
      {
        id: STORE,
        slug: "boutique",
        status: "PUBLISHED",
        country: "BJ",
        currency: "XOF",
        pickupEnabled: true,
        deliveryEnabled: true,
        whatsappOrdering: true,
        minOrderAmount: 0,
        taxesEnabled: false,
        pricesIncludeTax: true,
        taxRegistration: null,
      },
    ],
    deliveryZone: [{ id: ZONE, storeId: STORE, name: "Cotonou", fee: 1_000, freeAbove: null, etaLabel: "Sous 24 h", active: true }],
    shippingRate: rates.map((r, i) => ({
      storeId: STORE,
      zoneId: ZONE,
      active: true,
      position: i,
      carrierAccountId: null,
      etaLabel: null,
      minWeightGrams: null,
      maxWeightGrams: null,
      minSubtotal: null,
      maxSubtotal: null,
      freeAbove: null,
      ...r,
    })),
    product: [
      {
        id: "prod_sac",
        storeId: STORE,
        name: "Sac",
        status: "ACTIVE",
        price: 10_000,
        promoPrice: null,
        promoStart: null,
        promoEnd: null,
        trackStock: false,
        stock: 0,
        inventoryPolicy: "DENY",
        minQty: 1,
        maxQty: null,
        weightGrams: opts.productWeight ?? 2_000,
        variants: [],
        optionGroups: [],
      },
    ],
    order: [],
    customer: [],
  });
}

let n = 0;
const checkout = (quantity = 1) =>
  createOrder({
    storeSlug: "boutique",
    idempotencyKey: `ship-${++n}-abcdef`,
    items: [{ productId: "prod_sac", quantity }],
    fulfillmentType: "DELIVERY",
    deliveryZoneId: ZONE,
    deliveryAddress: "Carré 123, Akpakpa",
    customer: { name: "Awa Test", phone: "97000000" },
  });

const lastOrder = () => state.fake!.tables.order[state.fake!.tables.order.length - 1];

describe("tarifs d'expédition au checkout", () => {
  it("applique le tarif au poids à la place du forfait de zone et le persiste", async () => {
    // Zone à 1 000, tarif « 0-5 kg » à 2 500 : le commerçant encaisse bien 2 500.
    seed([{ id: "rate_0_5", name: "0-5 kg", price: 2_500, minWeightGrams: 0, maxWeightGrams: 5_000 }]);
    const r = await checkout(1);
    expect(r.ok).toBe(true);
    const order = lastOrder();
    expect(order.deliveryFee).toBe(2_500);
    expect(order.total).toBe(12_500);
    expect(order.shippingRateId).toBe("rate_0_5");
    expect(order.shippingRateName).toBe("0-5 kg");
  });

  it("choisit le tarif applicable le moins cher (bornes de poids incluses)", async () => {
    seed(
      [
        { id: "rate_light", name: "0-1 kg", price: 800, maxWeightGrams: 1_000 },
        { id: "rate_heavy", name: "1-10 kg", price: 3_000, minWeightGrams: 1_001, maxWeightGrams: 10_000 },
      ],
      { productWeight: 500 },
    );
    // 2 × 500 g = 1 000 g : seul le tarif léger s'applique (borne max incluse).
    const r = await checkout(2);
    expect(r.ok).toBe(true);
    expect(lastOrder().deliveryFee).toBe(800);
    expect(lastOrder().shippingRateId).toBe("rate_light");
  });

  it("un tarif hors bornes de sous-total est écarté : repli sur le forfait de zone", async () => {
    seed([{ id: "rate_big", name: "Grosses commandes", price: 500, minSubtotal: 50_000 }]);
    const r = await checkout(1); // sous-total net 10 000 < 50 000
    expect(r.ok).toBe(true);
    expect(lastOrder().deliveryFee).toBe(1_000);
    expect(lastOrder().shippingRateId).toBeNull();
    expect(lastOrder().shippingRateName).toBeNull();
  });

  it("`freeAbove` du tarif : livraison offerte au-delà du seuil, tarif conservé sur la commande", async () => {
    seed([{ id: "rate_free", name: "Standard", price: 2_000, freeAbove: 20_000 }]);
    const r = await checkout(2); // 20 000 net
    expect(r.ok).toBe(true);
    expect(lastOrder().deliveryFee).toBe(0);
    expect(lastOrder().shippingRateId).toBe("rate_free");
  });

  it("NON-RÉGRESSION : une zone sans tarif garde son forfait et ne persiste aucun tarif", async () => {
    seed([]);
    const r = await checkout(1);
    expect(r.ok).toBe(true);
    expect(lastOrder().deliveryFee).toBe(1_000);
    expect(lastOrder().shippingRateId).toBeNull();
  });

  it("NON-RÉGRESSION : un tarif INACTIF est ignoré (forfait de zone)", async () => {
    seed([{ id: "rate_off", name: "Ancien tarif", price: 5_000 }]);
    state.fake!.tables.shippingRate[0].active = false;
    const r = await checkout(1);
    expect(r.ok).toBe(true);
    expect(lastOrder().deliveryFee).toBe(1_000);
    expect(lastOrder().shippingRateId).toBeNull();
  });
});
