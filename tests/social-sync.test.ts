import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ db: null as any, fake: null as any, jobs: [] as any[], outbound: [] as any[], creditFail: false }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/jobs", () => ({
  enqueue: async (type: string, payload: unknown, opts: unknown) => {
    state.jobs.push({ type, payload, opts });
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }));
vi.mock("@/lib/inbox/service", () => {
  class CreditError extends Error {}
  return {
    CreditError,
    queueOutboundMessage: async (_tx: unknown, p: any) => {
      if (p.apiActive && state.creditFail) throw new CreditError("Crédits insuffisants");
      state.outbound.push(p);
      return { id: "msg_1" };
    },
    scheduleDispatch: async () => {},
  };
});

import { backoffDelayMs, buildBatchRequests, diffCatalog, mapBatchResponse, redactSecrets, sanitizeError, type DesiredItem, type ExistingItem } from "@/lib/social/meta-batch";
import { runCatalogSync, scheduleDueCatalogSyncs, requestCatalogSync } from "@/lib/social/sync";
import { GraphCatalogError, graphCatalogApi, type CatalogApi } from "@/lib/social/graph-client";
import { handleCatalogOrderMessage, parseWhatsappOrder, resolveOrderItems, buildOrderReply } from "@/lib/social/whatsapp-order";

const d = (retailerId: string, hash = "h1"): DesiredItem => ({ retailerId, productId: "p", variantId: null, hash, data: { id: retailerId, title: "t" } });
const e = (retailerId: string, contentHash = "h1", status = "synced"): ExistingItem => ({ id: `row_${retailerId}`, retailerId, productId: "p", variantId: null, contentHash, status });

describe("diff incrémental", () => {
  it("nouveau, modifié, inchangé, supprimé", () => {
    const diff = diffCatalog([d("a"), d("b", "h2"), d("c")], [e("b"), e("c"), e("gone")]);
    expect(diff.upserts.map((x) => x.retailerId)).toEqual(["a", "b"]);
    expect(diff.deletes.map((x) => x.retailerId)).toEqual(["gone"]);
    expect(diff.unchanged).toBe(1);
  });

  it("article refusé inchangé : bloqué, sauf synchronisation forcée ; en attente : renvoyé", () => {
    expect(diffCatalog([d("a")], [e("a", "h1", "error")])).toMatchObject({ upserts: [], blocked: 1 });
    expect(diffCatalog([d("a")], [e("a", "h1", "error")], { force: true }).upserts).toHaveLength(1);
    expect(diffCatalog([d("a")], [e("a", "h1", "pending")]).upserts).toHaveLength(1);
    expect(diffCatalog([d("a", "h2")], [e("a", "h1", "error")]).upserts).toHaveLength(1);
  });

  it("doublons ignorés", () => {
    expect(diffCatalog([d("a"), d("a")], []).upserts).toHaveLength(1);
  });
});

describe("requêtes items_batch", () => {
  it("DELETE puis UPDATE, découpées en lots", () => {
    const batches = buildBatchRequests({ upserts: [d("a"), d("b"), d("c")], deletes: [e("x")] }, 3);
    expect(batches).toHaveLength(2);
    expect(batches[0][0]).toEqual({ method: "DELETE", data: { id: "x" } });
    expect(batches[0][1]).toEqual({ method: "UPDATE", data: { id: "a", title: "t" } });
    expect(batches[1]).toHaveLength(1);
  });

  it("réponse : erreurs rattachées au retailer_id, le reste accepté", () => {
    const reqs = buildBatchRequests({ upserts: [d("a"), d("b")], deletes: [] })[0];
    const out = mapBatchResponse(reqs, { handles: ["h"], validation_status: [{ retailer_id: "b", errors: [{ message: "Image trop petite" }, { message: "Prix invalide" }] }, { retailer_id: "a", errors: [] }] });
    expect(out).toEqual([
      { retailerId: "a", method: "UPDATE", ok: true, error: null },
      { retailerId: "b", method: "UPDATE", ok: false, error: "Image trop petite ; Prix invalide" },
    ]);
  });
});

