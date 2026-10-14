import { getPublicStore } from "@/lib/storefront/data";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";
import { effectivePlanId } from "@/lib/auth/permissions";
import { blogPlan, latestPublicPosts, storeAbsBase } from "@/lib/blog/service";
import { buildRss } from "@/lib/blog/seo";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** Flux RSS 2.0 des 30 derniers articles publics (boutique publiée et blog inclus dans le plan). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return notFound();
  // m10 : même limite de débit que les flux catalogue (`serveFeed`) — ce flux lit la base à chaque appel.
  const ip = await clientIp();
  const rl = await rateLimitAll([
    { key: `feed:${slug}:ip:${ip}`, limit: 30, windowSec: 10 * 60 },
    { key: `feed:ip:${ip}`, limit: 120, windowSec: 10 * 60 },
  ]);
  if (!rl.ok) return new Response("Too Many Requests", { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(rl.retryAfter) } });
  const store = await getPublicStore(slug);
  if (!store || !blogPlan(effectivePlanId(store.subscription)).enabled) return notFound();
  const posts = await latestPublicPosts(store.id, { limit: 30 });
  const xml = buildRss({ storeName: store.name, description: store.tagline ?? store.description, absBase: storeAbsBase(store.slug), posts });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=300", "X-Content-Type-Options": "nosniff" } });
}
