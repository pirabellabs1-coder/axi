import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * createOrder : politique de rupture DENY vs CONTINUE (stock négatif autorisé seulement en CONTINUE),
 * mouvements d'inventaire, idempotence, et restock exact à l'annulation.
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

import { createOrder, transitionOrder } from "@/lib/commerce/orders";

type Policy = "DENY" | "CONTINUE";

function seed(opts: { productPolicy?: Policy; productStock?: number; variantPolicy?: Policy; variantStock?: number } = {}) {
  state.fake = createFakeDb({
    store: [{ id: "store_1", slug: "boutique", status: "PUBLISHED", country: "BJ", currency: "XOF", pickupEnabled: true, deliveryEnabled: true, whatsappOrdering: true, minOrderAmount: 0 }],
    product: [
      { id: "prod_simple", storeId: "store_1", name: "Sac", status: "ACTIVE", price: 10000, promoPrice: null, promoStart: null, promoEnd: null, trackStock: true, stock: opts.productStock ?? 1, inventoryPolicy: opts.productPolicy ?? "DENY", minQty: 1, maxQty: null },
      { id: "prod_var", storeId: "store_1", name: "Robe", status: "ACTIVE", price: 15000, promoPrice: null, promoStart: null, promoEnd: null, trackStock: true, stock: 0, inventoryPolicy: "DENY", minQty: 1, maxQty: null },
    ],
    variant: [{ id: "var_m", productId: "prod_var", name: "M", available: true, price: null, stock: opts.variantStock ?? 0, inventoryPolicy: opts.variantPolicy ?? "DENY" }],
    optionGroup: [],
    order: [],
    customer: [],
  });
}

let n = 0;
const order = (items: { productId: string; variantId?: string; quantity: number }[], key = `key-${++n}-abcdef`) =>
  createOrder({ storeSlug: "boutique", idempotencyKey: key, items, fulfillmentType: "PICKUP", customer: { name: "Awa Test", phone: "97000000" } });

const product = (id: string) => state.fake!.tables.product.find((p) => p.id === id)!;
const variant = (id: string) => state.fake!.tables.variant.find((v) => v.id === id)!;
const moves = () => state.fake!.tables.inventoryMovement ?? [];
/** La base factice n'applique pas les défauts Prisma : statut initial d'une commande créée. */
const cancel = async (orderId: string) => {
  Object.assign(state.fake!.tables.order.find((o) => o.id === orderId)!, { status: "NEW", paymentStatus: "UNPAID" });
  await transitionOrder({ orderId, storeId: "store_1", to: "CANCELLED", actorId: "u1", actorLabel: "Test" });
};

beforeEach(() => seed());

describe("createOrder : DENY vs CONTINUE", () => {
  it("DENY (défaut) : commande refusée au-delà du stock, stock inchangé", async () => {
    const r = await order([{ productId: "prod_simple", quantity: 2 }]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/Il ne reste que 1|Stock insuffisant/);
    expect(product("prod_simple").stock).toBe(1);
    expect(moves()).toHaveLength(0);
  });

  it("DENY : dans la limite du stock, décrément et mouvement SALE", async () => {
    const r = await order([{ productId: "prod_simple", quantity: 1 }]);
    expect(r.ok).toBe(true);
    expect(product("prod_simple").stock).toBe(0);
    expect(moves()).toMatchObject([{ productId: "prod_simple", variantId: null, delta: -1, reason: "SALE" }]);
  });

  it("CONTINUE : la commande passe au-delà du stock, le stock devient négatif (mouvement enregistré)", async () => {
    seed({ productPolicy: "CONTINUE", productStock: 1 });
    const r = await order([{ productId: "prod_simple", quantity: 3 }]);
    expect(r.ok).toBe(true);
    expect(product("prod_simple").stock).toBe(-2);
    expect(moves()).toMatchObject([{ productId: "prod_simple", delta: -3, reason: "SALE" }]);
    // Note de précommande dans l'historique de la commande
    const events = state.fake!.tables.order[0].events.create as { type: string; message: string }[];
    expect(events.some((e) => e.type === "note" && /Précommande/.test(e.message))).toBe(true);
  });

  it("variantes : la politique de la VARIANTE s'applique (pas celle du produit)", async () => {
    seed({ variantPolicy: "CONTINUE", variantStock: 0 });
    const ok = await order([{ productId: "prod_var", variantId: "var_m", quantity: 2 }]);
    expect(ok.ok).toBe(true);
    expect(variant("var_m").stock).toBe(-2);

    seed({ variantPolicy: "DENY", variantStock: 0 });
    const ko = await order([{ productId: "prod_var", variantId: "var_m", quantity: 1 }]);
    expect(ko.ok).toBe(false);
    expect(variant("var_m").stock).toBe(0);
  });

  it("le décrément est conditionnel dans l'UPDATE : un passage concurrent en DENY est respecté", async () => {
    seed({ productPolicy: "CONTINUE", productStock: 0 });
    // La lecture voit CONTINUE, mais la ligne passe en DENY avant l'UPDATE (autre requête).
    const db = state.fake!.db;
    const original = db.product.updateMany;
    db.product.updateMany = async (args: { where: unknown }) => {
      product("prod_simple").inventoryPolicy = "DENY";
      return original(args);
    };
    const r = await order([{ productId: "prod_simple", quantity: 1 }]);
    db.product.updateMany = original;
    expect(r.ok).toBe(false);
    expect(product("prod_simple").stock).toBe(0);
  });

  it("idempotence : la même clé renvoie la même commande sans second décrément", async () => {
    seed({ productPolicy: "CONTINUE", productStock: 0 });
    const a = await order([{ productId: "prod_simple", quantity: 1 }], "same-key-123456");
    const b = await order([{ productId: "prod_simple", quantity: 1 }], "same-key-123456");
    expect(a.ok && b.ok).toBe(true);
    expect(b.ok && b.duplicate).toBe(true);
    expect(product("prod_simple").stock).toBe(-1);
    expect(moves()).toHaveLength(1);
  });
});

describe("annulation : restock exact (survente comprise)", () => {
  it("rend la quantité vendue, même si le stock était devenu négatif", async () => {
    seed({ productPolicy: "CONTINUE", productStock: 1 });
    const r = await order([{ productId: "prod_simple", quantity: 3 }]);
    if (!r.ok) throw new Error(r.error);
    expect(product("prod_simple").stock).toBe(-2);
    await cancel(r.orderId);
    expect(product("prod_simple").stock).toBe(1);
    expect(moves().map((m) => [m.reason, m.delta])).toEqual([
      ["SALE", -3],
      ["CANCEL", 3],
    ]);
  });

  it("produit dont le suivi a été activé APRÈS la vente : aucun restock (aucun mouvement SALE)", async () => {
    seed({ productStock: 5 });
    product("prod_simple").trackStock = false;
    const r = await order([{ productId: "prod_simple", quantity: 2 }]);
    if (!r.ok) throw new Error(r.error);
    product("prod_simple").trackStock = true;
    await cancel(r.orderId);
    expect(product("prod_simple").stock).toBe(5);
    expect(moves()).toHaveLength(0);
  });
});
