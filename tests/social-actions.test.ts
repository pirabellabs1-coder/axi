import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ db: null as any, fake: null as any, plan: "BUSINESS", audits: [] as any[], jobs: [] as any[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: async (p: unknown) => void state.audits.push(p) }));
vi.mock("@/lib/jobs", () => ({ enqueue: async (type: string, payload: unknown, opts: unknown) => void state.jobs.push({ type, payload, opts }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true, retryAfter: 0 }), rateLimitAll: async () => ({ ok: true, retryAfter: 0 }), clientIp: async () => "1.2.3.4" }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: async (storeId: string) => {
      // L'utilisateur n'est membre que de la boutique A.
      if (storeId !== "store_aaa") throw new AuthError("Boutique introuvable ou accès refusé");
      const store = state.fake.tables.store.find((s: any) => s.id === storeId);
      return { store, user: { id: "user_a" }, role: "OWNER", planId: state.plan, can: () => true };
    },
  };
});

import { setCatalogFeed, saveCatalogSync, saveCatalogOptions, triggerCatalogSyncNow } from "@/lib/social/actions";
import { getCatalogStatus } from "@/lib/social/sync";

function form(data: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.plan = "BUSINESS";
  state.audits = [];
  state.jobs = [];
  state.fake = createFakeDb({
    store: [
      { id: "store_aaa", slug: "boutique-a", name: "A" },
      { id: "store_bbb", slug: "boutique-b", name: "B" },
    ],
    integration: [{ id: "int_a", storeId: "store_aaa", kind: "whatsapp_cloud", status: "active" }],
    socialCatalogSync: [{ id: "sync_bbb_meta", storeId: "store_bbb", channel: "meta", enabled: true, updatedAt: new Date() }],
    socialCatalogItem: [{ id: "it_b", storeId: "store_bbb", syncId: "sync_bbb_wa", productId: "p", retailerId: "r", status: "error", lastError: "B", updatedAt: new Date() }],
    job: [],
  });
  state.db = state.fake.db;
});

const rows = () => state.fake.tables.socialCatalogSync as any[];

describe("actions du catalogue", () => {
  it("activer un flux : ligne créée dans la boutique de l'utilisateur, auditée", async () => {
    const r = await setCatalogFeed("store_aaa", "meta", true);
    expect(r.ok).toBe(true);
    expect(rows().find((x) => x.storeId === "store_aaa" && x.channel === "meta")).toMatchObject({ enabled: true });
    expect(rows().find((x) => x.id === "sync_bbb_meta")).toMatchObject({ enabled: true });
    expect(state.audits[0]).toMatchObject({ storeId: "store_aaa", action: "catalog.feed_enabled", target: "meta" });
  });

  it("autre boutique : refus", async () => {
    const r = await setCatalogFeed("store_bbb", "meta", false);
    expect(r.ok).toBe(false);
    expect(rows().find((x) => x.id === "sync_bbb_meta").enabled).toBe(true);
  });

  it("canal inconnu refusé ; plan sans flux refusé", async () => {
    expect((await setCatalogFeed("store_aaa", "evil" as any, true)).ok).toBe(false);
    state.plan = "STARTER";
    const r = await setCatalogFeed("store_aaa", "google", true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("plan Business");
  });

  it("synchronisation : identifiant numérique exigé, planifiée à l'activation, état oublié au changement de catalogue", async () => {
    const bad = await saveCatalogSync(undefined, form({ storeId: "store_aaa", externalCatalogId: "abc", enabled: "on" }));
    expect(bad.ok).toBe(false);
    const ok = await saveCatalogSync(undefined, form({ storeId: "store_aaa", externalCatalogId: "123456789", enabled: "on" }));
    expect(ok.ok).toBe(true);
    const row = rows().find((x) => x.storeId === "store_aaa" && x.channel === "whatsapp");
    expect(row).toMatchObject({ enabled: true, externalCatalogId: "123456789" });
    expect(row.nextSyncAt).toBeInstanceOf(Date);
    state.fake.tables.socialCatalogItem.push({ id: "it_a", storeId: "store_aaa", syncId: row.id, productId: "p", retailerId: "r", status: "synced" });
    await saveCatalogSync(undefined, form({ storeId: "store_aaa", externalCatalogId: "555555555", enabled: "on" }));
    expect(state.fake.tables.socialCatalogItem.map((i: any) => i.id)).toEqual(["it_b"]);
  });

  it("synchronisation : plan Starter refusé", async () => {
    state.plan = "STARTER";
    expect((await saveCatalogSync(undefined, form({ storeId: "store_aaa", externalCatalogId: "123456789", enabled: "on" }))).ok).toBe(false);
    expect((await triggerCatalogSyncNow("store_aaa")).ok).toBe(false);
  });

  it("options : liste blanche appliquée à tous les canaux de la boutique seulement", async () => {
    const r = await saveCatalogOptions(undefined, form({ storeId: "store_aaa", brand: "Ma marque", includeOutOfStock: "" }));
    expect(r.ok).toBe(true);
    const mine = rows().filter((x) => x.storeId === "store_aaa");
    expect(mine.map((x) => x.channel).sort()).toEqual(["google", "meta", "tiktok", "whatsapp"]);
    for (const x of mine) expect(x.settings).toEqual({ includeOutOfStock: false, brand: "Ma marque", googleProductCategory: null });
    expect(rows().find((x) => x.id === "sync_bbb_meta").settings).toBeUndefined();
  });

  it("options : catégorie Google validée (numéro ou chemin de taxonomie)", async () => {
    const ok = await saveCatalogOptions(undefined, form({ storeId: "store_aaa", brand: "", includeOutOfStock: "on", googleProductCategory: "Apparel & Accessories > Clothing" }));
    expect(ok.ok).toBe(true);
    expect(rows().find((x) => x.storeId === "store_aaa" && x.channel === "google").settings.googleProductCategory).toBe("Apparel & Accessories > Clothing");
    const bad = await saveCatalogOptions(undefined, form({ storeId: "store_aaa", brand: "", includeOutOfStock: "on", googleProductCategory: "<img src=x>" }));
    expect(bad.ok).toBe(false);
  });

  it("synchroniser maintenant : job forcé de la boutique", async () => {
    await saveCatalogSync(undefined, form({ storeId: "store_aaa", externalCatalogId: "123456789", enabled: "on" }));
    const r = await triggerCatalogSyncNow("store_aaa");
    expect(r.ok).toBe(true);
    expect(state.jobs.at(-1)).toMatchObject({ type: "social.sync", payload: { force: true }, opts: { storeId: "store_aaa" } });
  });

  it("état : rien d'une autre boutique", async () => {
    const s = await getCatalogStatus({ id: "store_aaa", slug: "boutique-a" });
    expect(s.feeds.every((f) => !f.enabled)).toBe(true);
    expect(s.errors).toEqual([]);
    expect(s.feeds[0].url).toMatch(/\/s\/boutique-a\/feeds\/meta\.xml$/);
  });
});
