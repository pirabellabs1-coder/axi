import { db } from "@/lib/db";
import { getPublicStore } from "@/lib/storefront/data";
import { effectivePlanId } from "@/lib/auth/permissions";
import { blogPlan, storeAbsBase } from "@/lib/blog/service";
import { publicPostWhere } from "@/lib/blog/visibility";
import { PLANS } from "@/config/plans";
import { isPlatformLocale, storeLocales, withLocalePath } from "@/i18n/locales";

/**
 * Sitemap d'UNE langue de la boutique (lot 2 §1.1, « sitemap par langue ») :
 * `/s/{slug}/sitemap/{locale}`. Chaque URL porte ses alternatives `xhtml:link` (hreflang) et un `x-default`
 * sur la langue principale, comme la recommandation Google pour les sites multilingues.
 *
 * Le sitemap de la langue principale reste `/s/{slug}/sitemap.xml` (créé au lot 2 par l'équipe blog) :
 * cette route le complète pour les langues secondaires sans le modifier.
 */
export const dynamic = "force-dynamic";

type Entry = { path: string; lastModified?: Date; changeFrequency?: string; priority?: number };

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  if (!isPlatformLocale(locale)) return notFound();
  const store = await getPublicStore(slug);
  if (!store) return notFound();
  const locales = storeLocales(store, PLANS[effectivePlanId(store.subscription)].limits.languages);
  // Langue non servie : pas de sitemap (et donc aucune URL indexable annoncée).
  if (!locales.all.includes(locale)) return notFound();

  const base = `/s/${store.slug}`;
  const blogOn = blogPlan(effectivePlanId(store.subscription)).enabled;
  const now = new Date();
  const [products, pages, posts, postCats] = await Promise.all([
    db.product.findMany({ where: { storeId: store.id, status: "ACTIVE" }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 5000 }),
    db.storePage.findMany({ where: { storeId: store.id, published: true }, select: { slug: true, updatedAt: true } }),
    blogOn ? db.blogPost.findMany({ where: publicPostWhere(store.id, now), select: { slug: true, updatedAt: true, categoryId: true }, orderBy: { publishedAt: "desc" }, take: 5000 }) : Promise.resolve([]),
    blogOn ? db.blogCategory.findMany({ where: { storeId: store.id }, select: { id: true, slug: true } }) : Promise.resolve([]),
  ]);

  const entries: Entry[] = [
    { path: base, lastModified: store.updatedAt, changeFrequency: "daily", priority: 1 },
    { path: `${base}/catalogue`, changeFrequency: "daily", priority: 0.8 },
    ...store.categories.filter((c) => c.published).map((c) => ({ path: `${base}/collections/${c.slug}`, changeFrequency: "weekly", priority: 0.7 })),
    ...products.map((p) => ({ path: `${base}/p/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly", priority: 0.7 })),
    ...pages.map((p) => ({ path: `${base}/pages/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly", priority: 0.4 })),
  ];
  if (posts.length) {
    const used = new Set(posts.map((p) => p.categoryId).filter(Boolean));
    entries.push(
      { path: `${base}/blog`, lastModified: posts[0]!.updatedAt, changeFrequency: "weekly", priority: 0.6 },
      ...postCats.filter((c) => used.has(c.id)).map((c) => ({ path: `${base}/blog/categorie/${c.slug}`, changeFrequency: "weekly", priority: 0.5 })),
      ...posts.map((p) => ({ path: `${base}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly", priority: 0.6 })),
    );
  }

  const origin = storeAbsBase(store.slug).slice(0, -`/s/${store.slug}`.length);
  const abs = (path: string, code: string) => `${origin}${withLocalePath(path, code === locales.primary ? null : code)}`;
  const body = entries
    .map((e) => {
      const alternates = locales.all
        .map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${xml(abs(e.path, code))}" />`)
        .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(abs(e.path, locales.primary))}" />`)
        .join("\n");
      return [
        "  <url>",
        `    <loc>${xml(abs(e.path, locale))}</loc>`,
        e.lastModified ? `    <lastmod>${e.lastModified.toISOString()}</lastmod>` : "",
        e.changeFrequency ? `    <changefreq>${e.changeFrequency}</changefreq>` : "",
        e.priority != null ? `    <priority>${e.priority.toFixed(1)}</priority>` : "",
        alternates,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;
  return new Response(xmlBody, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900, s-maxage=900" } });
}

function xml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function notFound() {
  return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
