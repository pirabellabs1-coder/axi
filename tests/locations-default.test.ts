import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Dépôts (lot 3 §1.1) — correctifs de la revue de la vague 3 :
 *  - majeur n° 8 : `ensureDefaultLocationTx` crée le « Dépôt principal » ET initialise ses niveaux
 *    depuis les stocks agrégés, de façon idempotente (même logique que `scripts/migrate-locations.ts`) ;
 *  - mineur n° 11 : un dépôt portant +5 et −5 n'est PAS considéré comme vide (archivage refusé).
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));

import { ensureDefaultLocationTx, initializeLevelsFromAggregateTx, locationStock, locationStockUnits, DEFAULT_LOCATION_NAME } from "@/lib/locations/service";

const STORE = "store_loc_1";

function seed(opts: { locations?: boolean; levels?: { itemKey: string; available: number }[] } = {}) {
  state.fake = createFakeDb({
    store: [{ id: STORE, slug: "l", name: "L", status: "PUBLISHED", country: "BJ", city: "Cotonou", currency: "XOF" }],
    location: opts.locations ? [{ id: "loc_exist", storeId: STORE, name: "Entrepôt", active: true, isDefault: true, position: 0 }] : [],
    product: [
      { id: "prod_simple", storeId: STORE, name: "Sac", status: "ACTIVE", trackStock: true, stock: 7, variants: [] },
      { id: "prod_var", storeId: STORE, name: "Robe", status: "ACTIVE", trackStock: true, stock: 0 },
      { id: "prod_libre", storeId: STORE, name: "Service", status: "ACTIVE", trackStock: false, stock: 0, variants: [] },
      { id: "prod_archive", storeId: STORE, name: "Ancien", status: "ARCHIVED", trackStock: true, stock: 3, variants: [] },
    ],
    variant: [
      { id: "var_m", productId: "prod_var", name: "M", stock: 2 },
      { id: "var_l", productId: "prod_var", name: "L", stock: 5 },
    ],
    inventoryLevel: (opts.levels ?? []).map((l, i) => ({
      id: `lvl_${i}`,
      storeId: STORE,
      locationId: "loc_exist",
      productId: "prod_simple",
      variantId: null,
      itemKey: l.itemKey,
      available: l.available,
    })),
  });
}

const tx = () => state.fake!.db;
const levels = () => state.fake!.tables.inventoryLevel ?? [];

beforeEach(() => seed());

describe("ensureDefaultLocationTx (majeur n° 8)", () => {
  it("crée le dépôt principal et y place les stocks agrégés suivis", async () => {
    const id = await ensureDefaultLocationTx(tx(), STORE, { country: "BJ", city: "Cotonou" });
    const location = state.fake!.tables.location.find((l) => l.id === id)!;
    expect(location).toMatchObject({ name: DEFAULT_LOCATION_NAME, storeId: STORE, isDefault: true, city: "Cotonou" });
    // Produit simple suivi + chaque variante suivie ; ni le produit sans suivi, ni l'archivé.
    expect(levels().map((l) => `${l.itemKey}:${l.available}`).sort()).toEqual(["prod_simple:7", "var_l:5", "var_m:2"]);
    expect(levels().every((l) => l.locationId === id)).toBe(true);
  });

  it("ne recrée rien si la boutique a déjà un dépôt", async () => {
    seed({ locations: true });
    const id = await ensureDefaultLocationTx(tx(), STORE);
    expect(id).toBe("loc_exist");
    expect(state.fake!.tables.location).toHaveLength(1);
    expect(levels()).toHaveLength(0);
  });

  it("idempotent : un article déjà réparti n'est jamais recrédité", async () => {
    seed({ locations: true, levels: [{ itemKey: "prod_simple", available: 3 }] });
    const created = await initializeLevelsFromAggregateTx(tx(), STORE, "loc_exist");
    // Seules les variantes, encore sans niveau, sont initialisées.
    expect(created).toBe(2);
    expect(levels().find((l) => l.itemKey === "prod_simple")!.available).toBe(3);
    // Seconde exécution : aucun niveau créé.
    expect(await initializeLevelsFromAggregateTx(tx(), STORE, "loc_exist")).toBe(0);
    expect(levels()).toHaveLength(3);
  });
});

describe("stock d'un dépôt (mineur n° 11)", () => {
  it("un dépôt avec +5 et −5 n'est pas vide : solde nul mais deux lignes non nulles", async () => {
    seed({ locations: true, levels: [{ itemKey: "a", available: 5 }, { itemKey: "b", available: -5 }] });
    const stock = await locationStock(STORE, "loc_exist");
    expect(stock.net).toBe(0);
    expect(stock.lines).toBe(2);
    expect(await locationStockUnits(STORE, "loc_exist")).toBe(0);
  });

  it("un dépôt réellement vide n'a aucune ligne non nulle", async () => {
    seed({ locations: true, levels: [{ itemKey: "a", available: 0 }] });
    expect(await locationStock(STORE, "loc_exist")).toEqual({ net: 0, lines: 0 });
  });
});
