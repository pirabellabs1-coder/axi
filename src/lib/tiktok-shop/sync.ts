import "server-only";
import { lookup } from "node:dns/promises";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { notifyStore } from "@/lib/notifications/service";
import { resolveWebhookTarget, type LookupFn } from "@/lib/webhooks/ssrf";
import { isStoredMediaUrl, absoluteUrl } from "@/lib/storage/public-url";
import { apiFor, readConfig, updateConfig } from "./connection";
import { TIKTOK_SHOP_KIND } from "./config";
import { platformRate } from "./fx";
import { marketFor } from "./markets";
import { buildProductInput, mapReturnedSkus, missingRequiredAttributes, productImageUrls, sellableQuantity, sellerSkus, SIMPLE_KEY, variantImageUrl, type AxiProductForSync } from "./mapping";
import { linkOf, type ProductLink, type TtsConfig } from "./model";
import { importTiktokOrder, isTiktokAttribution, type ImportOutcome } from "./orders";
import { matchShippingProvider } from "./order-plan";
import { TiktokShopError, type TiktokShopApi } from "./types";

/**
 * Synchronisations TikTok Shop exécutées par les jobs (src/lib/tiktok-shop/jobs.ts) :
 *  - publication d'un produit (création / mise à jour, images, prix convertis, stock) ;
 *  - stock : envoi des SEULS écarts entre le stock Axi et la dernière quantité envoyée (tout mouvement Axi —
 *    vente, caisse, ajustement, retour — est ainsi répercuté au passage suivant, quelle que soit son origine) ;
 *  - état de revue des produits ; relève des commandes ; envoi des expéditions (transporteur + numéro de suivi).
 * Chaque opération est filtrée par `storeId` et idempotente (rejouable sans effet de bord).
 */

const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  kind: true,
  isGiftCard: true,
  price: true,
  sku: true,
  trackStock: true,
  stock: true,
  weightGrams: true,
  images: true,
  variants: { select: { id: true, name: true, attributes: true, price: true, sku: true, weightGrams: true, imageUrl: true, available: true, stock: true }, orderBy: { position: "asc" as const } },
} as const;

export async function loadProductForSync(storeId: string, productId: string): Promise<AxiProductForSync | null> {
  return (await db.product.findFirst({ where: { id: productId, storeId }, select: PRODUCT_SELECT })) as AxiProductForSync | null;
}

function marketOf(config: TtsConfig) {
  const m = marketFor(config.shop?.region);
  if (!m) throw new TiktokShopError(`Marché TikTok non pris en charge : ${config.shop?.region ?? "inconnu"}`, "config");
  return m;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageTarget = { url: URL; address: string; family: 4 | 6 };
export type RemoteImageGet = (target: ImageTarget, maxBytes: number) => Promise<{ status: number; contentType: string; bytes: Uint8Array }>;

/**
 * GET https vers l'adresse IP DÉJÀ validée (option `lookup` figée) : un second tour DNS (DNS rebinding) n'est jamais
 * utilisé. SNI et certificat vérifiés sur le nom d'hôte d'origine, pas de redirection, corps coupé à `maxBytes`.
 */
export const pinnedImageGet: RemoteImageGet = (target, maxBytes) =>
  new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_h, options, cb) => {
      if (typeof options === "object" && options !== null && (options as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: target.address, family: target.family }]);
      else cb(null, target.address, target.family);
    };
    const req = https.request(target.url, { method: "GET", lookup: pinned, agent: false, headers: { "User-Agent": "Axi-TikTokShop/2026-10", Connection: "close" }, timeout: 15_000 }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new TiktokShopError("Image trop lourde (5 Mo maximum)", "validation"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, contentType: String(res.headers["content-type"] ?? ""), bytes: new Uint8Array(Buffer.concat(chunks)) }));
      res.on("error", (e) => reject(new TiktokShopError(`Image inaccessible (${e.message})`, "network", null, true)));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => reject(e instanceof TiktokShopError ? e : new TiktokShopError(`Image inaccessible (${e.message})`, "network", null, true)));
    req.end();
  });

const systemLookup: LookupFn = async (h) => (await lookup(h, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family }));

