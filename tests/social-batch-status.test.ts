import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ db: null as any, fake: null as any, jobs: [] as any[] }));

vi.mock("server-only", () => ({}));
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

import { interpretBatchStatus, readStatusCheck, statusCheckDelayMs, MAX_STATUS_CHECKS } from "@/lib/social/meta-batch";
import { runBatchStatusCheck, runCatalogSync } from "@/lib/social/sync";
import { DEFAULT_GRAPH_VERSION, GRAPH_VERSION, graphCatalogApi, isRateLimitError, GraphCatalogError, type CatalogApi } from "@/lib/social/graph-client";

const NOW = new Date("2026-10-14T12:00:00Z");
const SENT = "2026-10-14T11:59:00.000Z";

function seed() {
  state.fake = createFakeDb({
    store: [{ id: "store_aaa", slug: "boutique-a", name: "A", currency: "XOF", status: "PUBLISHED" }],
    subscription: [{ id: "sub_a", storeId: "store_aaa", planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2027-12-31T00:00:00Z") }],
    socialCatalogSync: [
      { id: "sync_aaa_wa", storeId: "store_aaa", channel: "whatsapp", enabled: true, status: "ok", externalCatalogId: "123456789", consecutiveFailures: 0, settings: null, updatedAt: NOW, nextSyncAt: null },
      { id: "sync_bbb_wa", storeId: "store_bbb", channel: "whatsapp", enabled: true, status: "ok", externalCatalogId: "987654321", consecutiveFailures: 0, settings: null, updatedAt: NOW, nextSyncAt: null },
    ],
    socialCatalogItem: [
      { id: "i1", storeId: "store_aaa", syncId: "sync_aaa_wa", productId: "p1", variantId: null, retailerId: "prod_aaa_0001", contentHash: "x", status: "synced", syncedAt: new Date(SENT) },
      { id: "i2", storeId: "store_aaa", syncId: "sync_aaa_wa", productId: "p2", variantId: null, retailerId: "prod_aaa_0002", contentHash: "x", status: "synced", syncedAt: new Date(SENT) },
      { id: "i3", storeId: "store_bbb", syncId: "sync_bbb_wa", productId: "p3", variantId: null, retailerId: "prod_aaa_0001", contentHash: "x", status: "synced", syncedAt: new Date(SENT) },
    ],
    product: [],
    category: [],
    domain: [],
  });
  state.db = state.fake.db;
}

function statusApi(status: Record<string, unknown>): CatalogApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async itemsBatch() {
      return { handles: ["h-new"], validation_status: [] };
    },
    async checkBatchStatus(catalogId, handle) {
      calls.push(`${catalogId}:${handle}`);
      return { data: [{ handle, ...status }] };
    },
  };
}

const item = (id: string) => (state.fake.tables.socialCatalogItem as any[]).find((i) => i.id === id);
const sync = (id: string) => (state.fake.tables.socialCatalogSync as any[]).find((s) => s.id === id);

beforeEach(() => {
  seed();
  state.jobs = [];
});

