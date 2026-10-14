import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * MAJEUR n° 3 de l'audit de la vague 3 — un refus métier ne doit JAMAIS sortir d'une transaction par
 * `return`.
 *
 * Avant : dans `shipTransfer`, `return { ok: false }` à l'intérieur de `db.$transaction` VALIDE la
 * transaction. Le transfert passait donc `IN_TRANSIT` avec une ligne non décrémentée du dépôt source,
 * et la réception créditait la destination : du stock inventé, et l'invariant
 * « agrégat = Σ niveaux + en transit » rompu.
 *
 * Après : `throw` d'une erreur typée, interceptée HORS transaction → PostgreSQL annule réellement.
 * Le test émule l'annulation (la base factice ne la fait pas) : l'état des tables est photographié à
 * l'entrée de `$transaction` et restauré si le rappel lève.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  db: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: vi.fn(async () => ({
      user: { id: "user_1" },
      store: state.fake!.tables.store[0],
      role: "OWNER",
      planId: "BUSINESS",
      can: () => true,
    })),
  };
});

import { shipTransfer, receiveTransfer } from "@/lib/inventory/actions";
import { receivePlan } from "@/lib/inventory/transfer";

const STORE = "store_tr_1";
const FROM = "loc_from_1";
const TO = "loc_to_1";

