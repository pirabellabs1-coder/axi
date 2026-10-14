import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * INVARIANT du lot 3 (§1.1) : pour chaque article suivi,
 *   `Product.stock` (ou `Variant.stock`) = Σ `InventoryLevel.available` + quantités en transit.
 *
 * Il est vérifié après chaque écriture : vente, annulation, retour, transfert (expédition, réception,
 * perte, annulation) et comptage. Les écritures passent toutes par `src/lib/inventory/levels.ts`
 * (agrégat ET niveau dans la même transaction).
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_A_0001" as string,
  planId: "BUSINESS" as string,
  caps: new Set<string>(["products.manage"]),
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
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (!state.caps.has(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: { id: "user_1" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

import { applyLevelDeltaTx, invariantDiff, itemKeyOf, recordStockChangeTx } from "@/lib/inventory/levels";
import { creditOrderLevelsTx } from "@/lib/inventory/order-levels";
import { createTransfer, shipTransfer, receiveTransfer, cancelTransfer, submitCount, assignStockToLocation } from "@/lib/inventory/actions";

const A = "store_A_0001";
const L1 = "loc_entrepot_1";
const L2 = "loc_magasin_1";
const P = "prod_sac_0001";
const ORDER = "order_0001";

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

/** Produit à variantes : la variante n'a AUCUN niveau dans le dépôt (cas du majeur n° 5). */
const PV = "prod_robe_0001";
const V1 = "var_robe_m";

function seed(levels: { locationId: string; available: number }[], stock: number) {
  return createFakeDb({
    store: [{ id: A, slug: "a", name: "A", status: "PUBLISHED", currency: "XOF", country: "BJ" }],
    location: [
      { id: L1, storeId: A, name: "Entrepôt", active: true, isDefault: true, position: 0 },
      { id: L2, storeId: A, name: "Magasin", active: true, isDefault: false, position: 1 },
    ],
    product: [
      { id: P, storeId: A, name: "Sac", status: "ACTIVE", trackStock: true, stock, inventoryPolicy: "DENY", variants: [] },
      { id: PV, storeId: A, name: "Robe", status: "ACTIVE", trackStock: true, stock: 0, inventoryPolicy: "DENY" },
    ],
    variant: [{ id: V1, productId: PV, name: "M", available: true, price: null, stock: 4, inventoryPolicy: "DENY" }],
    inventoryLevel: levels.map((l, i) => ({ id: `lvl_${i}`, storeId: A, locationId: l.locationId, productId: P, variantId: null, itemKey: P, available: l.available })),
    order: [{ id: ORDER, storeId: A, reference: "AX-1", status: "NEW" }],
  });
}

/** Contrôle de l'invariant sur les tables factices. */
function invariantOf(): number {
  const fake = state.fake!;
  const product = fake.tables.product[0];
  const levelsSum = (fake.tables.inventoryLevel ?? []).filter((l) => l.itemKey === itemKeyOf(P, null)).reduce((s, l) => s + l.available, 0);
  const inTransit = (fake.tables.stockTransferItem ?? [])
    .filter((i) => {
      const transfer = (fake.tables.stockTransfer ?? []).find((t) => t.id === i.transferId);
      return transfer?.status === "IN_TRANSIT" && i.productId === P;
    })
    .reduce((s, i) => s + (i.quantity - (i.receivedQuantity ?? 0)), 0);
  return invariantDiff({ aggregate: product.stock, levelsSum, inTransit });
}

beforeEach(() => {
  state.member = A;
  state.planId = "BUSINESS";
  state.caps = new Set(["products.manage"]);
  state.fake = seed([{ locationId: L1, available: 10 }], 10);
});

describe("invariantDiff (pur)", () => {
  it("vaut 0 quand l'agrégat égale la somme des niveaux plus le transit", () => {
    expect(invariantDiff({ aggregate: 10, levelsSum: 7, inTransit: 3 })).toBe(0);
    expect(invariantDiff({ aggregate: 10, levelsSum: 10 })).toBe(0);
  });

  it("signale un écart dans les deux sens", () => {
    expect(invariantDiff({ aggregate: 10, levelsSum: 8 })).toBe(2);
    expect(invariantDiff({ aggregate: 10, levelsSum: 12 })).toBe(-2);
  });
});

describe("écritures de stock (agrégat + niveau dans la même transaction)", () => {
  it("vente puis annulation : invariant tenu à chaque étape", async () => {
    const db = state.fake!.db;
    // Vente : le checkout décrémente l'agrégat, le niveau suit dans la même transaction.
    await db.$transaction(async (tx: typeof db) => {
      await tx.product.updateMany({ where: { id: P, storeId: A }, data: { stock: { decrement: 3 } } });
      await applyLevelDeltaTx(tx, { storeId: A, locationId: L1, productId: P, delta: -3 });
      await tx.inventoryMovement.create({ data: { storeId: A, productId: P, variantId: null, locationId: L1, delta: -3, reason: "SALE", orderId: ORDER } });
    });
    expect(state.fake!.tables.product[0].stock).toBe(7);
    expect(invariantOf()).toBe(0);

    // Annulation : l'agrégat remonte et la restitution est attribuée au dépôt qui avait servi.
    await db.$transaction(async (tx: typeof db) => {
      await tx.product.updateMany({ where: { id: P, storeId: A }, data: { stock: { increment: 3 } } });
      const move = await tx.inventoryMovement.create({ data: { storeId: A, productId: P, variantId: null, delta: 3, reason: "CANCEL", orderId: ORDER }, select: { id: true } });
      await creditOrderLevelsTx(tx, { storeId: A, orderId: ORDER, productId: P, variantId: null, quantity: 3, movementId: move.id });
    });
    expect(state.fake!.tables.product[0].stock).toBe(10);
    expect(invariantOf()).toBe(0);
    const credited = state.fake!.tables.inventoryMovement.find((m) => m.reason === "CANCEL")!;
    expect(credited.locationId).toBe(L1);
  });

  it("retour : la remise en stock revient au dépôt d'origine", async () => {
    const db = state.fake!.db;
    await db.$transaction(async (tx: typeof db) => {
      await tx.product.updateMany({ where: { id: P, storeId: A }, data: { stock: { decrement: 2 } } });
      await applyLevelDeltaTx(tx, { storeId: A, locationId: L2, productId: P, delta: -2 });
      await tx.inventoryMovement.create({ data: { storeId: A, productId: P, variantId: null, locationId: L2, delta: -2, reason: "SALE", orderId: ORDER } });
    });
    await db.$transaction(async (tx: typeof db) => {
      await tx.product.updateMany({ where: { id: P, storeId: A }, data: { stock: { increment: 1 } } });
      const move = await tx.inventoryMovement.create({ data: { storeId: A, productId: P, variantId: null, delta: 1, reason: "RETURN", orderId: ORDER }, select: { id: true } });
      await creditOrderLevelsTx(tx, { storeId: A, orderId: ORDER, productId: P, variantId: null, quantity: 1, movementId: move.id });
    });
    expect(invariantOf()).toBe(0);
    const level2 = state.fake!.tables.inventoryLevel.find((l) => l.locationId === L2)!;
    expect(level2.available).toBe(-1);
  });

  it("recordStockChangeTx écrit l'agrégat, le niveau et le mouvement", async () => {
    const db = state.fake!.db;
    await db.$transaction(async (tx: typeof db) => {
      await recordStockChangeTx(tx, { storeId: A, locationId: L1, productId: P, delta: 4, reason: "ADJUSTMENT", note: "Réassort" });
    });
    expect(state.fake!.tables.product[0].stock).toBe(14);
    expect(state.fake!.tables.inventoryLevel[0].available).toBe(14);
    expect(invariantOf()).toBe(0);
  });

  it("une perte en transit (locationId null) baisse l'agrégat sans toucher aux niveaux", async () => {
    const db = state.fake!.db;
    await db.$transaction(async (tx: typeof db) => {
      await recordStockChangeTx(tx, { storeId: A, locationId: null, productId: P, delta: -2, reason: "ADJUSTMENT", note: "Perte" });
    });
    expect(state.fake!.tables.product[0].stock).toBe(8);
    expect(state.fake!.tables.inventoryLevel[0].available).toBe(10);
    // Écart volontaire : la perte est constatée hors dépôt, l'inventaire du dépôt la régularisera.
    expect(invariantOf()).toBe(-2);
  });
});

describe("transferts entre dépôts", () => {
  async function createDraft(qty = 4) {
    const r = await createTransfer(undefined, fd({ storeId: A, fromLocationId: L1, toLocationId: L2, [`item-${P}`]: String(qty) }));
    expect(r.ok).toBe(true);
    return state.fake!.tables.stockTransfer[0].id as string;
  }

  it("cycle complet : brouillon → transit → réception, invariant tenu partout", async () => {
    const id = await createDraft(4);
    expect(invariantOf()).toBe(0);

    const shipped = await shipTransfer(A, id);
    expect(shipped.ok).toBe(true);
    // En transit : le stock a quitté la source, l'agrégat est inchangé.
    expect(state.fake!.tables.product[0].stock).toBe(10);
    expect(state.fake!.tables.inventoryLevel.find((l) => l.locationId === L1)!.available).toBe(6);
    expect(invariantOf()).toBe(0);

    const received = await receiveTransfer(undefined, fd({ storeId: A, id }));
    expect(received.ok).toBe(true);
    expect(state.fake!.tables.inventoryLevel.find((l) => l.locationId === L2)!.available).toBe(4);
    expect(state.fake!.tables.product[0].stock).toBe(10);
    expect(invariantOf()).toBe(0);
  });

  it("réception partielle : l'écart est déclaré en perte (motif obligatoire)", async () => {
    const id = await createDraft(4);
    await shipTransfer(A, id);
    const itemId = state.fake!.tables.stockTransferItem[0].id as string;

    const refused = await receiveTransfer(undefined, fd({ storeId: A, id, [`received-${itemId}`]: "3" }));
    expect(refused.ok).toBe(false);

    const ok = await receiveTransfer(undefined, fd({ storeId: A, id, [`received-${itemId}`]: "3", lossReason: "Colis ouvert" }));
    expect(ok.ok).toBe(true);
    expect(state.fake!.tables.inventoryLevel.find((l) => l.locationId === L2)!.available).toBe(3);
    // L'unité manquante sort du stock agrégé : 10 − 1 = 9 = 6 (source) + 3 (destination).
    expect(state.fake!.tables.product[0].stock).toBe(9);
    expect(invariantOf()).toBe(0);
  });

  it("annulation en transit : le stock est restitué au dépôt source", async () => {
    const id = await createDraft(4);
    await shipTransfer(A, id);
    const cancelled = await cancelTransfer(A, id);
    expect(cancelled.ok).toBe(true);
    expect(state.fake!.tables.inventoryLevel.find((l) => l.locationId === L1)!.available).toBe(10);
    expect(invariantOf()).toBe(0);
  });

  it("refuse d'expédier plus que le stock du dépôt source", async () => {
    const id = await createDraft(99);
    const shipped = await shipTransfer(A, id);
    expect(shipped.ok).toBe(false);
  });

  it("refuse un transfert sans la fonction du plan", async () => {
    state.planId = "STARTER";
    const r = await createTransfer(undefined, fd({ storeId: A, fromLocationId: L1, toLocationId: L2, [`item-${P}`]: "2" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Business/);
  });
});

describe("inventaire tournant et répartition", () => {
  it("un comptage écrit l'écart sur l'agrégat ET le niveau", async () => {
    const r = await submitCount(undefined, fd({ storeId: A, locationId: L1, [`count-${P}`]: "8" }));
    expect(r.ok).toBe(true);
    expect(state.fake!.tables.inventoryLevel[0].available).toBe(8);
    expect(state.fake!.tables.product[0].stock).toBe(8);
    expect(state.fake!.tables.inventoryMovement.some((m) => m.reason === "COUNT" && m.delta === -2)).toBe(true);
    expect(invariantOf()).toBe(0);
  });

  it("un comptage sans écart n'écrit aucun mouvement", async () => {
    const r = await submitCount(undefined, fd({ storeId: A, locationId: L1, [`count-${P}`]: "10" }));
    expect(r.ok).toBe(true);
    expect(state.fake!.tables.inventoryMovement ?? []).toHaveLength(0);
  });

  it("compter une VARIANTE sans niveau dans ce dépôt n'échoue plus (majeur n° 5)", async () => {
    // Avant : `productId` était déduit de l'itemKey (= variantId) et tout le comptage était refusé.
    const r = await submitCount(undefined, fd({ storeId: A, locationId: L1, [`count-${V1}`]: "3", [`count-${P}`]: "10" }));
    expect(r.ok).toBe(true);
    const level = state.fake!.tables.inventoryLevel.find((l) => l.itemKey === V1)!;
    expect(level).toMatchObject({ locationId: L1, productId: PV, variantId: V1, available: 3 });
    // L'écart (niveau 0 → 3, l'article n'était pas encore réparti ici) est porté par la VARIANTE,
    // jamais par le produit : 4 + 3 = 7 côté agrégat, comme pour tout article compté sans niveau.
    expect(state.fake!.tables.variant.find((v) => v.id === V1)!.stock).toBe(7);
    expect(state.fake!.tables.product.find((p) => p.id === PV)!.stock).toBe(0);
    expect(state.fake!.tables.inventoryMovement.some((m) => m.reason === "COUNT" && m.variantId === V1 && m.delta === 3)).toBe(true);
    // Et la ligne du produit simple, comptée dans le même formulaire, reste traitée.
    expect(invariantOf()).toBe(0);
  });

  it("refuse un article compté qui n'appartient pas à la boutique", async () => {
    const r = await submitCount(undefined, fd({ storeId: A, locationId: L1, "count-prod_autre_boutique": "3" }));
    expect(r.ok).toBe(false);
  });

  it("la répartition entre dépôts ne change jamais le stock total", async () => {
    const r = await assignStockToLocation(undefined, fd({ storeId: A, locationId: L2, productId: P, quantity: "4" }));
    expect(r.ok).toBe(true);
    expect(state.fake!.tables.product[0].stock).toBe(10);
    expect(state.fake!.tables.inventoryLevel.find((l) => l.locationId === L1)!.available).toBe(6);
    expect(state.fake!.tables.inventoryLevel.find((l) => l.locationId === L2)!.available).toBe(4);
    expect(invariantOf()).toBe(0);
  });

  it("refuse une variante qui n'appartient pas au produit (mineur n° 10)", async () => {
    const r = await assignStockToLocation(undefined, fd({ storeId: A, locationId: L2, productId: P, variantId: V1, quantity: "2" }));
    expect(r.ok).toBe(false);
    // Aucun niveau n'a été écrit sur la variante d'une autre fiche.
    expect(state.fake!.tables.inventoryLevel.some((l) => l.itemKey === V1)).toBe(false);
  });
});

describe("invariant de bout en bout : vente → annulation partielle → transfert → comptage", () => {
  it("`invariantDiff === 0` après CHAQUE étape", async () => {
    const db = state.fake!.db;
    const level = (id: string) => state.fake!.tables.inventoryLevel.find((l) => l.locationId === id)?.available ?? 0;

    // 1. Vente de 6 unités servies par l'entrepôt (l'agrégat est décrémenté par le checkout).
    await db.$transaction(async (tx: typeof db) => {
      await tx.product.updateMany({ where: { id: P, storeId: A }, data: { stock: { decrement: 6 } } });
      await applyLevelDeltaTx(tx, { storeId: A, locationId: L1, productId: P, delta: -6 });
      await tx.inventoryMovement.create({ data: { storeId: A, productId: P, variantId: null, locationId: L1, delta: -6, reason: "SALE", orderId: ORDER } });
    });
    expect(state.fake!.tables.product[0].stock).toBe(4);
    expect(level(L1)).toBe(4);
    expect(invariantOf()).toBe(0);

    // 2. Annulation PARTIELLE (2 unités sur 6) : rendues au dépôt qui a servi.
    await db.$transaction(async (tx: typeof db) => {
      await tx.product.updateMany({ where: { id: P, storeId: A }, data: { stock: { increment: 2 } } });
      const move = await tx.inventoryMovement.create({ data: { storeId: A, productId: P, variantId: null, delta: 2, reason: "CANCEL", orderId: ORDER }, select: { id: true } });
      await creditOrderLevelsTx(tx, { storeId: A, orderId: ORDER, productId: P, variantId: null, quantity: 2, movementId: move.id });
    });
    expect(state.fake!.tables.product[0].stock).toBe(6);
    expect(level(L1)).toBe(6);
    expect(invariantOf()).toBe(0);

    // 3. Transfert de 3 unités vers le magasin : en transit, l'agrégat ne bouge pas.
    const created = await createTransfer(undefined, fd({ storeId: A, fromLocationId: L1, toLocationId: L2, [`item-${P}`]: "3" }));
    expect(created.ok).toBe(true);
    const transferId = state.fake!.tables.stockTransfer[0].id as string;
    expect((await shipTransfer(A, transferId)).ok).toBe(true);
    expect(state.fake!.tables.product[0].stock).toBe(6);
    expect(level(L1)).toBe(3);
    expect(invariantOf()).toBe(0); // 6 = 3 (source) + 0 (destination) + 3 (en transit)

    expect((await receiveTransfer(undefined, fd({ storeId: A, id: transferId }))).ok).toBe(true);
    expect(level(L2)).toBe(3);
    expect(invariantOf()).toBe(0);

    // 4. Inventaire tournant du magasin : il n'en reste que 2 (une unité perdue).
    const counted = await submitCount(undefined, fd({ storeId: A, locationId: L2, [`count-${P}`]: "2" }));
    expect(counted.ok).toBe(true);
    expect(level(L2)).toBe(2);
    expect(state.fake!.tables.product[0].stock).toBe(5);
    expect(invariantOf()).toBe(0);
  });
});
