import { NextResponse, type NextRequest } from "next/server";
import { suggest } from "@/lib/marketplace/data";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Suggestions de recherche de la marketplace : max 8 boutiques, produits, catégories ou villes. Lecture seule, données publiques. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("q") ?? "";
  const q = raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60);
  if (q.length < 2) {
    return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  try {
    const rl = await rateLimit(`suggest:ip:${await clientIp()}`, 120, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { items: [], error: "Trop de requêtes. Réessayez dans un instant." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
      );
    }
    const items = await suggest(q);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (e) {
    console.error("[marketplace/suggest]", e);
    return NextResponse.json({ items: [], error: "indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