describe("interprétation de check_batch_request_status", () => {
  it("finished : requêtes invalides avec le message Meta s'il est fourni", () => {
    const r = interpretBatchStatus({ data: [{ status: "finished", errors_total_count: 2, ids_of_invalid_requests: ["a", "b"], errors: [{ id: "a", line: 1, message: "Image too small" }] }] });
    expect(r.state).toBe("finished");
    if (r.state !== "finished") return;
    expect(r.invalid).toEqual([
      { retailerId: "a", error: "Image too small" },
      { retailerId: "b", error: expect.stringContaining("Commerce Manager") },
    ]);
    expect(r.errorsTotal).toBe(2);
  });
  it("en cours (scheduled/dispatched/started), échec (canceled/error), casse indifférente", () => {
    for (const s of ["scheduled", "Dispatched", "STARTED", ""]) expect(interpretBatchStatus({ data: [{ status: s }] }).state).toBe("pending");
    for (const s of ["Canceled", "error"]) expect(interpretBatchStatus({ data: [{ status: s }] }).state).toBe("failed");
    expect(interpretBatchStatus({}).state).toBe("pending");
  });
  it("charge utile validée et calendrier borné", () => {
    expect(readStatusCheck({ handles: ["AbC-1"], sentAt: SENT, attempt: 0 })).toEqual({ handles: ["AbC-1"], sentAt: SENT, attempt: 0 });
    expect(readStatusCheck({ handles: ["<x>"], sentAt: SENT, attempt: 0 })).toBeNull();
    expect(readStatusCheck({ handles: ["h"], sentAt: "nope", attempt: 0 })).toBeNull();
    expect(readStatusCheck({ handles: ["h"], sentAt: SENT, attempt: MAX_STATUS_CHECKS })).toBeNull();
    expect(statusCheckDelayMs(0)).toBe(60_000);
    expect(statusCheckDelayMs(MAX_STATUS_CHECKS)).toBeNull();
  });
});

