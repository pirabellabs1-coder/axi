import "server-only";
import type { Subscription } from "@prisma/client";
import { effectivePlanId } from "@/lib/auth/permissions";
import { S } from "@/lib/storefront/theme-doc";
import type { RenderData } from "@/lib/storefront/render-types";
import type { TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { BLOG_PER_PAGE_DEFAULT, BLOG_PER_PAGE_MAX, BLOG_PER_PAGE_MIN } from "./constants";
import { articleUrl } from "./seo";
import { blogPlan, getArticle, getCategoryBySlug, latestPublicPosts, listPublicPosts, publicCategories, relatedPosts, storeAbsBase, toCard } from "./service";
import { sampleBlog, type BlogArticle, type BlogRenderData, type RenderDataWithBlog } from "./render-types";

/**
 * Préparation des données du blog pour le moteur de rendu (`RenderData.blog`).
 *  - `withBlogData` : appelée par la vue de boutique générique (accueil, pages…) pour la section « Derniers articles »
 *    et pour l'aperçu de l'éditeur (`?preview=1&template=blog|article`) ; aucune requête si le modèle n'a pas de
 *    section blog et que ce n'est pas un aperçu.
 *  - `loadBlogPage` : routes /s/{slug}/blog/… (liste, catégorie, article).
 */

type StoreRef = { id: string; slug: string; subscription: Pick<Subscription, "planId" | "status" | "trialEndsAt" | "currentPeriodEnd"> | null };

const ALL = "";

function blogPostsCategories(doc: ThemeDocument, template: TemplateId): { categories: Set<string>; maxLimit: number } {
  const tpl = doc.templates[template];
  const categories = new Set<string>();
  let maxLimit = 0;
  for (const id of tpl?.order ?? []) {
    const s = tpl!.sections[id];
    if (!s || s.disabled || s.type !== "blog-posts") continue;
    categories.add(S.str(s.settings, "category", "").trim().toLowerCase());
    maxLimit = Math.max(maxLimit, Math.min(12, Math.max(2, S.num(s.settings, "limit", 3))));
  }
  return { categories, maxLimit };
}

async function latestByCategory(storeId: string, keys: Set<string>, limit: number, now: Date): Promise<Record<string, BlogRenderData["latest"][string]>> {
  const out: BlogRenderData["latest"] = {};
  await Promise.all(
    [...keys].map(async (slug) => {
      if (slug === ALL) {
        out[ALL] = await latestPublicPosts(storeId, { limit, now });
        return;
      }
      const cat = await getCategoryBySlug(storeId, slug);
      out[slug] = cat ? await latestPublicPosts(storeId, { limit, categoryId: cat.id, now }) : [];
    }),
  );
  return out;
}

export async function withBlogData(store: StoreRef, doc: ThemeDocument, template: TemplateId, data: RenderData, opts: { preview: boolean }): Promise<void> {
  const target = data as RenderDataWithBlog;
  if (target.blog) return;
  const { categories: keys, maxLimit } = blogPostsCategories(doc, template);
  const wantsTemplate = opts.preview && (template === "blog" || template === "article");
  if (!keys.size && !opts.preview) return;
  const absBase = storeAbsBase(store.slug);
  const plan = blogPlan(effectivePlanId(store.subscription));
  if (!plan.enabled) {
    target.blog = { enabled: false, categories: [], latest: {}, absBase };
    return;
  }
  const now = new Date();
  if (opts.preview) keys.add(ALL);
  const [latest, cats] = await Promise.all([latestByCategory(store.id, keys, Math.max(maxLimit, opts.preview ? 12 : 0), now), publicCategories(store.id, now)]);
  const blog: BlogRenderData = { enabled: true, categories: cats.map((c) => ({ slug: c.slug, name: c.name, count: c.count })), latest, absBase };

  if (wantsTemplate) {
    const all = latest[ALL] ?? [];
    if (!all.length) {
      target.blog = sampleBlog(now.toISOString(), absBase);
      return;
    }
    if (template === "blog") blog.listing = { posts: all.slice(0, BLOG_PER_PAGE_DEFAULT), page: 1, pages: 1, total: all.length, category: null, tag: null };
    else {
      const first = await getArticle(store.id, all[0]!.slug, { member: true, now });
      if (first) {
        blog.article = toArticle(first.row, null, absBase);
        blog.related = await relatedPosts(store.id, first.row, 6, now);
      }
    }
  }
  target.blog = blog;
}

function toArticle(row: NonNullable<Awaited<ReturnType<typeof getArticle>>>["row"], previewStatus: BlogArticle["previewStatus"], absBase: string): BlogArticle {
  return { ...toCard(row), body: row.body, updatedAt: row.updatedAt.toISOString(), previewStatus, url: articleUrl(absBase, row.slug) };
}

/* ───────────── Routes du blog ───────────── */

export type BlogPageRequest =
  | { kind: "list"; page: number; categorySlug?: string | null; tag?: string | null; perPage?: number }
  | { kind: "article"; slug: string; member: boolean };

export type BlogPageResult =
  | { ok: true; blog: BlogRenderData; meta: { title: string; description: string | null; image: string | null; canonical: string; seoTitle?: string | null; publishedAt?: string; noindex?: boolean; templateSuffix?: string | null } }
  | { ok: false; reason: "disabled" | "not_found" };

/** Nombre d'articles par page : réglage `per_page` de la section `main-blog` du thème. */
export function perPageFrom(doc: ThemeDocument): number {
  const tpl = doc.templates.blog;
  const main = tpl ? Object.values(tpl.sections).find((s) => s.type === "main-blog") : undefined;
  const n = main ? S.num(main.settings, "per_page", BLOG_PER_PAGE_DEFAULT) : BLOG_PER_PAGE_DEFAULT;
  return Math.max(BLOG_PER_PAGE_MIN, Math.min(BLOG_PER_PAGE_MAX, Math.round(n)));
}

export async function loadBlogPage(store: StoreRef & { name: string }, doc: ThemeDocument, req: BlogPageRequest): Promise<BlogPageResult> {
  const plan = blogPlan(effectivePlanId(store.subscription));
  if (!plan.enabled) return { ok: false, reason: "disabled" };
  const now = new Date();
  const absBase = storeAbsBase(store.slug);
  const cats = await publicCategories(store.id, now);
  const categories = cats.map((c) => ({ slug: c.slug, name: c.name, count: c.count }));

  if (req.kind === "list") {
    const category = req.categorySlug ? await getCategoryBySlug(store.id, req.categorySlug) : null;
    if (req.categorySlug && !category) return { ok: false, reason: "not_found" };
    const tag = req.tag?.trim().toLowerCase().slice(0, 30) || null;
    const perPage = req.perPage ?? perPageFrom(doc);
    const res = await listPublicPosts(store.id, { page: req.page, perPage, categoryId: category?.id ?? null, tag, now });
    const blog: BlogRenderData = {
      enabled: true,
      categories,
      latest: {},
      absBase,
      listing: { posts: res.posts, page: res.page, pages: res.pages, total: res.total, category: category ? { slug: category.slug, name: category.name, description: category.description } : null, tag },
    };
    const path = category ? `/blog/categorie/${category.slug}` : "/blog";
    return {
      ok: true,
      blog,
      meta: {
        title: category ? category.name : "Blog",
        description: category?.description ?? `Les articles de ${store.name}.`,
        image: res.posts[0]?.cover?.url ?? null,
        canonical: `${absBase}${path}${res.page > 1 ? `?page=${res.page}` : ""}`,
        // Pages filtrées par étiquette : pas d'indexation (contenu dupliqué).
        noindex: !!tag,
      },
    };
  }

  const found = await getArticle(store.id, req.slug, { member: req.member, now });
  if (!found) return { ok: false, reason: "not_found" };
  const { row, visible } = found;
  const previewStatus = visible ? null : row.status === "PUBLISHED" ? null : (row.status as "DRAFT" | "SCHEDULED" | "ARCHIVED");
  const article = toArticle(row, previewStatus, absBase);
  const related = await relatedPosts(store.id, row, 6, now);
  return {
    ok: true,
    blog: { enabled: true, categories, latest: {}, absBase, article, related },
    meta: {
      title: row.title,
      seoTitle: row.seoTitle,
      description: row.seoDescription || article.excerpt || null,
      image: article.cover?.url ?? null,
      canonical: article.url,
      publishedAt: article.publishedAt,
      noindex: !visible,
      templateSuffix: row.templateSuffix,
    },
  };
}