describe("secrets et backoff", () => {
  it("masque les jetons Meta, Bearer, access_token et le jeton exact", () => {
    const t = "EAAGabcdefghijklmnop123";
    const s = redactSecrets(`Bearer ${t} url?access_token=${t}&x=1 raw ${t} other EAAZZZZZZZZZZZZZ`);
    expect(s).not.toContain(t);
    expect(s).not.toContain("EAAZZZZZZZZZZZZZ");
    expect(sanitizeError("x secret-token-value y", 100, ["secret-token-value"])).toBe("x [secret masqué] y");
  });

  it("backoff exponentiel plafonné à 24 h", () => {
    expect(backoffDelayMs(1)).toBe(5 * 60_000);
    expect(backoffDelayMs(2)).toBe(10 * 60_000);
    expect(backoffDelayMs(4)).toBe(40 * 60_000);
    expect(backoffDelayMs(50)).toBe(24 * 3600_000);
  });

  it("client Graph : jeton jamais présent dans l'erreur", async () => {
    const token = "EAAGsecretTOKEN1234567";
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: `Invalid OAuth access token ${token}`, code: 190 } }), { status: 401 })) as unknown as typeof fetch;
    const err = await graphCatalogApi(token, fakeFetch).itemsBatch("123456789", []).catch((x) => x);
    expect(err).toBeInstanceOf(GraphCatalogError);
    expect(err.message).not.toContain(token);
    expect(err.code).toBe(190);
  });
});

/* ───────────────────────── Synchronisation avec une base factice ───────────────────────── */

const FUTURE = new Date(Date.now() + 30 * 86_400_000);
const NOW = new Date("2026-10-11T12:00:00Z");

