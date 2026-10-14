import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { createFakeDb } from "./helpers/fake-db";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  minuteOk: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/commerce/orders", () => ({ transitionOrder: vi.fn(async () => {}) }));
vi.mock("@/lib/rate-limit", () => ({
  normalizeIp: (v: string | null) => v ?? "unknown",
  rateLimit: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitAll: async () => (state.minuteOk ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 42 }),
}));

process.env.NEXT_PUBLIC_APP_URL = "https://axi.test";

import { generateApiToken } from "@/lib/mcp/tokens";
import { GET as listProducts, POST as createProductRoute } from "@/app/api/v1/products/route";
import { GET as getProduct } from "@/app/api/v1/products/[id]/route";
import { GET as listOrders } from "@/app/api/v1/orders/route";
import { GET as getOrder } from "@/app/api/v1/orders/[id]/route";
import { POST as transition } from "@/app/api/v1/orders/[id]/transitions/route";
import { GET as listWebhooks, POST as createWebhook } from "@/app/api/v1/webhooks/route";
import { decodeCursor, encodeCursor, parseLimit, toPage } from "@/lib/api/pagination";
import { canonicalJson, requestHash } from "@/lib/api/idempotency";

const FUTURE = new Date(Date.now() + 30 * 86_400_000);
const ALL = ["store:read", "catalog:read", "catalog:write", "inventory:write", "orders:read", "orders:write", "customers:read", "analytics:read", "webhooks:write"];
let tokenA = "";
let tokenB = "";

