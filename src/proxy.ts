import { NextResponse, type NextRequest } from "next/server";
import { foreignStorePath } from "@/lib/buyer/host";
import { LOCALE_HEADER, LOCALE_PATH_HEADER, isPlatformLocale, splitLocalePath } from "@/i18n/locales";

const APP_DOMAIN = (process.env.NEXT_PUBLIC_APP_DOMAIN ?? "localhost:3000").toLowerCase();
const SESSION_COOKIE = "axi_session";

/**
 * 1. Segment de langue des boutiques (lot 2 §1.1) : `/en/p/robe` (hôte de boutique) ou `/s/{slug}/en/p/robe`
 *    (domaine principal). Le segment est retiré de l'URL interne et la langue est posée dans `x-axi-locale`,
 *    TOUJOURS écrasé : une valeur envoyée par le client n'est jamais reprise (§8). Une langue non activée
 *    (ou la langue principale explicitée) redirige en 302 vers l'URL sans préfixe — jamais de 404.
 * 2. Sous-domaines de boutique : {slug}.axi.africa → /s/{slug}/…
 *    (sauf /api, /_next et /media : les médias stockés localement sont servis tels quels sur tous les hôtes)
 * 3. Garde d'accès légère sur /app et /admin (la vérification réelle a lieu côté serveur).
 */
export async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const url = req.nextUrl;

  // Hôte de boutique : sous-domaine ou domaine personnalisé. Sur le domaine de l'application, un premier
  // segment de langue n'a aucun sens (`/en/connexion` n'est pas une langue) : seule la forme `/s/{slug}/{lang}` compte.
  const storeHost = host !== APP_DOMAIN && !host.startsWith("localhost") && !host.startsWith("127.0.0.1");
  const localeSplit = splitLocalePath(url.pathname, { storeHost });
  const locale = localeSplit.locale;
  // Chemin public (tel que vu par le navigateur) sans le segment de langue : cible de la redirection 302
  // et base des alternatives hreflang.
  const publicPath = localeSplit.path;
  let path = publicPath;

  const localized = (target: string | null) => respond(req, target, { locale, publicPath, storeHost });

  // Sous-domaine boutique
  if (host !== APP_DOMAIN && host.endsWith(`.${APP_DOMAIN}`)) {
    const slug = host.slice(0, -(APP_DOMAIN.length + 1));
    // Lot 1 (audit m5) : sur l'hôte d'une boutique, /s/<autre> n'est jamais servi (le cookie acheteur Path=/ de cet
    // hôte ne doit pas accompagner les pages ni les actions d'une autre boutique).
    if (slug && slug !== "www" && path.startsWith("/s/") && foreignStorePath(path, slug)) return notFoundResponse();
    if (slug && slug !== "www" && !path.startsWith("/s/") && !path.startsWith("/api") && !path.startsWith("/_next") && !path.startsWith("/media/")) {
      path = `/s/${slug}${path === "/" ? "" : path}`;
      return (await localeGuard(req, path, locale, publicPath)) ?? localized(path);
    }
  }

  // Domaines personnalisés : résolution via /api/domains/resolve (le proxy n'importe pas Prisma) — rewrite vers /s/{slug}
  if (host !== APP_DOMAIN && !host.endsWith(`.${APP_DOMAIN}`) && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    // Lot 1 (audit m5) : /s/<x> sur un domaine personnalisé uniquement si x est la boutique de ce domaine (sinon 404,
    // y compris pour un domaine inconnu ou non vérifié).
    if (path.startsWith("/s/")) {
      const slug = await resolveCustomDomain(host.split(":")[0]);
      if (!slug || foreignStorePath(path, slug)) return notFoundResponse();
    } else if (!path.startsWith("/api") && !path.startsWith("/_next") && !path.startsWith("/media/")) {
      const slug = await resolveCustomDomain(host.split(":")[0]);
      if (slug) {
        path = `/s/${slug}${path === "/" ? "" : path}`;
        return (await localeGuard(req, path, locale, publicPath)) ?? localized(path);
      }
      // Domaine inconnu ou non vérifié : on laisse passer (404 naturel).
    }
  }

  // Garde d'accès
  if (path.startsWith("/app") || path.startsWith("/admin")) {
    if (!req.cookies.get(SESSION_COOKIE)?.value) {
      const login = url.clone();
      login.pathname = "/connexion";
      login.search = `?next=${encodeURIComponent(path + url.search)}`;
      return NextResponse.redirect(login);
    }
  }

  // Console : chemin demandé transmis aux Server Components (MFA obligatoire, src/lib/admin/context.ts).
  // Toujours écrasé ici : une valeur envoyée par le client n'est jamais utilisée.
  if (path === "/admin" || path.startsWith("/admin/")) {
    const forwarded = new Headers(req.headers);
    forwarded.set("x-axi-pathname", path);
    return NextResponse.next({ request: { headers: forwarded } });
  }

  if (locale) {
    const guard = await localeGuard(req, path, locale, publicPath);
    if (guard) return guard;
    return localized(path === url.pathname ? null : path);
  }
  return localized(null);
}

