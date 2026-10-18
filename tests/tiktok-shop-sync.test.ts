import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Connexion (jetons chiffrés, rafraîchissement), webhook signé et idempotent, publication produit, expéditions.
 * Client TikTok SIMULÉ (TIKTOK_SHOP_FAKE=1, NODE_ENV de test).
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})), queueNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/webhooks/emit", () => ({ emitDomainEvent: vi.fn(async () => ({ eventId: "evt" })) }));
vi.mock("@/lib/currency/rates", () => ({ loadPlatformRates: vi.fn(async () => []) }));

import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { needsRefresh, refreshTokens, tokenProvider, sealTokens } from "@/lib/tiktok-shop/connection";
import { handleTiktokWebhook } from "@/lib/tiktok-shop/webhook";
import { webhookSignature } from "@/lib/tiktok-shop/sign";
import { fetchImageBytes, publishProduct, pullOrders, pushShipments, syncStock } from "@/lib/tiktok-shop/sync";
import { activateShop } from "@/lib/tiktok-shop/oauth";
import { readConfig, linkOf } from "@/lib/tiktok-shop/model";
import { readBodyLimited } from "@/lib/tiktok-shop/body";
import { FakeTiktokShopClient } from "@/lib/tiktok-shop/fake";
import { fakeState, injectFakeOrder, resetFake, fakeTokens } from "@/lib/tiktok-shop/fake";
import { TiktokShopError, type TiktokShopAuth } from "@/lib/tiktok-shop/types";
import { enqueue } from "@/lib/jobs";

const A = "store_A_0001";
const B = "store_B_0001";
const IMG = "https://cdn.example.com/stores/a/robe.jpg";
const NOW = Date.now();

function integration(storeId: string, shopId: string, extra: Record<string, unknown> = {}) {
  return {
    id: `int_${storeId}`,
    storeId,
    kind: "tiktok_shop",
    status: "active",
    updatedAt: new Date(NOW - 1000),
    lastError: null,
    secretsEncrypted: sealTokens({ accessToken: `fake_at_${storeId}`, refreshToken: "fake_rt_seed" }),
    config: {
      shop: { id: shopId, name: "Shop", region: "FR", cipher: `cipher_${storeId}`, currency: "EUR" },
      warehouseId: "WH1",
      tokens: { accessExpiresAt: NOW + 86_400_000, refreshExpiresAt: NOW + 30 * 86_400_000 },
      products: {},
      ...extra,
    },
  };
}

function seed() {
  return createFakeDb({
    store: [
      { id: A, currency: "XOF", country: "BJ" },
      { id: B, currency: "XOF", country: "BJ" },
    ],
    integration: [integration(A, "7494"), integration(B, "9999")],
    product: [
      { id: "prod_A_0001", storeId: A, name: "Robe wax", description: "Belle robe", status: "ACTIVE", kind: "PHYSICAL", isGiftCard: false, price: 15_000, sku: null, trackStock: true, stock: 4, weightGrams: 300, images: [{ url: IMG }], variants: [] },
    ],
  });
}

const t = (): Record<string, any[]> => state.fake!.tables as any;
const cfg = (storeId: string) => t().integration.find((i: any) => i.storeId === storeId).config;

beforeEach(() => {
  process.env.TIKTOK_SHOP_FAKE = "1";
  state.fake = seed();
  resetFake();
  vi.mocked(enqueue).mockClear();
});