describe("client Graph", () => {
  it("version v26.0 par défaut, URL et paramètres documentés, jeton en en-tête seulement", async () => {
    expect(DEFAULT_GRAPH_VERSION).toBe("v26.0");
    if (!process.env.META_GRAPH_VERSION) expect(GRAPH_VERSION).toBe("v26.0");
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(url.includes("items_batch") ? { handles: ["h1"] } : { data: [{ status: "finished" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = graphCatalogApi("EAAsecret", fetchImpl);
    await api.itemsBatch("123456789", [{ method: "UPDATE", data: { id: "x", additional_image_link: ["https://a/1.jpg"] } }]);
    await api.checkBatchStatus("123456789", "h1");
    expect(seen[0].url).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/123456789/items_batch`);
    const body = JSON.parse(String(seen[0].init.body));
    expect(body).toMatchObject({ item_type: "PRODUCT_ITEM", allow_upsert: true });
    expect(body.requests[0].data.additional_image_link).toEqual(["https://a/1.jpg"]);
    expect(seen[1].url).toContain(`/123456789/check_batch_request_status?handle=h1&load_ids_of_invalid_requests=true`);
    expect(seen[1].init.method).toBe("GET");
    for (const s of seen) {
      expect(s.url).not.toContain("EAAsecret");
      expect((s.init.headers as Record<string, string>).Authorization).toBe("Bearer EAAsecret");
    }
    await expect(api.checkBatchStatus("123456789", "bad handle!")).rejects.toThrow();
  });
  it("quota Meta (80014) reconnu comme relançable", () => {
    expect(isRateLimitError(new GraphCatalogError("x", 400, 80014))).toBe(true);
    expect(isRateLimitError(new GraphCatalogError("x", 400, 190))).toBe(false);
  });
});

describe("suivi asynchrone de la synchronisation", () => {
  it("un envoi planifie une vérification (job social.sync avec check, même boutique, +1 min)", async () => {
    state.fake.tables.product.push({
      id: "prod_aaa_0003", storeId: "store_aaa", slug: "sac", name: "Sac", description: null, price: 5000, compareAtPrice: null, promoPrice: null, promoStart: null, promoEnd: null,
      barcode: null, trackStock: false, stock: 0, inventoryPolicy: "DENY", images: [{ url: "https://img.example.com/sac.jpg" }], vendor: null, categoryId: null, isGiftCard: false,
      status: "ACTIVE", position: 0, createdAt: NOW,
    });
    const r = await runCatalogSync("sync_aaa_wa", { api: statusApi({ status: "finished" }), now: NOW, jobStoreId: "store_aaa" });
    expect(r.ok).toBe(true);
    const job = state.jobs.find((j) => j.type === "social.sync" && j.payload.check);
    expect(job).toBeTruthy();
    expect(job.payload).toEqual({ syncId: "sync_aaa_wa", check: { handles: ["h-new"], sentAt: NOW.toISOString(), attempt: 0 } });
    expect(job.opts.storeId).toBe("store_aaa");
    expect(job.opts.runAt.getTime()).toBe(NOW.getTime() + 60_000);
  });

  it("lot terminé : refus tardifs rattachés aux articles de SA boutique, statut mis à jour", async () => {
    const api = statusApi({ status: "finished", ids_of_invalid_requests: ["prod_aaa_0001"], errors: [{ id: "prod_aaa_0001", message: "Price format invalid" }] });
    const r = await runBatchStatusCheck("sync_aaa_wa", { handles: ["h1"], sentAt: SENT, attempt: 0 }, { api, now: NOW, jobStoreId: "store_aaa" });
    expect(r).toEqual({ ok: true, state: "finished", invalid: 1 });
    expect(api.calls).toEqual(["123456789:h1"]);
    expect(item("i1")).toMatchObject({ status: "error", lastError: "Price format invalid" });
    expect(item("i2").status).toBe("synced");
    expect(item("i3").status).toBe("synced"); // même retailer_id, autre boutique : intact
    expect(sync("sync_aaa_wa")).toMatchObject({ status: "error", lastError: expect.stringContaining("1 article refusé") });
    expect(state.jobs).toHaveLength(0);
  });

  it("lot en cours : nouvelle vérification plus tard ; dernière tentative : abandon", async () => {
    const api = statusApi({ status: "started" });
    await runBatchStatusCheck("sync_aaa_wa", { handles: ["h1"], sentAt: SENT, attempt: 0 }, { api, now: NOW });
    expect(state.jobs[0].payload.check).toEqual({ handles: ["h1"], sentAt: SENT, attempt: 1 });
    expect(state.jobs[0].opts.runAt.getTime()).toBe(NOW.getTime() + 2 * 60_000);
    state.jobs = [];
    await runBatchStatusCheck("sync_aaa_wa", { handles: ["h1"], sentAt: SENT, attempt: MAX_STATUS_CHECKS - 1 }, { api, now: NOW });
    expect(state.jobs).toHaveLength(0);
  });

  it("lot annulé / en erreur chez Meta : articles du passage remis en attente, synchronisation replanifiée", async () => {
    await runBatchStatusCheck("sync_aaa_wa", { handles: ["h1"], sentAt: SENT, attempt: 0 }, { api: statusApi({ status: "error" }), now: NOW });
    expect(item("i1").status).toBe("pending");
    expect(item("i2").status).toBe("pending");
    expect(item("i3").status).toBe("synced");
    expect(sync("sync_aaa_wa").nextSyncAt.getTime()).toBe(NOW.getTime());
  });

  it("job d'une autre boutique ou charge utile invalide : refusé sans appel", async () => {
    const api = statusApi({ status: "finished" });
    expect((await runBatchStatusCheck("sync_aaa_wa", { handles: ["h1"], sentAt: SENT, attempt: 0 }, { api, jobStoreId: "store_bbb" })).ok).toBe(false);
    expect((await runBatchStatusCheck("sync_aaa_wa", { handles: [], sentAt: SENT, attempt: 0 }, { api })).ok).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it("erreur réseau pendant la vérification : reportée, état inchangé", async () => {
    const api: CatalogApi = {
      itemsBatch: async () => ({}),
      checkBatchStatus: async () => {
        throw new GraphCatalogError("Meta : erreur réseau", 0, null);
      },
    };
    const r = await runBatchStatusCheck("sync_aaa_wa", { handles: ["h1"], sentAt: SENT, attempt: 2 }, { api, now: NOW });
    expect(r).toMatchObject({ ok: true, state: "pending" });
    expect(state.jobs[0].payload.check.attempt).toBe(3);
    expect(item("i1").status).toBe("synced");
  });
});
