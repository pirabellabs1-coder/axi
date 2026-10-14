import { pwaContextFor, requestHost } from "@/lib/pwa/service";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * Manifeste de la boutique installable (lot 4 §14). Servi seulement si la boutique est publique, que le plan
 * inclut la fonction `pwa` et que le commerçant a activé l'option ; sinon 404 indistinct.
 * `start_url` et `scope` dépendent de l'hôte servi (sous-domaine / domaine propre → `/`, sinon `/s/{slug}/`).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await pwaContextFor(slug, await requestHost());
  if (!ctx?.active) return notFound();
  return new Response(JSON.stringify(ctx.manifest, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