describe("jetons", () => {
  it("rafraîchit 5 min avant l'échéance", () => {
    expect(needsRefresh(NOW + 60_000, NOW)).toBe(true);
    expect(needsRefresh(NOW + 3_600_000, NOW)).toBe(false);
    expect(needsRefresh(null, NOW)).toBe(true);
  });

  it("refreshTokens : nouveaux jetons chiffrés au repos, échéances mises à jour, jamais en clair dans config", async () => {
    const auth: TiktokShopAuth = { exchangeCode: vi.fn(), refresh: vi.fn(async (rt: string) => fakeTokens(rt, NOW)) };
    const at = await refreshTokens(A, auth, NOW);
    expect(auth.refresh).toHaveBeenCalledWith("fake_rt_seed");
    const row = t().integration.find((i: any) => i.storeId === A);
    expect(JSON.parse(decryptSecret(row.secretsEncrypted)).accessToken).toBe(at);
    expect(JSON.stringify(row.config)).not.toContain(at);
    expect(row.config.tokens.accessExpiresAt).toBe(NOW + 7 * 86_400_000);
    // Boutique B intacte.
    expect(JSON.parse(decryptSecret(t().integration.find((i: any) => i.storeId === B).secretsEncrypted)).accessToken).toBe(`fake_at_${B}`);
  });

  it("tokenProvider.get : jeton valide relu sans appel ; expirant → rafraîchi", async () => {
    const auth: TiktokShopAuth = { exchangeCode: vi.fn(), refresh: vi.fn(async (rt: string) => fakeTokens(rt, NOW)) };
    expect(await tokenProvider(A, auth).get()).toBe(`fake_at_${A}`);
    expect(auth.refresh).not.toHaveBeenCalled();
    cfg(A).tokens.accessExpiresAt = Date.now() + 1000;
    expect(await tokenProvider(A, auth).get()).toMatch(/^fake_at_/);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it("rafraîchissement refusé : connexion en erreur, message de reconnexion", async () => {
    const auth: TiktokShopAuth = { exchangeCode: vi.fn(), refresh: vi.fn(async () => Promise.reject(new TiktokShopError("invalid refresh token", "auth"))) };
    await expect(refreshTokens(A, auth, NOW)).rejects.toMatchObject({ kind: "auth" });
    expect(t().integration.find((i: any) => i.storeId === A)).toMatchObject({ status: "error", lastError: expect.stringMatching(/reconnectez/) });
  });

  it("le format chiffré n'est pas du JSON en clair", () => {
    expect(encryptSecret("x")).toMatch(/^v1\./);
  });
});

describe("webhook", () => {
  const body = (o: Record<string, unknown>) => Buffer.from(JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), ...o }));
  const sign = (raw: Buffer) => webhookSignature("fake_app_key", "fake_app_secret_0123456789abcdef", raw);

  it("signature invalide → 401, rien d'écrit", async () => {
    const raw = body({ type: 1, tts_notification_id: "n1", shop_id: "7494", data: { order_id: "576" } });
    expect((await handleTiktokWebhook({ rawBody: raw, authorization: "0".repeat(64) })).status).toBe(401);
    expect((await handleTiktokWebhook({ rawBody: raw, authorization: null })).status).toBe(401);
    expect(t().providerEvent ?? []).toHaveLength(0);
  });

  it("commande : job d'import pour la BONNE boutique ; rejeu idempotent", async () => {
    const pe = state.fake!.db.providerEvent;
    const create = pe.create;
    pe.create = async (args: any) => {
      if ((t().providerEvent ?? []).some((e: any) => e.provider === args.data.provider && e.eventId === args.data.eventId)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
      return create(args);
    };
    const raw = body({ type: 1, tts_notification_id: "n1", shop_id: "9999", data: { order_id: "576000000000000001", order_status: "AWAITING_SHIPMENT" } });
    expect(await handleTiktokWebhook({ rawBody: raw, authorization: sign(raw) })).toEqual({ status: 200, body: "ok" });
    expect(enqueue).toHaveBeenCalledWith("tiktok_shop.order", { storeId: B, orderId: "576000000000000001" }, { storeId: B }, expect.anything());
    expect(t().providerEvent[0]).toMatchObject({ provider: "tiktok_shop", eventId: "n1", signatureValid: true });
    expect(JSON.stringify(t().providerEvent[0].payload)).not.toMatch(/phone|address/);
    expect(await handleTiktokWebhook({ rawBody: raw, authorization: sign(raw) })).toEqual({ status: 200, body: "duplicate" });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("boutique TikTok inconnue : accusé sans traitement", async () => {
    const raw = body({ type: 1, tts_notification_id: "n2", shop_id: "1234", data: { order_id: "1" } });
    expect(await handleTiktokWebhook({ rawBody: raw, authorization: sign(raw) })).toEqual({ status: 200, body: "unknown shop" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("publication produit (client simulé)", () => {
  const link = { categoryId: "601226", categoryName: "Femme › Robes", attributes: [{ id: "100347", values: [{ id: "1000060" }] }], skus: {}, pushedStock: {}, status: "draft" };

  it("crée le produit : image téléversée une fois, prix converti, SKU mémorisé, état « en revue »", async () => {
    cfg(A).products = { prod_A_0001: link };
    const fetchImage = vi.fn(async () => new Uint8Array([1, 2, 3]));
    expect(await publishProduct(A, "prod_A_0001", { fetchImage })).toEqual({ ok: true });
    const l = cfg(A).products.prod_A_0001;
    expect(l).toMatchObject({ status: "PENDING", lastError: null });
    expect(l.tiktokProductId).toBeTruthy();
    expect(Object.keys(l.skus)).toEqual(["_"]);
    expect(l.pushedStock).toEqual({ _: 4 });
    const p = fakeState().products.get(l.tiktokProductId)!;
    expect(p.input.skus[0].price).toEqual({ amount: "22.87", currency: "EUR" });
    expect(cfg(A).imageUris[IMG]).toMatch(/^tos-fake\//);

    // Mise à jour : même produit TikTok, pas de nouveau téléversement.
    expect(await publishProduct(A, "prod_A_0001", { fetchImage })).toEqual({ ok: true });
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(fakeState().products.size).toBe(1);
  });

  it("attribut obligatoire manquant : erreur fonctionnelle enregistrée, rien n'est créé", async () => {
    cfg(A).products = { prod_A_0001: { ...link, attributes: [] } };
    const r = await publishProduct(A, "prod_A_0001", { fetchImage: async () => new Uint8Array([1]) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Matière/);
    expect(cfg(A).products.prod_A_0001).toMatchObject({ status: "error" });
    expect(fakeState().products.size).toBe(0);
  });

  it("stock : après une vente Axi, seul l'écart part vers TikTok", async () => {
    cfg(A).products = { prod_A_0001: link };
    await publishProduct(A, "prod_A_0001", { fetchImage: async () => new Uint8Array([1]) });
    expect(await syncStock(A)).toEqual({ products: 0, skus: 0 });
    t().product[0].stock = 1;
    expect(await syncStock(A)).toEqual({ products: 1, skus: 1 });
    const l = cfg(A).products.prod_A_0001;
    expect(fakeState().products.get(l.tiktokProductId)!.inventory.get(l.skus._)).toBe(1);
    expect(l.pushedStock._).toBe(1);
  });
});

describe("boutique en pause (abonnement)", () => {
  const link = { categoryId: "601226", categoryName: "Femme › Robes", attributes: [{ id: "100347", values: [{ id: "1000060" }] }], skus: {}, pushedStock: {}, status: "draft" };

  it("pause : toutes les annonces à 0 ; reprise : le stock réel est renvoyé", async () => {
    cfg(A).products = { prod_A_0001: link };
    await publishProduct(A, "prod_A_0001", { fetchImage: async () => new Uint8Array([1]) });
    const l = () => cfg(A).products.prod_A_0001;
    const inv = () => fakeState().products.get(l().tiktokProductId)!.inventory.get(l().skus._);
    expect(await syncStock(A, undefined, { zero: true })).toEqual({ products: 1, skus: 1 });
    expect(inv()).toBe(0);
    expect(l().pushedStock._).toBe(0);
    expect(await syncStock(A, undefined, { zero: true })).toEqual({ products: 0, skus: 0 }); // idempotent
    expect(await syncStock(A)).toEqual({ products: 1, skus: 1 });
    expect(inv()).toBe(4);
  });

  it("reprise : la relève repart du dernier passage (les commandes de la période de pause sont réimportées)", async () => {
    const pausedSince = NOW - 5 * 86_400_000;
    cfg(A).orders = { lastPullAt: pausedSince, lastImportAt: null, imported: 0 }; // aucune relève pendant la pause (jobs tiktok_shop.sync écartés)
    const api = new FakeTiktokShopClient();
    api.searchOrders = vi.fn(async () => ({ orders: [], nextPageToken: null })) as any;
    await pullOrders(A, api, NOW);
    expect(api.searchOrders).toHaveBeenCalledWith(expect.objectContaining({ updateTimeGe: pausedSince - 10 * 60_000 }));
    expect(cfg(A).orders.lastPullAt).toBe(NOW);
  });
});

describe("expéditions", () => {
  function seedOrder(fulfilledBy: "seller" | "tiktok" = "seller") {
    t().order = [{ id: "ord_A_0001", storeId: A, idempotencyKey: "tiktok_shop:576", attribution: { source: "tiktok_shop", tiktok: { orderId: "576", fulfilledBy, deliveryOptionId: "DO1", lineItems: { item_1: ["li1", "li2"] } } } }];
    t().shipment = [{ id: "shp_1", storeId: A, orderId: "ord_A_0001", carrier: "Colissimo", trackingNumber: "6A123", status: "PENDING", createdAt: new Date(), items: [{ orderItemId: "item_1", quantity: 2 }] }];
    t().orderEvent = [];
    injectFakeOrder({ id: "576", status: "AWAITING_SHIPMENT", createTime: 0, updateTime: 0, fulfillmentType: "FULFILLMENT_BY_SELLER", shippingType: "SELLER", deliveryOptionId: "DO1", buyerMessage: null, payment: { currency: "EUR", subTotal: "1", shippingFee: "0", sellerDiscount: "0", platformDiscount: "0", tax: "0", totalAmount: "1" }, recipient: { name: "", phone: "", fullAddress: "", regionCode: null }, lineItems: [] });
  }

  it("transmet transporteur et numéro de suivi une seule fois", async () => {
    seedOrder();
    expect(await pushShipments(A)).toEqual({ sent: 1, failed: 0 });
    expect(fakeState().shipped).toEqual([{ orderId: "576", lineItemIds: ["li1", "li2"], trackingNumber: "6A123", shippingProviderId: "6617675021119438849" }]);
    expect(t().orderEvent[0]).toMatchObject({ type: "tiktok_shop_shipped", toValue: "shp_1" });
    expect(await pushShipments(A)).toEqual({ sent: 0, failed: 0 });
    expect(fakeState().shipped).toHaveLength(1);
  });

  it("transporteur inconnu de TikTok : échec tracé, rien d'envoyé", async () => {
    seedOrder();
    t().shipment[0].carrier = "Gozem";
    expect(await pushShipments(A)).toEqual({ sent: 0, failed: 1 });
    expect(fakeState().shipped).toHaveLength(0);
    expect(t().orderEvent[0].message).toMatch(/Gozem/);
  });

  it("commande expédiée par TikTok ou d'une autre boutique : ignorée", async () => {
    seedOrder("tiktok");
    expect(await pushShipments(A)).toEqual({ sent: 0, failed: 0 });
    seedOrder();
    expect(await pushShipments(B)).toEqual({ sent: 0, failed: 0 });
    expect(fakeState().shipped).toHaveLength(0);
  });
});

describe("durcissement (audit sécurité)", () => {
  const body = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o));
  const sign = (raw: Buffer) => webhookSignature("fake_app_key", "fake_app_secret_0123456789abcdef", raw);
  const raws = () => (state.fake!.calls as any[]).filter((c) => c.model === "$raw").map((c) => c.args.values.join(""));

  it("F1 webhook : signature valide mais horodatage hors fenêtre de 15 min (ou absent) → 400, rien d'écrit", async () => {
    const old = body({ type: 1, tts_notification_id: "n9", shop_id: "9999", timestamp: Math.floor(NOW / 1000) - 16 * 60, data: { order_id: "5" } });
    expect((await handleTiktokWebhook({ rawBody: old, authorization: sign(old), now: NOW })).status).toBe(400);
    const none = body({ type: 1, tts_notification_id: "n10", shop_id: "9999", data: { order_id: "5" } });
    expect((await handleTiktokWebhook({ rawBody: none, authorization: sign(none), now: NOW })).status).toBe(400);
    const ok = body({ type: 1, tts_notification_id: "n11", shop_id: "9999", timestamp: Math.floor(NOW / 1000) - 60, data: { order_id: "5" } });
    expect((await handleTiktokWebhook({ rawBody: ok, authorization: sign(ok), now: NOW })).status).toBe(200);
    expect(t().providerEvent).toHaveLength(1);
  });

  it("F2 corps lu en flux et coupé à la limite, même sans content-length (chunked)", async () => {
    const stream = (n: number) => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(1024)); c.close(); } });
    const big = new Request("https://x.test/", { method: "POST", body: stream(10), duplex: "half" } as any);
    expect(big.headers.get("content-length")).toBeNull();
    expect(await readBodyLimited(big, 4096)).toBeNull();
    const small = new Request("https://x.test/", { method: "POST", body: stream(2), duplex: "half" } as any);
    expect((await readBodyLimited(small, 4096))!.length).toBe(2048);
  });

  it("M2 readConfig : clés de prototype ignorées, objet sans prototype, linkOf ne lit que les propriétés propres", () => {
    const c = readConfig(JSON.parse('{"products":{"__proto__":{"categoryId":"1","categoryName":"x"},"constructor":{"categoryId":"1","categoryName":"x"}}}'));
    expect(Object.getPrototypeOf(c.products)).toBeNull();
    expect(Object.keys(c.products)).toEqual([]);
    expect(linkOf(c, "toString")).toBeUndefined();
    expect(linkOf({ products: {} as any }, "constructor")).toBeUndefined();
    expect(({} as any).categoryId).toBeUndefined();
  });

  it("M1 activateShop : unicité vérifiée sous verrou consultatif par shop TikTok", async () => {
    t().integration.find((i: any) => i.storeId === A).config.shop = null;
    const r = await activateShop(A, { id: "9999", name: "S", region: "FR", cipher: "c" }, "u1", new FakeTiktokShopClient());
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/déjà reliée/) });
    const r2 = await activateShop(A, { id: "5555", name: "S", region: "FR", cipher: "c" }, "u1", new FakeTiktokShopClient());
    expect(r2).toEqual({ ok: true });
    expect(raws()).toContain("tts:5555");
    expect(cfg(A).shop.id).toBe("5555");
  });

  it("F3 rafraîchissement sous verrou ; le perdant relit le jeton écrit par le gagnant sans rappeler TikTok", async () => {
    const auth: TiktokShopAuth = { exchangeCode: vi.fn(), refresh: vi.fn(async (rt: string) => fakeTokens(rt, NOW)) };
    const row = t().integration.find((i: any) => i.storeId === A);
    // Simule un gagnant qui écrit pendant que le perdant attend le verrou.
    const tx = state.fake!.db.$transaction;
    state.fake!.db.$transaction = async (fn: any) => {
      row.secretsEncrypted = sealTokens({ accessToken: "winner_at", refreshToken: "winner_rt" });
      row.config.tokens.accessExpiresAt = NOW + 86_400_000;
      return tx(fn);
    };
    expect(await refreshTokens(A, auth, NOW)).toBe("winner_at");
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(raws()).toContain(`tts:refresh:${A}`);
  });

  it("F4 relève incomplète : lastPullAt n'avance pas et une synchro est replanifiée", async () => {
    const api = new FakeTiktokShopClient();
    api.searchOrders = vi.fn(async () => ({ orders: [], nextPageToken: "more" })) as any;
    cfg(A).orders = { lastPullAt: NOW - 3_600_000, lastImportAt: null, imported: 0 };
    await pullOrders(A, api, NOW);
    expect(cfg(A).orders.lastPullAt).toBe(NOW - 3_600_000);
    expect(enqueue).toHaveBeenCalledWith("tiktok_shop.sync", { storeId: A }, { storeId: A });
    api.searchOrders = vi.fn(async () => ({ orders: [], nextPageToken: null })) as any;
    await pullOrders(A, api, NOW);
    expect(cfg(A).orders.lastPullAt).toBe(NOW);
  });

  it("F5 image distante : connexion imposée à l'IP validée ; adresse privée refusée avant toute connexion", async () => {
    const remoteGet = vi.fn(async () => ({ status: 200, contentType: "image/png", bytes: new Uint8Array([1, 2]) }));
    const pub = async () => [{ address: "93.184.216.34", family: 4 }];
    expect(await fetchImageBytes("https://img.example.org/a.png", fetch, { lookup: pub, remoteGet })).toEqual(new Uint8Array([1, 2]));
    expect(remoteGet).toHaveBeenCalledWith(expect.objectContaining({ address: "93.184.216.34", family: 4 }), expect.any(Number));
    const priv = async () => [{ address: "169.254.169.254", family: 4 }];
    await expect(fetchImageBytes("https://img.example.org/a.png", fetch, { lookup: priv, remoteGet })).rejects.toMatchObject({ kind: "validation" });
    expect(remoteGet).toHaveBeenCalledTimes(1);
  });
});
