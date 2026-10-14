import { createHash } from "node:crypto";
import { shareableImageUrl } from "@/lib/storage/public-url";
import { serviceWorkerSource } from "@/lib/pwa/sw-source";
import { pwaContextFor, requestHost } from "@/lib/pwa/service";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * Service worker de la boutique (lot 4 §14). Sur un sous-domaine ou un domaine propre, le proxy réécrit
 * `/sw.js` vers cette route : la portée est alors `/`. Sur le domaine de l'application, la portée est
 * `/s/{slug}/` (le script y est servi, aucun en-tête d'élargissement n'est nécessaire) ;
 * `Service-Worker-Allowed` est tout de même renvoyé, aligné sur la portée réelle.
 *
 * La version du script est dérivée des réglages : changer d'icône ou de nom provoque une mise à jour du
 * service worker (nouveaux noms de caches) sans jamais purger les caches des autres boutiques.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await pwaContextFor(slug, await requestHost());
  if (!ctx?.active) return notFound();
  const version = createHash("sha256").update(`${slug}|${ctx.scope}|${JSON.stringify(ctx.config)}|v1`).digest("hex").slice(0, 12);
  const source = serviceWorkerSource({
    scope: ctx.scope,
    version,
    offlineUrl: `${ctx.scope}hors-ligne`,
    notificationIcon: ctx.config.icon192 ?? shareableImageUrl(ctx.store.logoUrl) ?? null,
    storeName: ctx.store.name,
  });
  return new Response(source, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Service-Worker-Allowed": ctx.scope,
      // Le navigateur revalide le script à chaque mise à jour ; pas de cache long (sinon un correctif ne part jamais).
      "Cache-Control": "no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