function seed(planId = "BUSINESS") {
  const img = [{ url: "https://img.example.com/a.jpg" }];
  const prod = (id: string, storeId: string, extra: Record<string, unknown> = {}) => ({
    id, storeId, slug: id, name: `Produit ${id}`, description: "Desc", status: "ACTIVE", price: 10000, compareAtPrice: null, promoPrice: null, promoStart: null, promoEnd: null,
    barcode: null, trackStock: false, stock: 0, inventoryPolicy: "DENY", images: img, vendor: null, categoryId: null, isGiftCard: false, minQty: 1, maxQty: null, position: 0, ...extra,
  });
  state.fake = createFakeDb({
    store: [
      { id: "store_aaa", slug: "boutique-a", name: "Boutique A", currency: "XOF", status: "PUBLISHED" },
      { id: "store_bbb", slug: "boutique-b", name: "Boutique B", currency: "XOF", status: "PUBLISHED" },
    ],
    subscription: [
      { id: "sub_a", storeId: "store_aaa", planId, status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
      { id: "sub_b", storeId: "store_bbb", planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
    ],
    product: [prod("prod_aaa_robe", "store_aaa"), prod("prod_aaa_sac0", "store_aaa"), prod("prod_bbb_robe", "store_bbb")],
    variant: [
      { id: "var_aaa_m_001", productId: "prod_aaa_robe", name: "M", attributes: { Taille: "M" }, price: null, compareAtPrice: null, barcode: null, imageUrl: null, available: true, stock: 0, inventoryPolicy: "DENY", position: 0 },
      { id: "var_bbb_m_001", productId: "prod_bbb_robe", name: "M", attributes: { Taille: "M" }, price: null, compareAtPrice: null, barcode: null, imageUrl: null, available: true, stock: 0, inventoryPolicy: "DENY", position: 0 },
    ],
    category: [],
    integration: [{ id: "int_a", storeId: "store_aaa", kind: "whatsapp_cloud", status: "active", phoneNumberId: "1111111", secretsEncrypted: JSON.stringify({ token: "EAAGtokenAAAAAAAAAA" }) }],
    socialCatalogSync: [
      { id: "sync_aaa_wa", storeId: "store_aaa", channel: "whatsapp", enabled: true, status: "idle", externalCatalogId: "123456789", consecutiveFailures: 0, settings: null, nextSyncAt: new Date(NOW.getTime() - 1000), updatedAt: NOW },
      { id: "sync_bbb_wa", storeId: "store_bbb", channel: "whatsapp", enabled: true, status: "idle", externalCatalogId: "987654321", consecutiveFailures: 0, settings: null, nextSyncAt: null, updatedAt: NOW },
    ],
    socialCatalogItem: [
      { id: "item_a_gone", storeId: "store_aaa", syncId: "sync_aaa_wa", productId: "prod_deleted", variantId: null, retailerId: "prod_deleted_01", contentHash: "x", status: "synced" },
      { id: "item_b_keep", storeId: "store_bbb", syncId: "sync_bbb_wa", productId: "prod_bbb_robe", variantId: "var_bbb_m_001", retailerId: "var_bbb_m_001", contentHash: "x", status: "synced" },
    ],
    job: [],
    conversation: [
      { id: "conv_a", storeId: "store_aaa", phone: "22990000001", channel: "whatsapp" },
      { id: "conv_b", storeId: "store_bbb", phone: "22990000001", channel: "whatsapp" },
    ],
  });
  state.db = state.fake.db;
}

function recordingApi(reject: string[] = []) {
  const calls: { catalogId: string; requests: any[] }[] = [];
  const api: CatalogApi = {
    async itemsBatch(catalogId, requests) {
      calls.push({ catalogId, requests });
      return { handles: ["h1"], validation_status: requests.filter((r) => reject.includes(r.data.id)).map((r) => ({ retailer_id: r.data.id, errors: [{ message: "Image trop petite" }] })) };
    },
    async checkBatchStatus(_catalogId, handle) {
      return { data: [{ handle, status: "finished", ids_of_invalid_requests: [] }] };
    },
  };
  return { api, calls };
}

const items = () => state.fake.tables.socialCatalogItem as any[];
const syncRow = (id: string) => state.fake.tables.socialCatalogSync.find((s: any) => s.id === id);

beforeEach(() => {
  seed();
  state.jobs = [];
  state.outbound = [];
  state.creditFail = false;
});

describe("runCatalogSync", () => {
  it("envoie le diff de SA boutique, enregistre l'état par article, supprime les retirés", async () => {
    const { api, calls } = recordingApi(["prod_aaa_sac0"]);
    const r = await runCatalogSync("sync_aaa_wa", { api, now: NOW, jobStoreId: "store_aaa" });
    expect(r).toMatchObject({ ok: true, upserted: 1, deleted: 1, failed: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].catalogId).toBe("123456789");
    const ids = calls[0].requests.map((x) => `${x.method}:${x.data.id}`);
    expect(ids).toEqual(["DELETE:prod_deleted_01", "UPDATE:var_aaa_m_001", "UPDATE:prod_aaa_sac0"]);
    // Aucun article de la boutique B
    expect(JSON.stringify(calls)).not.toContain("bbb");
    expect(items().find((i) => i.retailerId === "var_aaa_m_001")).toMatchObject({ status: "synced", storeId: "store_aaa", syncId: "sync_aaa_wa" });
    expect(items().find((i) => i.retailerId === "prod_aaa_sac0")).toMatchObject({ status: "error", lastError: "Image trop petite" });
    expect(items().find((i) => i.retailerId === "prod_deleted_01")).toBeUndefined();
    expect(items().find((i) => i.id === "item_b_keep")).toMatchObject({ status: "synced", contentHash: "x" });
    expect(syncRow("sync_aaa_wa")).toMatchObject({ status: "error", consecutiveFailures: 0, itemCount: 2 });
    expect(syncRow("sync_aaa_wa").nextSyncAt.getTime()).toBe(NOW.getTime() + 3600_000);

    // Deuxième passage sans changement : aucun appel ; l'article refusé reste signalé.
    const second = recordingApi();
    const r2 = await runCatalogSync("sync_aaa_wa", { api: second.api, now: NOW });
    expect(second.calls).toHaveLength(0);
    expect(r2).toMatchObject({ ok: true, unchanged: 1, blocked: 1 });
    expect(syncRow("sync_aaa_wa").lastError).toContain("1 article refusé");

    // Synchronisation forcée : tout est renvoyé, l'article corrigé côté Meta passe en « synced ».
    const third = recordingApi();
    await runCatalogSync("sync_aaa_wa", { api: third.api, now: NOW, force: true });
    expect(third.calls[0].requests).toHaveLength(2);
    expect(items().filter((i) => i.syncId === "sync_aaa_wa").every((i) => i.status === "synced")).toBe(true);
    expect(syncRow("sync_aaa_wa")).toMatchObject({ status: "ok", lastError: null });
  });

  it("erreur Graph : backoff, compteur d'échecs, jamais le jeton dans lastError", async () => {
    const token = "EAAGtokenAAAAAAAAAA";
    const api: CatalogApi = {
      itemsBatch: async () => {
        throw new GraphCatalogError(`Meta 401 : token ${token} invalid`, 401, 190);
      },
      checkBatchStatus: async () => ({ data: [] }),
    };
    const r = await runCatalogSync("sync_aaa_wa", { api, now: NOW });
    expect(r.ok).toBe(false);
    const row = syncRow("sync_aaa_wa");
    expect(row.status).toBe("error");
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastError).not.toContain(token);
    expect(row.lastError).toContain("catalog_management");
    expect(row.nextSyncAt.getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(items().find((i) => i.retailerId === "var_aaa_m_001")).toMatchObject({ status: "error" });
  });

  it("job d'une autre boutique : refusé sans effet", async () => {
    const { api, calls } = recordingApi();
    const r = await runCatalogSync("sync_aaa_wa", { api, now: NOW, jobStoreId: "store_bbb" });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(syncRow("sync_aaa_wa").status).toBe("idle");
  });

  it("plan sans synchronisation : suspendue (plus de planification), rien n'est envoyé", async () => {
    seed("STARTER");
    const { api, calls } = recordingApi();
    const r = await runCatalogSync("sync_aaa_wa", { api, now: NOW });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(syncRow("sync_aaa_wa")).toMatchObject({ status: "error", nextSyncAt: null });
  });

  it("déjà en cours : pas de seconde exécution", async () => {
    syncRow("sync_aaa_wa").status = "syncing";
    syncRow("sync_aaa_wa").updatedAt = new Date(NOW.getTime() - 60_000);
    const { api, calls } = recordingApi();
    expect((await runCatalogSync("sync_aaa_wa", { api, now: NOW })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("planification", () => {
  it("met en file les synchronisations échues une seule fois (bail)", async () => {
    expect(await scheduleDueCatalogSyncs(NOW)).toEqual({ enqueued: 1 });
    expect(state.jobs).toEqual([{ type: "social.sync", payload: { syncId: "sync_aaa_wa" }, opts: { storeId: "store_aaa" } }]);
    expect(await scheduleDueCatalogSyncs(NOW)).toEqual({ enqueued: 0 });
  });

  it("synchronisation manuelle : forcée, dans la boutique demandée", async () => {
    const r = await requestCatalogSync("store_aaa", NOW);
    expect(r).toEqual({ ok: true, syncId: "sync_aaa_wa" });
    expect(state.jobs[0]).toMatchObject({ type: "social.sync", payload: { syncId: "sync_aaa_wa", force: true }, opts: { storeId: "store_aaa" } });
    syncRow("sync_bbb_wa").enabled = false;
    expect(await requestCatalogSync("store_bbb", NOW)).toMatchObject({ ok: false });
  });
});

describe("panier WhatsApp (message « order ») : lien de panier Axi", () => {
  const order = (ids: string[]) => ({ catalog_id: "123456789", text: "Bonjour", product_items: ids.map((id) => ({ product_retailer_id: id, quantity: "2", item_price: "1", currency: "XOF" })) });

  it("lecture du message (quantités en texte, prix Meta ignoré)", () => {
    expect(parseWhatsappOrder(order(["var_aaa_m_001"]))?.product_items[0]).toEqual({ product_retailer_id: "var_aaa_m_001", quantity: 2 });
    expect(parseWhatsappOrder({ product_items: [] })).toBeNull();
    expect(parseWhatsappOrder("x")).toBeNull();
  });

  it("isolation : les articles d'une autre boutique sont ignorés", async () => {
    const r = await resolveOrderItems("store_aaa", parseWhatsappOrder(order(["var_aaa_m_001", "var_bbb_m_001", "prod_bbb_robe", "prod_aaa_robe"]))!, NOW);
    expect(r.lines.map((l) => l.variantId ?? l.productId)).toEqual(["var_aaa_m_001"]);
    // prod_aaa_robe a des variantes : non commandable sans variante ; les deux de B sont inconnus ici.
    expect(r.unavailable).toBe(3);
    expect(r.lines[0]).toMatchObject({ productId: "prod_aaa_robe", quantity: 2, unitPrice: 10000 });
  });

  it("crée un panier dans la boutique du numéro et répond avec le lien", async () => {
    const r = await handleCatalogOrderMessage({ storeId: "store_aaa", phone: "+229 90 00 00 01", messageId: "wamid.1", order: order(["var_aaa_m_001", "var_bbb_m_001"]) }, NOW);
    expect(r.status).toBe("replied");
    const create = state.fake.calls.find((c: any) => c.model === "cart" && c.op === "create");
    expect(create.args.data).toMatchObject({ storeId: "store_aaa", token: r.cartToken, attribution: { source: "whatsapp_catalog", messageId: "wamid.1" } });
    expect(create.args.data.items.create).toEqual([{ productId: "prod_aaa_robe", variantId: "var_aaa_m_001", quantity: 2 }]);
    expect(state.outbound).toHaveLength(1);
    expect(state.outbound[0]).toMatchObject({ storeId: "store_aaa", conversationId: "conv_a", phone: "22990000001", apiActive: true, template: "catalog.order_link" });
    expect(state.outbound[0].body).toContain(`/s/boutique-a?panier=${r.cartToken}`);
    expect(state.outbound[0].body).toContain("1 article indisponible");
  });

  it("crédits insuffisants : réponse préparée (wa.me) dans la boîte de réception", async () => {
    state.creditFail = true;
    const r = await handleCatalogOrderMessage({ storeId: "store_aaa", phone: "22990000001", messageId: "wamid.2", order: order(["var_aaa_m_001"]) }, NOW);
    expect(r.status).toBe("link_only");
    expect(state.outbound).toHaveLength(1);
    expect(state.outbound[0].apiActive).toBe(false);
  });

  it("aucun article disponible : pas de panier, message d'excuse", async () => {
    const r = await handleCatalogOrderMessage({ storeId: "store_aaa", phone: "22990000001", messageId: "wamid.3", order: order(["var_bbb_m_001"]) }, NOW);
    expect(r.cartToken).toBeUndefined();
    expect(state.fake.calls.some((c: any) => c.model === "cart" && c.op === "create")).toBe(false);
    expect(state.outbound[0].body).toContain("ne sont plus disponibles");
  });

  it("boutique fermée temporairement", () => {
    expect(buildOrderReply({ storeName: "A", url: null, lines: [], unavailable: 0, currency: "XOF", closed: true })).toContain("fermée temporairement");
  });
});