/**
 * Réponse avec les en-têtes de langue, toujours écrasés (jamais repris du client) :
 *  - `x-axi-locale` : langue du segment d'URL, vide en langue principale ;
 *  - `x-axi-locale-path` : chemin public sans segment de langue (hreflang, bandeau de suggestion).
 * `target` non nul = réécriture vers le chemin interne (sans segment de langue).
 */
function respond(req: NextRequest, target: string | null, ctx: { locale: string | null; publicPath: string; storeHost: boolean }) {
  const forwarded = new Headers(req.headers);
  forwarded.delete(LOCALE_HEADER);
  forwarded.delete(LOCALE_PATH_HEADER);
  if (ctx.locale) forwarded.set(LOCALE_HEADER, ctx.locale);
  // Chemin public : sur un hôte de boutique, il ne contient pas `/s/{slug}` ; les alternatives hreflang sont
  // relatives, donc correctes dans les deux cas.
  if (ctx.publicPath.startsWith("/s/") || ctx.storeHost) forwarded.set(LOCALE_PATH_HEADER, ctx.publicPath);
  if (target) {
    const rewritten = req.nextUrl.clone();
    rewritten.pathname = target;
    return NextResponse.rewrite(rewritten, { request: { headers: forwarded } });
  }
  return NextResponse.next({ request: { headers: forwarded } });
}

/**
 * Langue non servie par la boutique (désactivée, baisse de plan, lien qui circule) ou langue principale
 * explicitée dans l'URL : 302 vers l'URL sans préfixe (jamais de 404, §1.1). Uniquement sur GET et HEAD :
 * une action serveur (POST) n'est jamais redirigée, elle est simplement servie en langue principale.
 */
async function localeGuard(req: NextRequest, internalPath: string, locale: string | null, publicPath: string) {
  if (!locale || !internalPath.startsWith("/s/")) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const slug = internalPath.split("/")[2];
  if (!slug) return null;
  const served = await resolveStoreLocales(slug);
  // Boutique inconnue ou API injoignable : on laisse la page décider (repli sur la langue principale).
  if (!served) return null;
  if (served.secondary.includes(locale)) return null;
  const redirect = req.nextUrl.clone();
  redirect.pathname = publicPath;
  return NextResponse.redirect(redirect, 302);
}

function notFoundResponse() {
  return new NextResponse("Page introuvable", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * Base FIXE de l'API interne (m10) : jamais dérivée de `req.url`, dont l'hôte provient de l'en-tête
 * `Host` contrôlé par le client (sinon le proxy interrogerait un serveur choisi par l'attaquant).
 */
const RESOLVE_BASE = (process.env.INTERNAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

async function resolveCustomDomain(host: string): Promise<string | null> {
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return null;
  try {
    const res = await fetch(`${RESOLVE_BASE}/api/domains/resolve?host=${encodeURIComponent(host)}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { slug?: unknown };
    return typeof data.slug === "string" && /^[a-z0-9-]{3,48}$/.test(data.slug) ? data.slug : null;
  } catch {
    return null;
  }
}

/** Langues servies par une boutique (`/api/storefront/locales`, mémo 60 s) ; null si indisponible. */
async function resolveStoreLocales(slug: string): Promise<{ primary: string; secondary: string[] } | null> {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return null;
  try {
    const res = await fetch(`${RESOLVE_BASE}/api/storefront/locales?slug=${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { primary?: unknown; secondary?: unknown };
    if (!isPlatformLocale(data.primary)) return null;
    const secondary = Array.isArray(data.secondary) ? data.secondary.filter((v): v is string => isPlatformLocale(v)) : [];
    return { primary: data.primary, secondary };
  } catch {
    return null;
  }
}

export const config = {
  // /api exclu : le proxy n'y fait rien (réécritures et garde ignorent déjà /api) ; l'exclure évite aussi qu'il mette
  // en tampon le corps des requêtes (envois d'images) avant l'authentification faite par la route.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)$).*)"],
};
