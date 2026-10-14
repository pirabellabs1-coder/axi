import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { SITE } from "@/config/site";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import { autoExcerpt } from "./markdown";
import { pickFreeSlug, slugCandidates } from "./slug";
import { isPostPublic, postDate, publicPostWhere } from "./visibility";
import type { BlogCard } from "./render-types";

/**
 * Lecture du blog (serveur). Toutes les requêtes sont filtrées par `storeId` (isolation entre boutiques) ;
 * la visibilité publique suit `publicPostWhere` (programmation résolue à la lecture).
 */

export type BlogPlan = { enabled: boolean; limit: number | null };

/** Blog inclus dans le plan, et nombre maximal d'articles (tous statuts confondus ; null = illimité). */
export function blogPlan(planId: PlanId): BlogPlan {
  const p = PLANS[planId];
  return { enabled: !!p.features.blog, limit: p.features.blog ? p.limits.blogPosts : 0 };
}

/** Message de limite de plan (création d'un article refusée). */
export function blogLimitMessage(planId: PlanId, storeId: string): string {
  const { enabled, limit } = blogPlan(planId);
  if (!enabled) return `Le blog est inclus à partir du plan Starter. Changez de plan : /app/${storeId}/abonnement`;
  return `Votre plan inclut ${limit} articles. Passez au plan Business pour des articles illimités : /app/${storeId}/abonnement`;
}

/** Peut-on créer un article de plus ? (contrôle serveur, avant toute création) */
export async function canCreatePost(storeId: string, planId: PlanId): Promise<boolean> {
  const { enabled, limit } = blogPlan(planId);
  if (!enabled) return false;
  if (limit === null) return true;
  return (await db.blogPost.count({ where: { storeId } })) < limit;
}

export function storeAbsBase(slug: string): string {
  return `${SITE.url.replace(/\/+$/, "")}/s/${slug}`;
}

/* ───────────── Cartes ───────────── */

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  body: true,
  coverImage: true,
  publishedAt: true,
  createdAt: true,
  readingMinutes: true,
  tags: true,
  authorName: true,
  status: true,
  category: { select: { slug: true, name: true } },
} satisfies Prisma.BlogPostSelect;

export type CardRow = Prisma.BlogPostGetPayload<{ select: typeof cardSelect }>;

export function coverOf(raw: unknown): { url: string; alt?: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as { url?: unknown; alt?: unknown };
  if (typeof o.url !== "string" || !isDisplayableImageUrl(o.url) || o.url.startsWith("data:")) return null;
  return typeof o.alt === "string" && o.alt.trim() ? { url: o.url, alt: o.alt.slice(0, 200) } : { url: o.url };
}

export function toCard(r: CardRow): BlogCard {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt?.trim() || autoExcerpt(r.body, 180),
    cover: coverOf(r.coverImage),
    publishedAt: postDate(r).toISOString(),
    readingMinutes: Math.max(1, r.readingMinutes),
    category: r.category ? { slug: r.category.slug, name: r.category.name } : null,
    tags: r.tags,
    authorName: r.authorName,
  };
}

const ORDER: Prisma.BlogPostOrderByWithRelationInput[] = [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];

/* ───────────── Lecture publique ───────────── */

export async function listPublicPosts(storeId: string, opts: { page?: number; perPage: number; categoryId?: string | null; tag?: string | null; now?: Date }) {
  const now = opts.now ?? new Date();
  const where: Prisma.BlogPostWhereInput = {
    ...publicPostWhere(storeId, now),
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    ...(opts.tag ? { tags: { has: opts.tag } } : {}),
  };
  const total = await db.blogPost.count({ where });
  const pages = Math.max(1, Math.ceil(total / opts.perPage));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const rows = await db.blogPost.findMany({ where, orderBy: ORDER, skip: (page - 1) * opts.perPage, take: opts.perPage, select: cardSelect });
  return { posts: rows.map(toCard), total, pages, page };
}

export async function latestPublicPosts(storeId: string, opts: { limit: number; categoryId?: string | null; excludeId?: string; now?: Date }) {
  const rows = await db.blogPost.findMany({
    where: { ...publicPostWhere(storeId, opts.now), ...(opts.categoryId ? { categoryId: opts.categoryId } : {}), ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}) },
    orderBy: ORDER,
    take: opts.limit,
    select: cardSelect,
  });
  return rows.map(toCard);
}

/** Catégories (ordre du commerçant) avec le nombre d'articles publics ; les catégories vides sont omises. */
export async function publicCategories(storeId: string, now = new Date()) {
  const [cats, counts] = await Promise.all([
    db.blogCategory.findMany({ where: { storeId }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, slug: true, name: true, description: true } }),
    db.blogPost.groupBy({ by: ["categoryId"], where: publicPostWhere(storeId, now), _count: { _all: true } }),
  ]);
  const byId = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return cats.map((c) => ({ ...c, count: byId.get(c.id) ?? 0 })).filter((c) => c.count > 0);
}

export function getCategoryBySlug(storeId: string, slug: string) {
  return db.blogCategory.findFirst({ where: { storeId, slug }, select: { id: true, slug: true, name: true, description: true } });
}

/**
 * Article par adresse. Public : seulement s'il est visible maintenant. Membre de la boutique (`member`) : tout statut
 * (aperçu d'un brouillon ou d'un article programmé, §3 cas limites).
 */
export async function getArticle(storeId: string, slug: string, opts: { member: boolean; now?: Date }) {
  const row = await db.blogPost.findFirst({
    where: { storeId, slug },
    select: { ...cardSelect, updatedAt: true, seoTitle: true, seoDescription: true, categoryId: true, templateSuffix: true },
  });
  if (!row) return null;
  const visible = isPostPublic(row, opts.now ?? new Date());
  if (!visible && !opts.member) return null;
  return { row, visible };
}

/** Articles liés : même catégorie d'abord, puis les plus récents. */
export async function relatedPosts(storeId: string, post: { id: string; categoryId: string | null }, limit = 6, now = new Date()) {
  const same = post.categoryId ? await latestPublicPosts(storeId, { limit, categoryId: post.categoryId, excludeId: post.id, now }) : [];
  if (same.length >= limit) return same;
  const more = await latestPublicPosts(storeId, { limit: limit + same.length, excludeId: post.id, now });
  const seen = new Set(same.map((p) => p.id));
  return [...same, ...more.filter((p) => !seen.has(p.id))].slice(0, limit);
}

/* ───────────── Écriture : adresse unique ───────────── */

/** Première adresse libre pour `base` dans la boutique (suffixe -2, -3… ; adresses réservées sautées). */
export async function uniquePostSlug(client: Pick<typeof db, "blogPost">, storeId: string, base: string, excludeId?: string): Promise<string | null> {
  const candidates = slugCandidates(base, 30);
  const taken = await client.blogPost.findMany({ where: { storeId, slug: { in: candidates }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { slug: true } });
  return pickFreeSlug(base, taken.map((t) => t.slug));
}

export async function uniqueCategorySlug(client: Pick<typeof db, "blogCategory">, storeId: string, base: string, excludeId?: string): Promise<string | null> {
  const candidates = slugCandidates(base, 30, 48);
  const taken = await client.blogCategory.findMany({ where: { storeId, slug: { in: candidates }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { slug: true } });
  return pickFreeSlug(base, taken.map((t) => t.slug), { reserved: [] });
}
