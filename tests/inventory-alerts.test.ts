import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/** Alertes « stock bas » et « survente » : une seule notification par franchissement, seuil produit ou boutique. */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));

import { notifyStockCrossings } from "@/lib/inventory/alerts";

const STORE = "store_1";
const item = { storeId: STORE, productId: "prod_1", variantId: null };

function seed(opts: { stock: number; productThreshold?: number | null; storeThreshold?: number; policy?: "DENY" | "CONTINUE"; productChangedAt?: Date | null; storeChangedAt?: string | null }) {
  state.fake = createFakeDb({
    product: [{ id: "prod_1", storeId: STORE, name: "Sac", status: "ACTIVE", trackStock: true, stock: opts.stock, inventoryPolicy: opts.policy ?? "DENY", lowStockThreshold: opts.productThreshold ?? null, lowStockThresholdChangedAt: opts.productChangedAt ?? null, _count: { variants: 0 } }],
    variant: [],
    integration: opts.storeThreshold != null ? [{ id: "i1", storeId: STORE, kind: "axi_prefs", config: { lowStockThreshold: opts.storeThreshold, lowStockThresholdChangedAt: opts.storeChangedAt ?? null } }] : [],
    inventoryMovement: [],
    notification: [],
  });
}

/** Ajoute un mouvement (la base factice ne trie pas : on garde l'ordre « plus récent d'abord »). */
function move(id: string, delta: number, createdAt = new Date()) {
  const p = state.fake!.tables.product[0];
  p.stock += delta;
  state.fake!.tables.inventoryMovement.unshift({ id, storeId: STORE, productId: "prod_1", variantId: null, delta, reason: delta < 0 ? "SALE" : "ADJUSTMENT", createdAt });
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const notes = () => (state.fake!.tables.notification ?? []).map((n) => ({ kind: n.template, title: (n.payload as { title: string }).title }));

beforeEach(() => seed({ stock: 0 }));

describe("alertes de stock : une par franchissement", () => {
  it("passage sous le seuil de la boutique : une alerte, pas de doublon aux balayages suivants", async () => {
    seed({ stock: 0, storeThreshold: 5 });
    move("m_init", 10);
    expect(await notifyStockCrossings([item])).toBe(0); // 10 > 5
    move("m_sale6", -6); // 4 : franchit 5
    expect(await notifyStockCrossings([item])).toBe(1);
    expect(await notifyStockCrossings([item])).toBe(0); // même balayage rejoué
    move("m_sale1", -1); // 3 : toujours sous le seuil, même franchissement
    expect(await notifyStockCrossings([item])).toBe(0);
    expect(notes()).toEqual([{ kind: "notif.stock.low", title: "Stock bas : Sac" }]);
  });

  it("réassort au-dessus du seuil puis nouvelle baisse : nouvelle alerte", async () => {
    seed({ stock: 0, storeThreshold: 5 });
    move("m_init", 10);
    move("m_sale6", -6);
    await notifyStockCrossings([item]);
    move("m_restock", 10); // 14
    expect(await notifyStockCrossings([item])).toBe(0);
    move("m_sale10", -10); // 4
    expect(await notifyStockCrossings([item])).toBe(1);
    expect(notes()).toHaveLength(2);
  });

  it("le seuil du produit prime sur celui de la boutique", async () => {
    seed({ stock: 0, storeThreshold: 10, productThreshold: 2 });
    move("m_init", 8);
    move("m_sale", -4); // 4 : sous 10 (boutique) mais au-dessus de 2 (produit)
    expect(await notifyStockCrossings([item])).toBe(0);
    move("m_sale2", -2); // 2 : franchit le seuil du produit
    expect(await notifyStockCrossings([item])).toBe(1);
  });

  it("survente (CONTINUE) : une seule alerte « Survente » quand le même mouvement franchit le seuil et zéro", async () => {
    seed({ stock: 0, storeThreshold: 5, policy: "CONTINUE" });
    move("m_init", 6);
    move("m_sale", -8); // 6 → -2 : franchit 5 ET 0 dans le même mouvement
    expect(await notifyStockCrossings([item])).toBe(1);
    expect(notes()).toEqual([{ kind: "notif.stock.oversold", title: "Survente : Sac" }]);
    move("m_sale2", -1); // -3 : toujours en survente
    expect(await notifyStockCrossings([item])).toBe(0);
  });

  it("seuil boutique relevé après coup : aucune alerte pour un passage antérieur", async () => {
    // Passage de 10 à 6 il y a 3 jours, seuil boutique porté de 5 à 8 hier.
    seed({ stock: 0, storeThreshold: 8, storeChangedAt: daysAgo(1).toISOString() });
    move("m_init", 10, daysAgo(10));
    move("m_sale", -4, daysAgo(3));
    expect(await notifyStockCrossings([item])).toBe(0);
    // Nouvelle vente après le changement : 6 → 5, déjà sous 8 → pas de passage ; réassort puis baisse → alerte.
    move("m_restock", 10, new Date());
    move("m_sale2", -9, new Date()); // 16 → 7
    expect(await notifyStockCrossings([item])).toBe(1);
  });

  it("seuil produit relevé après coup : idem (horodatage du produit)", async () => {
    seed({ stock: 0, storeThreshold: 5, productThreshold: 8, productChangedAt: daysAgo(1) });
    move("m_init", 10, daysAgo(10));
    move("m_sale", -4, daysAgo(3)); // 6 ≤ 8, mais avant le changement
    expect(await notifyStockCrossings([item])).toBe(0);
  });

  it("survente puis réassort partiel : pas d'alerte « stock bas » pour l'ancien passage", async () => {
    seed({ stock: 0, storeThreshold: 5, policy: "CONTINUE" });
    move("m_init", 10);
    move("m_sale", -12); // -2
    expect(await notifyStockCrossings([item])).toBe(1); // survente
    move("m_restock", 4); // 2 : sous le seuil, mais le passage était un passage en négatif
    expect(await notifyStockCrossings([item])).toBe(0);
    expect(notes().map((n) => n.kind)).toEqual(["notif.stock.oversold"]);
  });

  it("variante désactivée : aucune alerte", async () => {
    seed({ stock: 0, storeThreshold: 5 });
    state.fake!.tables.product[0]._count = { variants: 1 };
    state.fake!.tables.variant.push({ id: "var_1", productId: "prod_1", name: "M", stock: 0, inventoryPolicy: "DENY", available: false });
    state.fake!.tables.inventoryMovement.unshift({ id: "mv_v", storeId: STORE, productId: "prod_1", variantId: "var_1", delta: -6, reason: "SALE", createdAt: new Date() }, { id: "mv_i", storeId: STORE, productId: "prod_1", variantId: "var_1", delta: 6, reason: "ADJUSTMENT", createdAt: daysAgo(2) });
    expect(await notifyStockCrossings([{ storeId: STORE, productId: "prod_1", variantId: "var_1" }])).toBe(0);
    state.fake!.tables.variant[0].available = true;
    expect(await notifyStockCrossings([{ storeId: STORE, productId: "prod_1", variantId: "var_1" }])).toBe(1);
  });

  it("stock bas puis survente : deux franchissements distincts, deux alertes", async () => {
    seed({ stock: 0, storeThreshold: 5, policy: "CONTINUE" });
    move("m_init", 10);
    move("m_sale", -7); // 3
    expect(await notifyStockCrossings([item])).toBe(1);
    move("m_sale2", -4); // -1
    expect(await notifyStockCrossings([item])).toBe(1);
    expect(notes().map((n) => n.kind)).toEqual(["notif.stock.low", "notif.stock.oversold"]);
  });
});