/** Clone profond suffisant pour les lignes de la base factice (valeurs scalaires et dates). */
function snapshot(tables: Record<string, Record<string, unknown>[]>) {
  return Object.fromEntries(Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
}

/**
 * Enveloppe la base factice d'un `$transaction` qui ANNULE tout si le rappel lève — comportement réel
 * de PostgreSQL, que la base factice ne reproduit pas.
 */
function withRollback(fake: ReturnType<typeof createFakeDb>) {
  return new Proxy(fake.db, {
    get(target: Record<string, unknown>, prop: string) {
      if (prop !== "$transaction") return target[prop];
      return async (arg: unknown) => {
        if (typeof arg !== "function") return (target.$transaction as (a: unknown) => unknown)(arg);
        const before = snapshot(fake.tables);
        try {
          return await (arg as (tx: unknown) => Promise<unknown>)(state.db);
        } catch (e) {
          for (const key of Object.keys(fake.tables)) delete fake.tables[key];
          for (const [key, rows] of Object.entries(before)) fake.tables[key] = rows;
          throw e;
        }
      };
    },
  });
}

/** Deux lignes : la première couverte par le dépôt source, la seconde NON (le piège du majeur n° 3). */
function seed(opts: { secondAvailable?: number } = {}) {
  state.fake = createFakeDb({
    store: [{ id: STORE, name: "Boutique" }],
    location: [
      { id: FROM, storeId: STORE, name: "Entrepôt", active: true, isDefault: true },
      { id: TO, storeId: STORE, name: "Boutique", active: true, isDefault: false },
    ],
    product: [
      { id: "product_a001", storeId: STORE, name: "A", trackStock: true, stock: 10 },
      { id: "product_b001", storeId: STORE, name: "B", trackStock: true, stock: 10 },
    ],
    inventoryLevel: [
      { id: "level_a0001", storeId: STORE, locationId: FROM, productId: "product_a001", variantId: null, itemKey: "product_a001", available: 10 },
      { id: "level_b0001", storeId: STORE, locationId: FROM, productId: "product_b001", variantId: null, itemKey: "product_b001", available: opts.secondAvailable ?? 1 },
    ],
    stockTransfer: [{ id: "transfer_1001", storeId: STORE, reference: "TR-1", fromLocationId: FROM, toLocationId: TO, status: "DRAFT", createdById: "user_1" }],
    stockTransferItem: [
      { id: "transferitem_a01", transferId: "transfer_1001", productId: "product_a001", variantId: null, quantity: 5, receivedQuantity: 0 },
      { id: "transferitem_b01", transferId: "transfer_1001", productId: "product_b001", variantId: null, quantity: 5, receivedQuantity: 0 },
    ],
    inventoryMovement: [],
  });
  state.db = withRollback(state.fake);
}

const transfer = () => state.fake!.tables.stockTransfer[0];
const level = (itemKey: string) => state.fake!.tables.inventoryLevel.find((l) => l.itemKey === itemKey)!;
const movements = () => state.fake!.tables.inventoryMovement ?? [];

beforeEach(() => seed());

describe("shipTransfer : expédition tout ou rien", () => {
  it("stock insuffisant sur UNE ligne → transaction annulée, rien n'a bougé", async () => {
    const r = await shipTransfer(STORE, "transfer_1001");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Stock insuffisant");

    // Le cœur du correctif : le transfert reste en brouillon, le stock source est intact, aucun
    // mouvement n'a été écrit. Avant le correctif : status IN_TRANSIT et `prod_a` décrémenté de 5.
    expect(transfer().status).toBe("DRAFT");
    expect(transfer().shippedAt).toBeUndefined();
    expect(level("product_a001").available).toBe(10);
    expect(level("product_b001").available).toBe(1);
    expect(movements()).toHaveLength(0);
  });

  it("stock suffisant partout → expédition complète et cohérente", async () => {
    seed({ secondAvailable: 5 });
    const r = await shipTransfer(STORE, "transfer_1001");
    expect(r.ok).toBe(true);
    expect(transfer().status).toBe("IN_TRANSIT");
    expect(level("product_a001").available).toBe(5);
    expect(level("product_b001").available).toBe(0);
    expect(movements()).toHaveLength(2);
  });

  it("transfert qui n'est plus en brouillon → refus sans effet", async () => {
    seed({ secondAvailable: 5 });
    state.fake!.tables.stockTransfer[0].status = "IN_TRANSIT";
    const r = await shipTransfer(STORE, "transfer_1001");
    expect(r.ok).toBe(false);
    expect(level("product_a001").available).toBe(10);
    expect(movements()).toHaveLength(0);
  });
});

describe("receivePlan : receivedQuantity ≤ quantité réellement sortie", () => {
  const items = [{ id: "transferitem_a01", productId: "product_a001", variantId: null, quantity: 5, receivedQuantity: 0 }];

  it("borne une saisie gonflée à la quantité expédiée", () => {
    const plan = receivePlan(items, new Map([["transferitem_a01", 999]]));
    expect(plan.lines[0].credit).toBe(5);
    expect(plan.lines[0].received).toBe(5);
    expect(plan.totalMissing).toBe(0);
  });

  it("refuse une quantité négative et déclare tout en perte", () => {
    const plan = receivePlan(items, new Map([["transferitem_a01", -3]]));
    expect(plan.lines[0].credit).toBe(0);
    expect(plan.totalMissing).toBe(5);
  });

  it("tient compte du déjà reçu : jamais plus que le reste sorti", () => {
    const partial = [{ id: "transferitem_a01", productId: "product_a001", variantId: null, quantity: 5, receivedQuantity: 4 }];
    const plan = receivePlan(partial, new Map([["transferitem_a01", 99]]));
    expect(plan.lines[0].credit).toBe(1); // reste réellement sorti
    expect(plan.lines[0].received).toBe(5); // cumul écrit sur la ligne
    expect(plan.totalMissing).toBe(0);
  });

  it("saisie absente : tout le reste est réputé reçu", () => {
    const plan = receivePlan(items, new Map());
    expect(plan.lines[0].credit).toBe(5);
    expect(plan.totalMissing).toBe(0);
  });
});

describe("receiveTransfer : refus hors transaction", () => {
  it("transfert qui n'est plus en transit → refus, aucun crédit à la destination", async () => {
    seed({ secondAvailable: 5 });
    const fd = new FormData();
    fd.set("storeId", STORE);
    fd.set("id", "transfer_1001");
    // Le transfert est encore DRAFT : la réception doit être refusée avant toute écriture.
    const r = await receiveTransfer(undefined, fd);
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.inventoryLevel.find((l) => l.locationId === TO)).toBeUndefined();
  });
});
