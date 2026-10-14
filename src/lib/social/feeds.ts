import "server-only";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";
import { buildCatalogItems, readSettings } from "./feed-items";
import { FEED_CONTENT_TYPE, renderFeed, type FeedFormat } from "./feed-format";
import { loadCatalogSource } from "./catalog-data";
import { appBaseUrl } from "./sync";

/**
 * Flux catalogues publics `/s/{slug}/feeds/{meta.xml|google.xml|tiktok.csv}`.
 *  - servis seulement si la boutique est publique, que le plan inclut `catalogFeeds` et que le commerçant a activé
 *    le flux (SocialCatalogSync du canal, enabled) ; sinon 404 indistinct ;
 *  - limités par IP (robots de Meta, Google, TikTok : quelques passages par jour) ;
 *  - cache 1 h : en-têtes HTTP (CDN, robots) et mémoire du processus (clé = boutique, format, réglages, statut).
 */

const CACHE_TTL_MS = 3600_000;
const CACHE_MAX = 200;
const cache = new Map<string, { body: string; at: number }>();

function cacheGet(key: string, now: number): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.body;
}

function cacheSet(key: string, body: string, now: number) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { body, at: now });
}

/** Vide le cache mémoire d'une boutique (activation / réglages modifiés). */
export function invalidateFeedCache(storeId: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${storeId}:`)) cache.delete(k);
}

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function serveFeed(slug: string, format: FeedFormat): Promise<Response> {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return notFound();

  const ip = await clientIp();
  const rl = await rateLimitAll([
    { key: `feed:${slug}:ip:${ip}`, limit: 30, windowSec: 10 * 60 },
    { key: `feed:ip:${ip}`, limit: 120, windowSec: 10 * 60 },
  ]);
  if (!rl.ok) {
    return new Response("Too Many Requests", { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(rl.retryAfter) } });
  }

  const store = await db.store.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, description: true, tagline: true, currency: true, status: true, subscription: true },
  });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return notFound();
  if (!PLANS[effectivePlanId(store.subscription)].features.catalogFeeds) return notFound();
  const row = await db.socialCatalogSync.findUnique({ where: { storeId_channel: { storeId: store.id, channel: format } }, select: { enabled: true, settings: true, updatedAt: true } });
  if (!row?.enabled) return notFound();

  const now = Date.now();
  const key = `${store.id}:${format}:${row.updatedAt.getTime()}:${store.status}`;
  let body = cacheGet(key, now);
  if (body == null) {
    const base = appBaseUrl();
    const source = await loadCatalogSource(store.id);
    const { items } = buildCatalogItems({ store, products: source.products, categories: source.categories, settings: readSettings(row.settings), baseUrl: base, now: new Date(now) });
    body = renderFeed(format, { title: store.name, link: `${base}/s/${store.slug}`, description: store.tagline || store.description || store.name }, items);
    cacheSet(key, body, now);
  }
  return new Response(body, {
    headers: {
      "Content-Type": FEED_CONTENT_TYPE[format],
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
