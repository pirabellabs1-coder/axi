import { db } from "@/lib/db";
import { getMcpKillSwitch } from "@/lib/mcp/runtime";
import { buildPlatformLlmsTxt, buildStoreLlmsTxt } from "@/lib/mcp/public/llms";

export const dynamic = "force-dynamic";

const APP_DOMAIN = (process.env.NEXT_PUBLIC_APP_DOMAIN ?? "localhost:3000").toLowerCase();
const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=300" };

/**
 * /llms.txt : description de la plateforme, ou de la boutique quand la requête arrive sur son sous-domaine
 * ({slug}.domaine) ou sur son domaine personnalisé vérifié (le proxy ne réécrit pas les fichiers .txt).
 */
export async function GET(req: Request) {
  if ((await getMcpKillSwitch()).enabled) return new Response("Service temporarily unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" } });
  const host = (req.headers.get("host") ?? "").toLowerCase();
  let slug: string | null = null;
  if (host !== APP_DOMAIN && host.endsWith(`.${APP_DOMAIN}`)) {
    slug = host.slice(0, -(APP_DOMAIN.length + 1));
  } else if (host && host !== APP_DOMAIN && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    const hostname = host.split(":")[0];
    if (/^[a-z0-9.-]{1,253}$/.test(hostname)) {
      const d = await db.domain.findUnique({ where: { hostname }, select: { verified: true, store: { select: { slug: true } } } });
      if (d?.verified) slug = d.store.slug;
    }
  }
  if (slug && slug !== "www") {
    const body = await buildStoreLlmsTxt(slug);
    if (!body) return new Response("Not Found", { status: 404, headers: TEXT });
    return new Response(body, { headers: TEXT });
  }
  return new Response(buildPlatformLlmsTxt(), { headers: TEXT });
}