function checkImage(status: number, contentType: string, bytes: Uint8Array): Uint8Array {
  if (status < 200 || status >= 300) throw new TiktokShopError(`Image inaccessible (${status})`, "network", null, status >= 500 || status === 429);
  if (!/^image\/(jpeg|png|webp)/i.test(contentType)) throw new TiktokShopError("Format d'image non accepté par TikTok (JPEG, PNG ou WebP)", "validation");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new TiktokShopError("Image trop lourde (5 Mo maximum)", "validation");
  return bytes;
}

/**
 * Télécharge une image produit : média Axi (fetch direct), ou URL https publique : contrôle anti-SSRF puis connexion
 * imposée à l'adresse validée (robuste au DNS rebinding), sans redirection.
 */
export async function fetchImageBytes(
  url: string,
  fetchImpl: typeof fetch = fetch,
  deps: { lookup?: LookupFn; remoteGet?: RemoteImageGet } = {},
): Promise<Uint8Array> {
  const own = isStoredMediaUrl(url) || url.startsWith(`${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/media/`);
  if (!own) {
    const target = await resolveWebhookTarget(url, deps.lookup ?? systemLookup);
    if (!target.ok) throw new TiktokShopError(`Image refusée (${target.reason})`, "validation");
    const r = await (deps.remoteGet ?? pinnedImageGet)({ url: target.url, address: target.address, family: target.family }, MAX_IMAGE_BYTES);
    return checkImage(r.status, r.contentType, r.bytes);
  }
  const res = await fetchImpl(absoluteUrl(url) ?? url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  return checkImage(res.status, res.headers.get("content-type") ?? "", new Uint8Array(await res.arrayBuffer()));
}

async function setLink(storeId: string, productId: string, patch: Partial<ProductLink>) {
  await updateConfig(storeId, (c) => {
    const prev = linkOf(c, productId);
    if (prev) c.products[productId] = { ...prev, ...patch };
    return c;
  });
}

/** Publie (crée ou met à jour) un produit sur TikTok Shop. Erreur non retentable : enregistrée sur le lien, pas relancée. */
export async function publishProduct(storeId: string, productId: string, deps: { api?: TiktokShopApi; fetchImage?: (url: string) => Promise<Uint8Array> } = {}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await apiFor(storeId);
  const api = deps.api ?? ctx.api;
  let config = ctx.config;
  const link = linkOf(config, productId);
  if (!link) return { ok: false, error: "Choisissez d'abord une catégorie TikTok pour ce produit." };
  try {
    const product = await loadProductForSync(storeId, productId);
    if (!product) throw new TiktokShopError("Produit introuvable", "not_found");
    const warehouseId = config.warehouseId;
    if (!warehouseId) throw new TiktokShopError("Aucun entrepôt TikTok : vérifiez votre boutique TikTok Shop", "config");
    const store = await db.store.findUnique({ where: { id: storeId }, select: { currency: true } });
    if (!store) throw new TiktokShopError("Boutique introuvable", "not_found");
    const market = marketOf(config);

    const missing = missingRequiredAttributes(await api.getCategoryAttributes(link.categoryId), link);
    if (missing.length) throw new TiktokShopError(`Attributs obligatoires à renseigner : ${missing.map((a) => a.name).join(", ")}`, "validation");

    // Images : téléversement unique par URL (mémorisé), en série pour respecter les quotas.
    const urls = [...productImageUrls(product), ...product.variants.map(variantImageUrl).filter((u): u is string => !!u)];
    const fresh: Record<string, string> = {};
    for (const url of [...new Set(urls)]) {
      if (config.imageUris[url]) continue;
      const bytes = await (deps.fetchImage ?? fetchImageBytes)(url);
      fresh[url] = (await api.uploadImage(bytes, url.split("/").pop()?.slice(0, 80) || "image.jpg")).uri;
    }
    if (Object.keys(fresh).length) config = await updateConfig(storeId, (c) => ({ ...c, imageUris: { ...c.imageUris, ...fresh } }));

    const { rate } = await platformRate(store.currency, market.currency);
    const built = buildProductInput({ product, link, storeCurrency: store.currency, market, rate, settings: config.settings, warehouseId, imageUris: config.imageUris });
    if (!built.ok) throw new TiktokShopError(built.errors.join(" "), "validation");

    // Idempotence de création : un produit déjà créé (réponse perdue) est retrouvé par ses seller_sku.
    let tiktokProductId = link.tiktokProductId;
    if (!tiktokProductId) tiktokProductId = await api.findProductIdBySellerSkus(Object.values(sellerSkus(product)));
    const result = tiktokProductId ? await api.updateProduct(tiktokProductId, built.input) : await api.createProduct(built.input);
    const skus = mapReturnedSkus(product, built.skuKeys, result.skus);
    await setLink(storeId, productId, { tiktokProductId: result.productId, skus, pushedStock: built.quantities, status: "PENDING", reviewReasons: [], lastError: null, lastSyncedAt: Date.now() });
    return { ok: true };
  } catch (e) {
    const err = e instanceof TiktokShopError ? e : new TiktokShopError((e as Error).message, "server", null, true);
    // Erreur passagère : « Envoi en cours » (le job retente) ; erreur fonctionnelle : « Erreur » avec le motif.
    await setLink(storeId, productId, { status: err.retryable ? "publishing" : "error", lastError: err.message.slice(0, 300) }).catch(() => {});
    if (err.retryable) throw err;
    return { ok: false, error: err.message };
  }
}

/** Écarts de stock à envoyer (pur) : uniquement les SKU dont la quantité vendable a changé depuis le dernier envoi. */
export function stockDiff(product: AxiProductForSync | null, link: ProductLink, settings: TtsConfig["settings"]): { key: string; skuId: string; quantity: number }[] {
  const out: { key: string; skuId: string; quantity: number }[] = [];
  for (const [key, skuId] of Object.entries(link.skus)) {
    let q = 0;
    if (product) {
      const v = key === SIMPLE_KEY ? null : (product.variants.find((x) => x.id === key) ?? undefined);
      q = v === undefined ? 0 : sellableQuantity(product, v, settings); // variante supprimée : 0
    }
    if (link.pushedStock[key] !== q) out.push({ key, skuId, quantity: q });
  }
  return out;
}

/** Envoie les écarts de stock de tous les produits publiés de la boutique. */
export async function syncStock(storeId: string, api?: TiktokShopApi): Promise<{ products: number; skus: number }> {
  const ctx = await apiFor(storeId);
  const client = api ?? ctx.api;
  const config = ctx.config;
  if (!config.warehouseId) return { products: 0, skus: 0 };
  const links = Object.entries(config.products).filter(([, l]) => l.tiktokProductId && Object.keys(l.skus).length);
  if (!links.length) return { products: 0, skus: 0 };
  const products = (await db.product.findMany({ where: { storeId, id: { in: links.map(([id]) => id) } }, select: PRODUCT_SELECT })) as AxiProductForSync[];
  let nP = 0;
  let nS = 0;
  const pushed: Record<string, Record<string, number>> = {};
  for (const [productId, link] of links) {
    const diff = stockDiff(products.find((p) => p.id === productId) ?? null, link, config.settings);
    if (!diff.length) continue;
    await client.updateInventory(link.tiktokProductId!, diff.map((d) => ({ id: d.skuId, warehouseId: config.warehouseId!, quantity: d.quantity })));
    pushed[productId] = Object.fromEntries(diff.map((d) => [d.key, d.quantity]));
    nP++;
    nS += diff.length;
  }
  if (nP) {
    await updateConfig(storeId, (c) => {
      for (const [productId, q] of Object.entries(pushed)) {
        const l = linkOf(c, productId);
        if (l) l.pushedStock = { ...l.pushedStock, ...q };
      }
      return c;
    });
  }
  return { products: nP, skus: nS };
}

/** Rafraîchit l'état de revue des produits en attente (borné par passage). */
export async function refreshReviewStatuses(storeId: string, api?: TiktokShopApi, limit = 20): Promise<number> {
  const ctx = await apiFor(storeId);
  const client = api ?? ctx.api;
  const pending = Object.entries(ctx.config.products).filter(([, l]) => l.tiktokProductId && (l.status === "PENDING" || l.status === "publishing")).slice(0, limit);
  const updates: Record<string, { status: string; reviewReasons: string[] }> = {};
  for (const [productId, link] of pending) {
    const s = await client.getProductStatus(link.tiktokProductId!);
    if (s.status !== link.status) updates[productId] = { status: s.status, reviewReasons: s.auditFailedReasons };
  }
  if (Object.keys(updates).length) {
    await updateConfig(storeId, (c) => {
      for (const [id, u] of Object.entries(updates)) {
        const l = linkOf(c, id);
        if (l) c.products[id] = { ...l, ...u };
      }
      return c;
    });
    const failed = Object.entries(updates).filter(([, u]) => u.status === "FAILED");
    if (failed.length) {
      await notifyStore(storeId, {
        kind: "other",
        key: `tts-review:${failed.map(([id]) => id).join(",")}`.slice(0, 180),
        title: "Produit refusé par TikTok Shop",
        text: `${failed.length} produit(s) refusé(s) à la revue TikTok. Consultez le motif et corrigez la fiche.`,
        href: `/app/${storeId}/integrations/tiktok-shop`,
      });
    }
  }
  return Object.keys(updates).length;
}

/** Applique un statut de produit reçu par webhook (lien retrouvé par id produit TikTok, dans CETTE boutique). */
export async function applyProductStatus(storeId: string, tiktokProductId: string, status: string, reasons: string[] = []) {
  await updateConfig(storeId, (c) => {
    for (const l of Object.values(c.products)) if (l.tiktokProductId === tiktokProductId) Object.assign(l, { status, reviewReasons: reasons.slice(0, 10) });
    return c;
  });
}

const OVERLAP_MS = 10 * 60_000;
const FIRST_PULL_MS = 3 * 86_400_000;

/** Relève des commandes modifiées depuis le dernier passage (chevauchement de 10 min ; l'import est idempotent). */
export async function pullOrders(storeId: string, api?: TiktokShopApi, now = Date.now()): Promise<Record<ImportOutcome, number>> {
  const ctx = await apiFor(storeId);
  const client = api ?? ctx.api;
  const since = ctx.config.orders.lastPullAt ? ctx.config.orders.lastPullAt - OVERLAP_MS : now - FIRST_PULL_MS;
  const counts: Record<ImportOutcome, number> = { imported: 0, duplicate: 0, skipped: 0, cancelled: 0, unchanged: 0 };
  let pageToken: string | null = null;
  for (let page = 0; page < 20; page++) {
    const r = await client.searchOrders({ updateTimeGe: since, pageToken });
    for (const o of r.orders) counts[await importTiktokOrder(storeId, o, ctx.config)]++;
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  // Relève incomplète (plus de 20 pages) : `lastPullAt` n'avance PAS (sinon les pages restantes seraient perdues),
  // une nouvelle synchro est replanifiée ; l'import étant idempotent, les pages déjà lues ne coûtent qu'un contrôle.
  const complete = pageToken === null;
  await updateConfig(storeId, (c) => ({ ...c, orders: { ...c.orders, lastPullAt: complete ? now : c.orders.lastPullAt, lastImportAt: counts.imported ? now : c.orders.lastImportAt, imported: c.orders.imported + counts.imported } }));
  if (!complete || counts.imported) await requestStockSync(storeId);
  return counts;
}

/** Import d'une commande précise (webhook). */
export async function importOrderById(storeId: string, tiktokOrderId: string, api?: TiktokShopApi): Promise<ImportOutcome> {
  const ctx = await apiFor(storeId);
  const [order] = await (api ?? ctx.api).getOrders([tiktokOrderId]);
  if (!order) return "skipped";
  const outcome = await importTiktokOrder(storeId, order, ctx.config);
  if (outcome === "imported") {
    await updateConfig(storeId, (c) => ({ ...c, orders: { ...c.orders, lastImportAt: Date.now(), imported: c.orders.imported + 1 } }));
    await requestStockSync(storeId);
  }
  return outcome;
}

/** Met en file une synchronisation de boutique si aucune n'est déjà en attente (anti-rafale). */
export async function requestStockSync(storeId: string) {
  const pending = await db.job.findFirst({ where: { type: "tiktok_shop.sync", storeId, status: "PENDING" }, select: { id: true } });
  if (!pending) await enqueue("tiktok_shop.sync", { storeId }, { storeId });
}

export const SHIPPED_EVENT = "tiktok_shop_shipped";

/**
 * Envoie à TikTok les expéditions saisies dans Axi (transporteur + numéro de suivi) pour les commandes TikTok
 * expédiées par le vendeur. Marqueur d'idempotence : OrderEvent(type = "tiktok_shop_shipped", toValue = id expédition).
 */
export async function pushShipments(storeId: string, api?: TiktokShopApi, limit = 20): Promise<{ sent: number; failed: number }> {
  const ctx = await apiFor(storeId);
  const client = api ?? ctx.api;
  const shipments = await db.shipment.findMany({
    where: { storeId, trackingNumber: { not: null }, status: { notIn: ["CANCELLED", "RETURNED"] }, order: { storeId, idempotencyKey: { startsWith: "tiktok_shop:" } } },
    select: { id: true, carrier: true, trackingNumber: true, orderId: true, items: { select: { orderItemId: true, quantity: true } }, order: { select: { id: true, attribution: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  let sent = 0;
  let failed = 0;
  const providersCache = new Map<string, { id: string; name: string }[]>();
  for (const s of shipments) {
    if (sent + failed >= limit) break;
    const attribution = s.order.attribution;
    if (!isTiktokAttribution(attribution) || attribution.tiktok.fulfilledBy !== "seller") continue;
    const done = await db.orderEvent.findFirst({ where: { orderId: s.orderId, type: SHIPPED_EVENT, toValue: s.id }, select: { id: true } });
    if (done) continue;
    const note = async (message: string, type = "note", toValue: string | null = null) => db.orderEvent.create({ data: { orderId: s.orderId, actorLabel: "TikTok Shop", type, toValue, message: message.slice(0, 500) } });
    try {
      const [order] = await client.getOrders([attribution.tiktok.orderId]);
      if (!order) throw new TiktokShopError("Commande TikTok introuvable", "not_found");
      // Déjà expédiée côté TikTok (saisie dans Seller Center) : on marque sans renvoyer.
      if (!["AWAITING_SHIPMENT", "PARTIALLY_SHIPPING"].includes(order.status)) {
        await note(`Expédition non transmise : la commande est « ${order.status} » dans TikTok.`, SHIPPED_EVENT, s.id);
        continue;
      }
      const optionId = order.deliveryOptionId ?? attribution.tiktok.deliveryOptionId;
      if (!optionId) throw new TiktokShopError("Option de livraison TikTok inconnue", "validation");
      if (!providersCache.has(optionId)) providersCache.set(optionId, await client.getShippingProviders(optionId));
      const provider = matchShippingProvider(s.carrier, providersCache.get(optionId)!);
      if (!provider) throw new TiktokShopError(`Transporteur « ${s.carrier} » non proposé par TikTok pour cette commande (${providersCache.get(optionId)!.map((p) => p.name).slice(0, 8).join(", ")})`, "validation");
      // Lignes TikTok (une par unité) correspondant aux articles de l'expédition.
      const lineItemIds = s.items.flatMap((it) => (attribution.tiktok.lineItems[it.orderItemId] ?? []).slice(0, it.quantity));
      const ids = lineItemIds.length ? lineItemIds : Object.values(attribution.tiktok.lineItems).flat();
      await client.markShipped({ orderId: order.id, lineItemIds: ids, trackingNumber: s.trackingNumber!, shippingProviderId: provider.id });
      await note(`Expédition transmise à TikTok : ${provider.name}, suivi ${s.trackingNumber}.`, SHIPPED_EVENT, s.id);
      sent++;
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      // Erreur durable : tracée une fois par message (pas de bruit à chaque passage), retentée au passage suivant.
      const seen = await db.orderEvent.findFirst({ where: { orderId: s.orderId, type: "note", actorLabel: "TikTok Shop", message: { startsWith: "Envoi de l'expédition à TikTok impossible" } }, select: { id: true } });
      if (!seen) await note(`Envoi de l'expédition à TikTok impossible : ${msg}`);
      if (e instanceof TiktokShopError && e.kind === "auth") throw e;
    }
  }
  return { sent, failed };
}

/** Synchronisation complète d'une boutique (job périodique). Chaque étape isolée : l'échec de l'une n'empêche pas les autres. */
export async function syncStore(storeId: string): Promise<void> {
  const current = await db.integration.findUnique({ where: { storeId_kind: { storeId, kind: TIKTOK_SHOP_KIND } }, select: { status: true, config: true } });
  if (!current || current.status !== "active" || !readConfig(current.config).settings.enabled || !readConfig(current.config).shop) return;
  const errors: string[] = [];
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${label} : ${(e as Error).message}`);
      if (e instanceof TiktokShopError && e.kind === "auth") throw e;
    }
  };
  await step("commandes", () => pullOrders(storeId));
  await step("stock", () => syncStock(storeId));
  await step("expéditions", () => pushShipments(storeId));
  await step("revue", () => refreshReviewStatuses(storeId));
  await db.integration.updateMany({ where: { storeId, kind: TIKTOK_SHOP_KIND, status: "active" }, data: { lastError: errors.length ? errors.join(" | ").slice(0, 500) : null } });
}
