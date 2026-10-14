import { clientIp, rateLimitAll } from "@/lib/rate-limit";
import { publicLiveEvent } from "@/lib/live/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/{slug} — direct en cours ou à venir d'une boutique publique et ses produits épinglés
 * (lot 4 §18). Interrogé toutes les 15 secondes par la section `live-shopping`, uniquement quand elle est
 * visible. Informations déjà publiques (mêmes règles que les flux catalogues) ; jamais de donnée client.
 * Débit limité par IP ; jamais mis en cache (ni navigateur, ni CDN, ni service worker : chemin `/api`).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return json({ error: "not_found" }, 404);

  const ip = await clientIp();
  const rl = await rateLimitAll([
    { key: `live:poll:${slug}:${ip}`, limit: 120, windowSec: 600 },
    { key: `live:poll:ip:${ip}`, limit: 300, windowSec: 600 },
  ]);
  if (!rl.ok) return json({ error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter) });

  const event = await publicLiveEvent(slug);
  return json({ event, now: new Date().toISOString() }, 200);
}

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...extra } });
}
