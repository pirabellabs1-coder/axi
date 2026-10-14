import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({
  stores: [] as any[],
  returns: [] as any[],
  released: [] as [string, number][],
  rules: [] as any[],
  rlOk: true,
  stored: [] as any[],
  order: null as any,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    store: {
      findMany: async () => h.stores,
      findUnique: async () => ({ id: "store_aaaa1", slug: "boutique", status: "PUBLISHED", returnPolicy: { enabled: true }, subscription: null }),
    },
    returnRequest: { findMany: async ({ where }: any) => h.returns.filter((r) => r.storeId === where.storeId) },
    order: { findFirst: async () => h.order },
  },
}));
vi.mock("@/lib/storage/usage", () => ({
  releaseMediaQuota: async (storeId: string, kb: number) => {
    h.released.push([storeId, kb]);
  },
  reserveMediaQuota: async () => true,
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => {
    throw new Error("pilote réel non attendu");
  },
  InvalidImageError: class extends Error {},
  storeImage: async (storeId: string, _body: Uint8Array, opts: any) => {
    h.stored.push({ storeId, namespace: opts.namespace });
    return { url: `/media/stores/${storeId}/returns/2026/10/${"a".repeat(64)}.jpg`, key: "k", bytes: 10, mime: "image/jpeg", created: true };
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "1.2.3.4",
  rateLimitAll: async (rules: any[]) => {
    h.rules = rules;
    return h.rlOk ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 3600 };
  },
  rateLimitMessage: () => "Trop de tentatives",
}));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: () => "BUSINESS" }));
vi.mock("@/lib/addons/service", () => ({ activeAddOnQuantity: async () => 0 }));
vi.mock("@/lib/buyer/session", () => ({ getBuyer: async () => null }));

import { MEDIA_KEY_RE, buildMediaKey, returnMediaPrefix } from "@/lib/storage/keys";
import { purgeOrphanReturnPhotos, keyFromPhotoUrl } from "@/lib/returns/photo-purge";
import { POST } from "@/app/api/s/[slug]/returns/photos/route";

const SHA = "b".repeat(64);
const NOW = new Date("2026-10-12T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000);

function fakeDriver(objects: { key: string; size: number; lastModified: Date | null }[]) {
  const present = new Set(objects.map((o) => o.key));
  return {
    removed: [] as string[],
    async *list(prefix: string) {
      for (const o of objects) if (o.key.startsWith(prefix) && present.has(o.key)) yield o;
    },
    async remove(key: string) {
      const had = present.delete(key);
      if (had) this.removed.push(key);
      return had;
    },
  };
}

describe("clés : espace de noms returns/", () => {
  it("accepte stores/{id}/returns/… et reste strict", () => {
    const k = buildMediaKey("store_aaaa1".replace("_", ""), SHA, "jpg", NOW, "returns");
    expect(k).toBe(`stores/storeaaaa1/returns/2026/10/${SHA}.jpg`);
    expect(MEDIA_KEY_RE.test(k)).toBe(true);
    expect(MEDIA_KEY_RE.test(`stores/storeaaaa1/2026/10/${SHA}.jpg`)).toBe(true);
    expect(MEDIA_KEY_RE.test(`stores/storeaaaa1/autre/2026/10/${SHA}.jpg`)).toBe(false);
    expect(MEDIA_KEY_RE.test(`stores/storeaaaa1/returns/../2026/10/${SHA}.jpg`)).toBe(false);
    expect(keyFromPhotoUrl(`/media/${k}`)).toBe(k);
  });
});

describe("purge des photos de retour orphelines", () => {
  beforeEach(() => {
    h.stores = [{ id: "storeaaaa1" }, { id: "storebbbb1" }];
    h.returns = [];
    h.released = [];
  });

  it("supprime les orphelines de plus de 24 h, garde les citées et les récentes, rend le quota une seule fois", async () => {
    const pa = returnMediaPrefix("storeaaaa1");
    const old = `${pa}2026/10/${"1".repeat(64)}.jpg`;
    const cited = `${pa}2026/10/${"2".repeat(64)}.jpg`;
    const recent = `${pa}2026/10/${"3".repeat(64)}.jpg`;
    const unknownDate = `${pa}2026/10/${"4".repeat(64)}.jpg`;
    const otherStore = `${returnMediaPrefix("storebbbb1")}2026/10/${"1".repeat(64)}.jpg`;
    h.returns = [{ storeId: "storeaaaa1", photos: [{ url: `/media/${cited}` }] }, { storeId: "storebbbb1", photos: [{ url: `/media/${otherStore}` }] }];
    const driver = fakeDriver([
      { key: old, size: 2048, lastModified: hoursAgo(30) },
      { key: cited, size: 2048, lastModified: hoursAgo(30) },
      { key: recent, size: 2048, lastModified: hoursAgo(2) },
      { key: unknownDate, size: 2048, lastModified: null },
      { key: otherStore, size: 4096, lastModified: hoursAgo(48) },
      // Média du commerçant (hors returns/) : jamais listé ni touché.
      { key: `stores/storeaaaa1/2026/10/${"5".repeat(64)}.jpg`, size: 9999, lastModified: hoursAgo(99) },
    ]);
    const r = await purgeOrphanReturnPhotos({ driver: driver as any, now: NOW });
    expect(driver.removed).toEqual([old]);
    expect(h.released).toEqual([["storeaaaa1", 2]]);
    expect(r).toMatchObject({ deleted: 1, releasedKb: 2, errors: 0 });

    // Second passage : rien de plus (objet déjà absent, jamais redécompté).
    const again = await purgeOrphanReturnPhotos({ driver: driver as any, now: NOW });
    expect(again.deleted).toBe(0);
    expect(h.released).toHaveLength(1);
  });
});

describe("POST /api/s/{slug}/returns/photos", () => {
  beforeEach(() => {
    h.rules = [];
    h.rlOk = true;
    h.stored = [];
    h.order = { id: "order_aaaa1", status: "DELIVERED", deliveredAt: new Date(), trackingExpiresAt: new Date(Date.now() + 86_400_000) };
  });

  const req = () =>
    new Request("http://localhost/api/s/boutique/returns/photos", {
      method: "POST",
      headers: { "content-type": "image/jpeg", "x-return-token": "a".repeat(32) },
      body: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });

  it("limite d'environ 6 photos par commande et par 24 h, en plus des limites existantes", async () => {
    const res = await POST(req(), { params: Promise.resolve({ slug: "boutique" }) });
    expect(res.status).toBe(201);
    expect(h.rules).toContainEqual({ key: "returns:photo:order-day:order_aaaa1", limit: 6, windowSec: 86_400 });
    expect(h.rules.length).toBe(4);
    expect(h.stored).toEqual([{ storeId: "store_aaaa1", namespace: "returns" }]);
  });

  it("au-delà : 429 sans écriture", async () => {
    h.rlOk = false;
    const res = await POST(req(), { params: Promise.resolve({ slug: "boutique" }) });
    expect(res.status).toBe(429);
    expect(h.stored).toHaveLength(0);
  });

  it("jeton inconnu : 404 sans débit ni écriture", async () => {
    h.order = null;
    const res = await POST(req(), { params: Promise.resolve({ slug: "boutique" }) });
    expect(res.status).toBe(404);
    expect(h.rules).toHaveLength(0);
    expect(h.stored).toHaveLength(0);
  });
});
