import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  minuteOk: true,
  dayOk: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/commerce/orders", () => ({ transitionOrder: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  normalizeIp: (v: string | null) => v ?? "unknown",
  rateLimit: async (key: string) => (key.endsWith(":day") && !state.dayOk ? { ok: false, retryAfter: 7200 } : { ok: true, retryAfter: 0 }),
  rateLimitAll: async () => (state.minuteOk ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 42 }),
}));

process.env.NEXT_PUBLIC_APP_URL = "https://axi.test";

import { generateApiToken } from "@/lib/mcp/tokens";
import { authenticateMerchant } from "@/lib/mcp/auth";
import { POST } from "@/app/api/mcp/route";

const FUTURE = new Date(Date.now() + 30 * 86_400_000);
const ALL = ["store:read", "catalog:read", "catalog:write", "inventory:write", "orders:read", "orders:write", "customers:read", "analytics:read", "marketing:write"];
let tokenA = "";
let tokenB = "";

function seed() {
  const a = generateApiToken();
  const b = generateApiToken();
  tokenA = a.token;
  tokenB = b.token;
  const store = (id: string, name: string) => ({ id, name, slug: id, status: "PUBLISHED", currency: "XOF", timezone: "Africa/Porto-Novo", country: "BJ", whatsappNumber: null });
  const product = (id: string, storeId: string, name: string) => ({
    id, storeId, name, slug: id, status: "ACTIVE", price: 5000, compareAtPrice: null, promoPrice: null, promoStart: null, promoEnd: null, costPrice: 2000, sku: null,
    trackStock: false, stock: 0, tags: [], minQty: 1, maxQty: null, isFeatured: false, productType: null, vendor: null, images: [], options: null, description: "",
    variants: [], optionGroups: [], createdAt: new Date(), updatedAt: new Date(), categoryId: null,
  });
  state.fake = createFakeDb({
    user: [{ id: "uA" }, { id: "uB" }],
    store: [store("store_a", "Boutique A"), store("store_b", "Boutique B")],
    subscription: [
      { id: "sa", storeId: "store_a", planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
      { id: "sb", storeId: "store_b", planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
    ],
    membership: [
      { id: "ma", userId: "uA", storeId: "store_a", role: "OWNER", expiresAt: null },
      { id: "mb", userId: "uB", storeId: "store_b", role: "OWNER", expiresAt: null },
    ],
    apiToken: [
      { id: "tA", storeId: "store_a", name: "A", prefix: a.prefix, secretHash: a.hash, scopes: ALL, createdById: "uA", revokedAt: null, expiresAt: null, lastUsedAt: null },
      { id: "tB", storeId: "store_b", name: "B", prefix: b.prefix, secretHash: b.hash, scopes: ALL, createdById: "uB", revokedAt: null, expiresAt: null, lastUsedAt: null },
    ],
    product: [product("prod_aaaa", "store_a", "Produit A"), product("prod_bbbb", "store_b", "Produit B")],
    order: [{ id: "order_bbbb", storeId: "store_b", reference: "AX-BBBBBB", status: "NEW", paymentStatus: "UNPAID", total: 1000, createdAt: new Date(), customerName: "Client B", fulfillmentType: "PICKUP", channel: "STORE" }],
    category: [],
  });
  state.minuteOk = true;
  state.dayOk = true;
}

beforeEach(seed);

async function call(token: string, method: string, params?: unknown) {
  const res = await POST(new Request("https://axi.test/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null };
}

describe("authentification : la boutique vient toujours du jeton", () => {
  it("jeton de A → boutique A ; de B → boutique B", async () => {
    const a = await authenticateMerchant(`Bearer ${tokenA}`, "ip");
    const b = await authenticateMerchant(`Bearer ${tokenB}`, "ip");
    expect(a.ok && a.ctx.store.id).toBe("store_a");
    expect(b.ok && b.ctx.store.id).toBe("store_b");
  });

  it("jeton révoqué, expiré, inconnu, boutique archivée ou créateur retiré : 401", async () => {
    const t = state.fake!.tables.apiToken[0];
    t.revokedAt = new Date();
    expect((await authenticateMerchant(`Bearer ${tokenA}`, "ip")).ok).toBe(false);
    t.revokedAt = null;
    t.expiresAt = new Date(Date.now() - 1);
    expect((await authenticateMerchant(`Bearer ${tokenA}`, "ip")).ok).toBe(false);
    t.expiresAt = null;
    expect((await authenticateMerchant(`Bearer ${tokenA.slice(0, -2)}zz`, "ip")).ok).toBe(false);
    state.fake!.tables.membership = state.fake!.tables.membership.filter((m) => m.userId !== "uA");
    expect((await authenticateMerchant(`Bearer ${tokenA}`, "ip")).ok).toBe(false);
    seed();
    state.fake!.tables.store[0].status = "ARCHIVED";
    expect((await authenticateMerchant(`Bearer ${tokenA}`, "ip")).ok).toBe(false);
  });

  it("sans jeton : 401 avec WWW-Authenticate et resource_metadata (RFC 9728)", async () => {
    const res = await POST(new Request("https://axi.test/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://axi.test/.well-known/oauth-protected-resource/api/mcp"');
  });
});

describe("isolation : un jeton de A ne lit ni ne modifie jamais B", () => {
  it("get_product d'un produit de B avec le jeton de A : introuvable", async () => {
    const own = await call(tokenA, "tools/call", { name: "get_product", arguments: { product_id: "prod_aaaa" } });
    expect(own.body.result.isError).toBeUndefined();
    expect(own.body.result.structuredContent.name).toBe("Produit A");
    const other = await call(tokenA, "tools/call", { name: "get_product", arguments: { product_id: "prod_bbbb" } });
    expect(other.body.result).toMatchObject({ isError: true, content: [{ text: "Product not found in this store." }] });
  });

  it("update_product d'un produit de B : refusé, B inchangé", async () => {
    const r = await call(tokenA, "tools/call", { name: "update_product", arguments: { product_id: "prod_bbbb", name: "Piraté" } });
    expect(r.body.result).toMatchObject({ isError: true, content: [{ text: "Product not found in this store." }] });
    expect(state.fake!.tables.product.find((p) => p.id === "prod_bbbb")!.name).toBe("Produit B");
  });

  it("get_order / list_orders : toujours filtrés par la boutique du jeton", async () => {
    const r = await call(tokenA, "tools/call", { name: "get_order", arguments: { order_id: "order_bbbb" } });
    expect(r.body.result).toMatchObject({ isError: true, content: [{ text: "Order not found in this store." }] });
    const list = await call(tokenA, "tools/call", { name: "list_orders", arguments: {} });
    expect(list.body.result.structuredContent.orders).toEqual([]);
    const orderQueries = state.fake!.calls.filter((c) => c.model === "order");
    expect(orderQueries.length).toBeGreaterThan(0);
    for (const q of orderQueries) expect(q.args.where.storeId).toBe("store_a");
  });
});

describe("limitation de débit", () => {
  it("quota par minute dépassé : 429, Retry-After et erreur JSON-RPC", async () => {
    state.minuteOk = false;
    const { res, body } = await call(tokenA, "tools/list");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(body.error.code).toBe(-32029);
  });

  it("quota journalier atteint : l'outil n'est pas exécuté", async () => {
    state.dayOk = false;
    const r = await call(tokenA, "tools/call", { name: "get_product", arguments: { product_id: "prod_aaaa" } });
    expect(r.res.status).toBe(200);
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/Daily tool-call quota/);
  });
});
