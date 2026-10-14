import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/auth/permissions";
import { storeLocales } from "@/i18n/locales";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Langues servies par une boutique (lot 2 §1.1), consommée UNIQUEMENT par `src/proxy.ts` : le proxy tourne
 * dans le runtime Edge et n'importe pas Prisma, comme pour `/api/domains/resolve`.
 *
 * Information publique (les langues sont visibles dans le hreflang de la vitrine) ; rien d'autre n'est exposé.
 * Le quota du plan est appliqué ici : après une baisse de plan, les langues en trop ne sont plus servies et
 * leurs URL redirigent en 302 (les traductions restent en base).
 *
 * Limitation de débit (correctif mineur n° 15) : la route était totalement ouverte et faisait une
 * requête base par appel. Elle est désormais bornée par (IP, slug). L'appel INTERNE du proxy est
 * mémorisé 60 s par slug (`next: { revalidate: 60 }`) et part du serveur lui-même (aucun
 * `x-forwarded-for`, donc une clé distincte par slug) : il ne touche jamais le plafond, alors qu'un
 * martèlement depuis une adresse est coupé.
 */
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{3,48}$/;
/** Appels tolérés par adresse et par boutique, par minute. */
const RATE_LIMIT = 30;

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug")?.toLowerCase() ?? "";
  if (!SLUG_RE.test(slug)) return json({ error: "slug" }, 400, 0);
  const rl = await rateLimit(`locales:${await clientIp()}:${slug}`, RATE_LIMIT, 60);
  if (!rl.ok) return json({ error: "rate_limited" }, 429, 0);
  const store = await db.store.findUnique({
    where: { slug },
    select: { locale: true, enabledLocales: true, status: true, subscription: true },
  });
  if (!store) return json({ primary: null, secondary: [] }, 404, 60);
  const locales = storeLocales(store, PLANS[effectivePlanId(store.subscription)].limits.languages);
  return json({ primary: locales.primary, secondary: locales.secondary }, 200, 60);
}

function json(body: unknown, status: number, maxAge: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": maxAge ? `public, max-age=${maxAge}, s-maxage=${maxAge}` : "no-store" },
  });
}
