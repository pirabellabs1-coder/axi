import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Résolution d'un domaine personnalisé → slug de boutique (appelé par src/proxy.ts, qui ne peut pas importer Prisma).
 * Seuls les domaines vérifiés et les boutiques visibles publiquement sont résolus.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // `domain` : paramètre envoyé par Caddy (on_demand_tls { ask … }), `host` : src/proxy.ts. Voir docs/DOMAINES.md.
  const host = (url.searchParams.get("host") ?? url.searchParams.get("domain") ?? "").toLowerCase().split(":")[0].trim();
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return new Response("Bad Request", { status: 400 });

  const d = await db.domain.findUnique({ where: { hostname: host }, select: { verified: true, store: { select: { slug: true, status: true } } } });
  if (!d?.verified || (d.store.status !== "PUBLISHED" && d.store.status !== "CLOSED_TEMPORARILY")) {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } });
  }
  return Response.json({ slug: d.store.slug }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
