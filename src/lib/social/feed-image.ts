import "server-only";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { isValidMediaKey } from "@/lib/storage/keys";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";

/**
 * Conversion JPEG des photos produits pour les catalogues Meta et TikTok :
 * GET /s/{slug}/feeds/img/stores/{storeId}/{yyyy}/{mm}/{sha256}.{webp|avif|gif}.jpg
 *
 * Pourquoi : les photos téléversées sont compressées en WebP (src/lib/storage/client.ts) ; Meta (« Images must be in
 * JPEG or PNG format ») et TikTok (« Image links should end with JPG or PNG ») les refusent. Google accepte le WebP
 * et reçoit l'URL d'origine.
 *
 * Sécurité et charge :
 *  - clé validée par l'expression stricte des médias, rattachée à la boutique du slug (jamais une autre boutique),
 *    et limitée aux photos du catalogue (pas aux espaces privés `returns/` ni `delivery/`) ;
 *  - boutique publique uniquement ; débit limité par IP ; source plafonnée à 15 Mo et 40 mégapixels ;
 *  - au plus 2 conversions simultanées (petite instance), petit cache mémoire, puis cache HTTP immuable d'un an
 *    (la clé est l'empreinte du contenu : une photo modifiée change d'URL).
 */

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const CACHE_MAX = 40;
const cache = new Map<string, Uint8Array>();
let running = 0;
const waiting: (() => void)[] = [];
/** File d'attente bornée : au-delà, 503 immédiat (le robot réessaiera) plutôt que d'accumuler la mémoire. */
export const MAX_WAITING = 20;

export class BusyError extends Error {}

/** Exécute `fn` dans l'un des 2 créneaux de conversion ; lecture de la source ET conversion y ont lieu. */
export async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) {
    if (waiting.length >= MAX_WAITING) throw new BusyError("file de conversion pleine");
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Clé de média source à partir des segments de l'URL (« ….webp.jpg »), ou null si invalide. */
export function sourceKeyFromSegments(segments: string[] | undefined, storeId: string): string | null {
  if (!segments?.length || segments.length > 8) return null;
  const joined = segments.join("/");
  if (!joined.endsWith(".jpg")) return null;
  const key = joined.slice(0, -".jpg".length);
  if (!isValidMediaKey(key) || !/\.(webp|avif|gif)$/.test(key)) return null;
  // Photos du catalogue seulement : `stores/{storeId}/{aaaa}/{mm}/…` (les espaces returns/ et delivery/ sont exclus).
  if (!key.startsWith(`stores/${storeId}/`) || !/^stores\/[a-z0-9]+\/\d{4}\//.test(key)) return null;
  return key;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Conversion : orientation EXIF appliquée, transparence aplatie sur fond blanc, 2048 px au plus, JPEG qualité 85. */
async function toJpeg(input: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(input, { limitInputPixels: 40_000_000, animated: false, failOn: "error" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(out);
}

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  "X-Robots-Tag": "noindex",
};

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function serveFeedImage(slug: string, segments: string[] | undefined, head = false): Promise<Response> {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return notFound();
  const ip = await clientIp();
  const rl = await rateLimitAll([
    { key: `feedimg:${slug}:ip:${ip}`, limit: 600, windowSec: 10 * 60 },
    { key: `feedimg:ip:${ip}`, limit: 1500, windowSec: 10 * 60 },
  ]);
  if (!rl.ok) return new Response(null, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const store = await db.store.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return notFound();
  const key = sourceKeyFromSegments(segments, store.id);
  if (!key) return notFound();

  let jpeg = cache.get(key) ?? null;
  if (!jpeg && head) {
    // HEAD : existence de la source seulement, jamais de conversion.
    const exists = await getStorage().exists(key).catch(() => false);
    if (!exists) return notFound();
    return new Response(null, { status: 200, headers: { ...HEADERS, "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (!jpeg) {
    try {
      const out = await withSlot(async () => {
        const stream = await getStorage().getStream(key);
        if (!stream) return null;
        const source = await readAll(stream.body);
        return source ? toJpeg(source) : null;
      });
      if (!out) return notFound();
      jpeg = out;
    } catch (e) {
      if (e instanceof BusyError) return new Response(null, { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } });
      console.error(`[feeds.img] conversion impossible (${key}) : ${(e as Error).message.slice(0, 200)}`);
      return new Response(null, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, jpeg);
  }
  return new Response(head ? null : new Uint8Array(jpeg), {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "image/jpeg", "Content-Length": String(jpeg.byteLength), "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