function product(id: string, storeId: string, name: string) {
  return {
    id, storeId, name, slug: id, description: "", status: "ACTIVE", price: 5000, compareAtPrice: null, promoPrice: null, promoStart: null, promoEnd: null, sku: null, barcode: null,
    trackStock: false, stock: 0, inventoryPolicy: "DENY", lowStockThreshold: null, tags: [], images: [], vendor: null, productType: null, isFeatured: false, variants: [],
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function order(id: string, storeId: string) {
  return {
    id, storeId, reference: `AX-${id.slice(-6).toUpperCase()}`, status: "NEW", paymentStatus: "UNPAID", fulfillmentType: "PICKUP", channel: "STORE", currency: "XOF",
    subtotal: 1000, discount: 0, automaticDiscount: 0, loyaltyDiscount: 0, giftCardAmount: 0, storeCreditAmount: 0, deliveryFee: 0, taxTotal: 0, taxesIncluded: true, total: 1000, amountDue: 1000,
    couponCode: null, deliveryZoneName: null, scheduledFor: null, courierName: null, paymentMethodLabel: null, paymentReference: "REF-1",
    customerId: "cust_1", customerName: "Aïcha", customerPhone: "22997000000", customerEmail: "a@x.bj", deliveryAddress: "Cotonou", customerNote: null,
    createdAt: new Date(), updatedAt: new Date(), confirmedAt: null, deliveredAt: null, cancelledAt: null,
  };
}

function seed(opts: { plan?: string; role?: string; scopes?: string[] } = {}) {
  const a = generateApiToken();
  const b = generateApiToken();
  tokenA = a.token;
  tokenB = b.token;
  const store = (id: string) => ({ id, name: id, slug: id, status: "PUBLISHED", currency: "XOF", timezone: "Africa/Porto-Novo", country: "BJ", whatsappNumber: null });
  state.fake = createFakeDb({
    user: [{ id: "uA" }, { id: "uB" }],
    store: [store("store_a"), store("store_b")],
    subscription: [
      { id: "sa", storeId: "store_a", planId: opts.plan ?? "SCALE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
      { id: "sb", storeId: "store_b", planId: "SCALE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
    ],
    membership: [
      { id: "ma", userId: "uA", storeId: "store_a", role: opts.role ?? "OWNER", expiresAt: null },
      { id: "mb", userId: "uB", storeId: "store_b", role: "OWNER", expiresAt: null },
    ],
    apiToken: [
      { id: "tA", storeId: "store_a", name: "A", prefix: a.prefix, secretHash: a.hash, scopes: opts.scopes ?? ALL, createdById: "uA", revokedAt: null, expiresAt: null, lastUsedAt: null },
      { id: "tB", storeId: "store_b", name: "B", prefix: b.prefix, secretHash: b.hash, scopes: ALL, createdById: "uB", revokedAt: null, expiresAt: null, lastUsedAt: null },
    ],
    product: [product("prod_aaaa", "store_a", "Produit A"), product("prod_bbbb", "store_b", "Produit B")],
    order: [order("order_aaaa", "store_a"), order("order_bbbb", "store_b")],
    orderItem: [],
    category: [],
    apiIdempotencyKey: [],
    webhookEndpoint: [{ id: "ep_bbbbbbbb", storeId: "store_b", url: "https://b.exemple.com/h", secretPrefix: "whsec_bbbb", events: ["order.created"], apiVersion: "2026-10", includePersonalData: false, active: true, consecutiveFailures: 0, createdAt: new Date() }],
    job: [],
  });
  // Contrainte unique (storeId, key) d'ApiIdempotencyKey, que la base factice n'applique pas.
  const model = state.fake.db.apiIdempotencyKey;
  const create = model.create;
  model.create = async (args: { data: { storeId: string; key: string } }) => {
    if (state.fake!.tables.apiIdempotencyKey.some((r) => r.storeId === args.data.storeId && r.key === args.data.key)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    }
    return create(args);
  };
  state.minuteOk = true;
}

beforeEach(() => seed());

const req = (path: string, token: string | null, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`https://axi.test${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const json = async (res: Response) => JSON.parse(await res.text());

describe("authentification et erreurs problem+json", () => {
  it("sans jeton : 401 problem+json, WWW-Authenticate, sans CORS", async () => {
    const res = await listProducts(req("/api/v1/products", null));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/application\/problem\+json/);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const body = await json(res);
    expect(body).toMatchObject({ status: 401, code: "unauthorized", type: expect.stringContaining("/unauthorized") });
    expect(body.request_id).toMatch(/^req_/);
  });

  it("jeton OAuth (audience MCP) refusé ; version d'API inconnue : 400", async () => {
    expect((await listProducts(req("/api/v1/products", "axi_oat_" + "x".repeat(40)))).status).toBe(401);
    const res = await listProducts(req("/api/v1/products", tokenA, { headers: { "Axi-Api-Version": "1999-01" } }));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("unsupported_api_version");
  });

  it("succès : JSON, en-tête Axi-Api-Version, données de la boutique du jeton seulement", async () => {
    const res = await listProducts(req("/api/v1/products", tokenA));
    expect(res.status).toBe(200);
    expect(res.headers.get("axi-api-version")).toBe("2026-10");
    const body = await json(res);
    expect(body.data.map((p: { id: string }) => p.id)).toEqual(["prod_aaaa"]);
    expect(body.page).toEqual({ next_cursor: null, has_more: false });
  });
});

describe("portée : scopes ∩ plan ∩ rôle", () => {
  it("plan Starter : aucune API REST (403 plan_required)", async () => {
    seed({ plan: "STARTER" });
    const res = await listProducts(req("/api/v1/products", tokenA));
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("plan_required");
  });

  it("plan Business : lecture seule (GET 200, POST 403)", async () => {
    seed({ plan: "BUSINESS" });
    expect((await listProducts(req("/api/v1/products", tokenA))).status).toBe(200);
    const res = await createProductRoute(req("/api/v1/products", tokenA, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "k1" }, body: JSON.stringify({ name: "X", price: 100 }) }));
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("plan_required");
  });

  it("scope absent du jeton : 403 insufficient_scope", async () => {
    seed({ scopes: ["store:read"] });
    const res = await listOrders(req("/api/v1/orders", tokenA));
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: "insufficient_scope", required_scope: "orders:read" });
  });

  it("rôle STAFF : pas de catalogue ; gérant : pas de webhooks (réservé au propriétaire)", async () => {
    seed({ role: "STAFF" });
    expect((await listProducts(req("/api/v1/products", tokenA))).status).toBe(403);
    expect((await listOrders(req("/api/v1/orders", tokenA))).status).toBe(200);
    seed({ role: "MANAGER" });
    expect((await listWebhooks(req("/api/v1/webhooks", tokenA))).status).toBe(403);
  });

  it("sans customers:read : commandes sans coordonnées du client", async () => {
    seed({ scopes: ["orders:read"] });
    const body = await json(await getOrder(req("/api/v1/orders/order_aaaa", tokenA), params({ id: "order_aaaa" })));
    expect(body.customer).toBeNull();
    expect(body.payment.reference).toBeNull();
    seed();
    const full = await json(await getOrder(req("/api/v1/orders/order_aaaa", tokenA), params({ id: "order_aaaa" })));
    expect(full.customer).toMatchObject({ name: "Aïcha", phone: "+22997000000" });
  });

  it("quota par minute dépassé : 429 avec Retry-After", async () => {
    state.minuteOk = false;
    const res = await listProducts(req("/api/v1/products", tokenA));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });
});

describe("isolation entre boutiques", () => {
  it("ressources de B introuvables avec le jeton de A (404)", async () => {
    expect((await getProduct(req("/api/v1/products/prod_bbbb", tokenA), params({ id: "prod_bbbb" }))).status).toBe(404);
    expect((await getProduct(req("/api/v1/products/prod_bbbb", tokenB), params({ id: "prod_bbbb" }))).status).toBe(200);
    expect((await getOrder(req("/api/v1/orders/order_bbbb", tokenA), params({ id: "order_bbbb" }))).status).toBe(404);
    const t = await transition(req("/api/v1/orders/order_bbbb/transitions", tokenA, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "t1" }, body: JSON.stringify({ status: "CONFIRMED" }) }), params({ id: "order_bbbb" }));
    expect(t.status).toBe(404);
    const hooks = await json(await listWebhooks(req("/api/v1/webhooks", tokenA)));
    expect(hooks.data).toEqual([]);
  });
});

describe("idempotence des POST", () => {
  const post = (key: string | null, body: unknown, token = tokenA) =>
    transition(req("/api/v1/orders/order_aaaa/transitions", token, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) }), params({ id: "order_aaaa" }));

  it("Idempotency-Key obligatoire", async () => {
    const res = await post(null, { status: "CONFIRMED" });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("idempotency_key_required");
  });

  it("même clé, même corps : réponse rejouée sans nouvelle exécution ; corps différent : 422", async () => {
    const { transitionOrder } = await import("@/lib/commerce/orders");
    vi.mocked(transitionOrder).mockClear();
    const first = await post("key-123", { status: "CONFIRMED" });
    expect(first.status).toBe(201);
    const again = await post("key-123", { status: "CONFIRMED" });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(vi.mocked(transitionOrder)).toHaveBeenCalledTimes(1);
    const reused = await post("key-123", { status: "CANCELLED", reason: "x" });
    expect(reused.status).toBe(422);
    expect((await json(reused)).code).toBe("idempotency_key_reused");
  });

  it("clés cloisonnées par boutique", async () => {
    await post("shared", { status: "CONFIRMED" });
    expect(state.fake!.tables.apiIdempotencyKey.map((k) => k.storeId)).toEqual(["store_a"]);
  });

  it("erreur métier mémorisée (rejouée à l'identique), clé expirée réutilisable", async () => {
    const bad = await post("k-err", { status: "DELIVERED" });
    expect(bad.status).toBe(422);
    const replay = await post("k-err", { status: "DELIVERED" });
    expect(replay.status).toBe(422);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    state.fake!.tables.apiIdempotencyKey[0].expiresAt = new Date(Date.now() - 1000);
    expect((await post("k-err", { status: "CONFIRMED" })).status).toBe(201);
  });

  it("hachage de requête canonique (ordre des clés indifférent)", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(requestHash("POST", "/x", { a: 1, b: 2 })).toBe(requestHash("post", "/x", { b: 2, a: 1 }));
    expect(requestHash("POST", "/x", { a: 1 })).not.toBe(requestHash("POST", "/y", { a: 1 }));
  });
});

describe("pagination par curseur", () => {
  it("curseur opaque aller-retour, curseur forgé refusé", () => {
    expect(decodeCursor(encodeCursor("prod_aaaa"))).toBe("prod_aaaa");
    expect(decodeCursor(null)).toBeUndefined();
    expect(() => decodeCursor("prod_aaaa")).toThrow();
    expect(() => decodeCursor(Buffer.from("c1:'; DROP").toString("base64url"))).toThrow();
  });

  it("limit 1..100 (défaut 20)", () => {
    expect(parseLimit(null)).toBe(20);
    expect(parseLimit("100")).toBe(100);
    expect(() => parseLimit("101")).toThrow();
    expect(() => parseLimit("0")).toThrow();
    expect(() => parseLimit("abc")).toThrow();
  });

  it("page : limit + 1 lignes lues → has_more et next_cursor sur le dernier élément", () => {
    const rows = [{ id: "aaaaaaaa1" }, { id: "aaaaaaaa2" }, { id: "aaaaaaaa3" }];
    const p = toPage(rows, 2, (r) => r.id);
    expect(p.data).toEqual(["aaaaaaaa1", "aaaaaaaa2"]);
    expect(p.page.has_more).toBe(true);
    expect(decodeCursor(p.page.next_cursor)).toBe("aaaaaaaa2");
    expect(toPage(rows.slice(0, 2), 2, (r) => r.id).page).toEqual({ next_cursor: null, has_more: false });
  });

  it("paramètre limit invalide sur la route : 400 problem+json", async () => {
    const res = await listProducts(req("/api/v1/products?limit=500", tokenA));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("invalid_request");
  });

  // m5 : un curseur bien formé mais inconnu (ligne supprimée, curseur d'une AUTRE boutique) faisait échouer
  // Prisma avec un 500. Appartenance vérifiée → 400 explicite, et aucune information sur l'autre boutique.
  it("curseur inconnu ou appartenant à une autre boutique : 400 « Invalid cursor »", async () => {
    for (const id of ["prod_bbbb", "prod_zzzz"]) {
      const res = await listProducts(req(`/api/v1/products?cursor=${encodeCursor(id)}`, tokenA));
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.code).toBe("invalid_request");
      expect(body.detail).toBe("Invalid cursor.");
    }
    // Curseur valide de la boutique : accepté.
    expect((await listProducts(req(`/api/v1/products?cursor=${encodeCursor("prod_aaaa")}`, tokenA))).status).toBe(200);
  });

  it("curseur inconnu sur les commandes : 400 (jamais 500)", async () => {
    const res = await listOrders(req(`/api/v1/orders?cursor=${encodeCursor("order_bbbb")}`, tokenA));
    expect(res.status).toBe(400);
  });
});

// S1 : un point de webhook « avec données personnelles » exige la portée customers:read en plus de
// webhooks:write, sinon un jeton « webhooks » contournerait le masquage appliqué partout ailleurs.
describe("webhooks : données personnelles et portées", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `k-${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({ url: "https://hooks.exemple.com/axi", events: ["order.created"], ...extra }),
  });

  it("include_personal_data sans customers:read : 403 insufficient_scope, rien créé", async () => {
    seed({ scopes: ["webhooks:write", "orders:read"] });
    const res = await createWebhook(req("/api/v1/webhooks", tokenA, body({ include_personal_data: true })));
    expect(res.status).toBe(403);
    const b = await json(res);
    expect(b.code).toBe("insufficient_scope");
    expect(b.required_scope).toBe("customers:read");
    expect(state.fake!.tables.webhookEndpoint.filter((e) => e.storeId === "store_a")).toHaveLength(0);
  });
});
