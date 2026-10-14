import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Balayage « Stock bas » des automatisations : les places (40 par automatisation et par passage) ne sont jamais
 * brûlées par des doublons ni par de vieilles ruptures sans mouvement ; les clés déjà traitées sont lues sans limite
 * de durée, ciblées sur les candidats.
 */

type Item = { productId: string; variantId: string | null; threshold: number; stock: number };

const state = vi.hoisted(() => ({
  low: [] as Item[],
  moved: [] as { productId: string; variantId: string | null }[],
  processed: [] as { key: string; status: string; createdAt: Date }[],
  queries: [] as unknown[][],
  duplicates: new Set<string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    automation: { findMany: async () => [{ id: "auto_1", storeId: "store_1", trigger: "product.low_stock", channel: "inapp", delayMinutes: 0, active: true, createdAt: new Date(), template: "" }] },
    inventoryMovement: { groupBy: async () => state.moved },
    product: { findMany: async () => [] },
    customer: { findMany: async () => [] },
    $queryRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      state.queries.push(values);
      const keys = values.find((v) => Array.isArray(v)) as string[];
      return state.processed.filter((p) => keys.includes(p.key));
    },
  },
}));
vi.mock("@/lib/notifications/prefs", () => ({ getStorePrefs: async () => ({ lowStockThreshold: 5, lowStockThresholdChangedAt: null }) }));
vi.mock("@/lib/inventory/service", () => ({
  lowStockItems: async (_s: string, o: { productIds?: string[] }) => state.low.filter((i) => !o.productIds || o.productIds.includes(i.productId)),
}));
vi.mock("@/lib/inventory/alerts", () => ({ currentLowStockCrossing: async (_s: string, productId: string) => `x_${productId}` }));
const execute = vi.fn();
vi.mock("@/lib/automations/engine", () => ({
  LOG_CHANNEL: "automation",
  logTemplate: (id: string) => `automation:${id}`,
  loadAutomation: (row: { id: string; storeId: string; trigger: string }) => ({ id: row.id, storeId: row.storeId, trigger: row.trigger, delayMinutes: 0, active: true, createdAt: new Date(), config: { params: {}, conditions: {}, actions: [], cap: null } }),
  planBlockReason: async () => null,
  executeAutomation: (...args: unknown[]) => execute(...args),
}));

import { runTimeTriggers } from "@/lib/automations/sweep";

const item = (i: number): Item => ({ productId: `prod_${String(i).padStart(3, "0")}`, variantId: null, threshold: 5, stock: 0 });
const key = (productId: string) => `stock:${productId}:-:x:x_${productId}`;

beforeEach(() => {
  state.low = [];
  state.moved = [];
  state.processed = [];
  state.queries = [];
  state.duplicates = new Set();
  execute.mockReset();
  execute.mockImplementation(async (_a: unknown, e: { productId: string }) => ({ status: state.duplicates.has(e.productId) ? "duplicate" : "sent" }));
});

describe("balayage « Stock bas » : places et candidats", () => {
  it("50 vieilles ruptures sans mouvement récent n'occupent aucune place : le nouveau franchissement est traité", async () => {
    state.low = Array.from({ length: 50 }, (_, i) => item(i));
    const fresh = item(99);
    state.low.push(fresh);
    state.moved = [{ productId: fresh.productId, variantId: null }]; // seul article ayant bougé
    const stats = await runTimeTriggers();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toMatchObject({ productId: fresh.productId, crossingId: `x_${fresh.productId}` });
    expect(stats.executed).toBe(1);
  });

  it("45 doublons (déjà traités entre-temps) ne brûlent pas les 40 places", async () => {
    state.low = Array.from({ length: 46 }, (_, i) => item(i));
    state.moved = state.low.map((i) => ({ productId: i.productId, variantId: null }));
    state.low.slice(0, 45).forEach((i) => state.duplicates.add(i.productId));
    const stats = await runTimeTriggers();
    expect(execute).toHaveBeenCalledTimes(46);
    expect(stats.executed).toBe(1); // le 46e est bien exécuté
  });

  it("clés déjà traitées lues sans limite de durée et ciblées sur les candidats (exécution vieille de 60 jours ignorée)", async () => {
    state.low = [item(1), item(2)];
    state.moved = state.low.map((i) => ({ productId: i.productId, variantId: null }));
    state.processed = [{ key: key("prod_001"), status: "SENT", createdAt: new Date(Date.now() - 60 * 86_400_000) }];
    await runTimeTriggers();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toMatchObject({ productId: "prod_002" });
    expect(state.queries[0].find((v) => Array.isArray(v))).toEqual([key("prod_001"), key("prod_002")]);
  });

  it("échec récent (< 24 h) : pas de nouvel essai ; échec ancien : retenté", async () => {
    state.low = [item(1), item(2)];
    state.moved = state.low.map((i) => ({ productId: i.productId, variantId: null }));
    state.processed = [
      { key: key("prod_001"), status: "FAILED", createdAt: new Date(Date.now() - 3_600_000) },
      { key: key("prod_002"), status: "FAILED", createdAt: new Date(Date.now() - 3 * 86_400_000) },
    ];
    await runTimeTriggers();
    expect(execute.mock.calls.map((c) => (c[1] as { productId: string }).productId)).toEqual(["prod_002"]);
  });
});
