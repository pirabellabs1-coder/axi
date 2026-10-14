import { db } from "@/lib/db";
import { getPublicStore } from "@/lib/storefront/data";
import { effectivePlanId } from "@/lib/auth/permissions";
import { blogPlan, storeAbsBase } from "@/lib/blog/service";
import { buildSitemap, type SitemapEntry } from "@/lib/blog/seo";
import { publicPostWhere } from "@/lib/blog/visibility";

export const dynamic = "force-dynamic";

/**
 * Sitemap d'une boutique publiée : accueil, catalogue, collections, produits actifs, pages publiées et blog
 * (liste, catégories non vides, articles publics). Créé par le lot 2 (blog) : chaque domaine y ajoute ses URL.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getPublicStore(slug);
  if (!store) return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const abs = storeAbsBase(store.slug);
  const blogOn = blogPlan(effectivePlanId(store.subscription)).enabled;
  const now = new Date();

  const [products, pages, posts, postCats] = await Promise.all([
    db.product.findMany({ where: { storeId: store.id, status: "ACTIVE" }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 5000 }),
    db.storePage.findMany({ where: { storeId: store.id, published: true }, select: { slug: true, updatedAt: true } }),
    blogOn ? db.blogPost.findMany({ where: publicPostWhere(store.id, now), select: { slug: true, updatedAt: true, categoryId: true }, orderBy: { publishedAt: "desc" }, take: 5000 }) : Promise.resolve([]),
    blogOn ? db.blogCategory.findMany({ where: { storeId: store.id }, select: { id: true, slug: true } }) : Promise.resolve([]),
  ]);

  const entries: SitemapEntry[] = [
    { url: abs, lastModified: store.updatedAt, changeFrequency: "daily", priority: 1 },
    { url: `${abs}/catalogue`, changeFrequency: "daily", priority: 0.8 },
    ...store.categories.filter((c) => c.published).map((c) => ({ url: `${abs}/collections/${c.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((p) => ({ url: `${abs}/p/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...pages.map((p) => ({ url: `${abs}/pages/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.4 })),
  ];
  if (posts.length) {
    const used = new Set(posts.map((p) => p.categoryId).filter(Boolean));
    entries.push(
      { url: `${abs}/blog`, lastModified: posts[0]!.updatedAt, changeFrequency: "weekly", priority: 0.6 },
      ...postCats.filter((c) => used.has(c.id)).map((c) => ({ url: `${abs}/blog/categorie/${c.slug}`, changeFrequency: "weekly" as const, priority: 0.5 })),
      ...posts.map((p) => ({ url: `${abs}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
    );
  }
  return new Response(buildSitemap(entries), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900, s-maxage=900" } });
}
