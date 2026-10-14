"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zOptionalString, zRawId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { debitCredits, refundCredits } from "@/lib/credits";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { randomToken } from "@/lib/utils";
import { checkImageWrite } from "@/lib/storage/write-guard";
import { AiError, callClaudeJson, isAiConfigured } from "@/lib/ai/client";
import { AI_MODEL } from "@/lib/ai/parse";
import {
  BLOG_AI_COST,
  BLOG_AUTHOR_MAX,
  BLOG_BODY_MAX,
  BLOG_CATEGORIES_MAX,
  BLOG_CATEGORY_DESCRIPTION_MAX,
  BLOG_CATEGORY_NAME_MAX,
  BLOG_EXCERPT_MAX,
  BLOG_IMAGE_ALT_MAX,
  BLOG_SEO_DESCRIPTION_MAX,
  BLOG_SEO_TITLE_MAX,
  BLOG_TITLE_MAX,
} from "./constants";
import { blogMarkdownProblem } from "./markdown-guard";
import { IMAGE_LINE_RE, isBlogImageUrl, readingMinutes } from "./markdown";
import { baseSlug, blogSlugify } from "./slug";
import { parseTags } from "./tags";
import { resolvePublication, zonedLocalToUtc, type PublishIntent } from "./visibility";
import { blogLimitMessage, blogPlan, canCreatePost, uniqueCategorySlug, uniquePostSlug } from "./service";
import { BLOG_DRAFT_JSON_SCHEMA, BLOG_DRAFT_SYSTEM, buildBlogDraftPrompt, parseBlogDraftResponse, type BlogDraft } from "./ai";

/**
 * Actions du blog (lot 2 D). Capacité `store.settings` (propriétaire et gérant, comme les pages de la boutique),
 * filtre `storeId` sur chaque requête, contrôle de plan côté serveur (`features.blog`, `limits.blogPosts`),
 * journal d'audit `blog.*`. Aucun job : la publication programmée est résolue à la lecture.
 */

const CAP = "store.settings" as const;

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/blog`, "layout");
  revalidatePath(`/s/${slug}`, "layout");
}

async function blogContext(storeId: string): Promise<{ ctx: StoreContext } | { error: ActionResult<never> }> {
  const ctx = await requireStore(storeId, CAP);
  if (!blogPlan(ctx.planId).enabled) return { error: fail(blogLimitMessage(ctx.planId, ctx.store.id)) };
  return { ctx };
}

/* ───────────── Articles ───────────── */

const postSchema = z.object({
  storeId: zRawId,
  postId: z.preprocess((v) => (v === "" ? undefined : v), zRawId.optional()),
  title: z.string().trim().min(3, "Titre requis (3 caractères minimum)").max(BLOG_TITLE_MAX, `${BLOG_TITLE_MAX} caractères maximum`),
  slug: zOptionalString,
  excerpt: z.string().trim().max(BLOG_EXCERPT_MAX, `${BLOG_EXCERPT_MAX} caractères maximum`).default(""),
  body: z.string().max(BLOG_BODY_MAX, `${BLOG_BODY_MAX.toLocaleString("fr-FR")} caractères maximum`).default(""),
  coverUrl: z.string().trim().max(600).default(""),
  coverAlt: z.string().trim().max(BLOG_IMAGE_ALT_MAX, `${BLOG_IMAGE_ALT_MAX} caractères maximum`).default(""),
  categoryId: z.preprocess((v) => (v === "" ? undefined : v), zRawId.optional()),
  tags: z.string().max(600).default(""),
  authorName: z.string().trim().max(BLOG_AUTHOR_MAX, `${BLOG_AUTHOR_MAX} caractères maximum`).default(""),
  seoTitle: z.string().trim().max(BLOG_SEO_TITLE_MAX, `${BLOG_SEO_TITLE_MAX} caractères maximum`).default(""),
  seoDescription: z.string().trim().max(BLOG_SEO_DESCRIPTION_MAX, `${BLOG_SEO_DESCRIPTION_MAX} caractères maximum`).default(""),
  intent: z.enum(["draft", "publish", "schedule", "archive"]),
  scheduledAt: z.string().max(20).default(""),
});

export type SavePostData = { id: string; slug: string; status: string };

/** Créer ou modifier un article (brouillon, publication immédiate, programmation, archivage). */
export async function savePost(_prev: ActionResult<SavePostData> | undefined, formData: FormData): Promise<ActionResult<SavePostData>> {
  return guard<SavePostData>(async () => {
    const parsed = parseForm(postSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const b = await blogContext(d.storeId);
    if ("error" in b) return b.error;
    const { ctx } = b;
    const storeId = ctx.store.id;

    const bodyProblem = blogMarkdownProblem(d.body);
    if (bodyProblem) return fail(bodyProblem, { body: [bodyProblem] });
    if (d.intent !== "draft" && d.body.trim().length < 20) return fail("Écrivez le contenu de l'article avant de le publier.", { body: ["Contenu trop court pour être publié"] });
    if (d.coverUrl && !isBlogImageUrl(d.coverUrl)) return fail("Image de couverture non autorisée : téléversez-la.", { coverUrl: ["Image non autorisée"] });

    const existing = d.postId
      ? await db.blogPost.findFirst({ where: { id: d.postId, storeId }, select: { id: true, slug: true, status: true, publishedAt: true, coverImage: true, body: true } })
      : null;
    if (d.postId && !existing) return fail("Article introuvable");
    if (!existing && !(await canCreatePost(storeId, ctx.planId))) return fail(blogLimitMessage(ctx.planId, storeId));

    // Images : médias de CETTE boutique (ou https), aucune data-URL (règles d'écriture du stockage).
    const bodyImages = d.body.split("\n").map((l) => IMAGE_LINE_RE.exec(l.trim())?.[2]).filter((u): u is string => !!u);
    const imgError = checkImageWrite([d.coverUrl, ...bodyImages], { storeId, existing: existing ? [existing.coverImage, existing.body] : [] });
    if (imgError) return fail(imgError);

    if (d.categoryId) {
      const cat = await db.blogCategory.findFirst({ where: { id: d.categoryId, storeId }, select: { id: true } });
      if (!cat) return fail("Catégorie introuvable", { categoryId: ["Catégorie introuvable"] });
    }

    let scheduledAt: Date | null = null;
    if (d.intent === "schedule") {
      scheduledAt = zonedLocalToUtc(d.scheduledAt, ctx.store.timezone || "UTC");
      if (!scheduledAt) return fail("Date de publication invalide.", { scheduledAt: ["Date invalide"] });
    }
    const pub = resolvePublication(d.intent as PublishIntent, { scheduledAt, previousPublishedAt: existing?.publishedAt ?? null });
    if (!pub.ok) return fail(pub.error, { scheduledAt: [pub.error] });

    const base = baseSlug(d.slug, d.title);
    const data = {
      title: d.title,
      excerpt: d.excerpt || null,
      body: d.body,
      coverImage: d.coverUrl ? ({ url: d.coverUrl, ...(d.coverAlt ? { alt: d.coverAlt } : {}) } as Prisma.InputJsonValue) : Prisma.DbNull,
      categoryId: d.categoryId ?? null,
      tags: parseTags(d.tags),
      authorName: d.authorName || null,
      seoTitle: d.seoTitle || null,
      seoDescription: d.seoDescription || null,
      readingMinutes: readingMinutes(d.body),
      status: pub.status,
      publishedAt: pub.publishedAt,
    };

    // Adresse unique par boutique (suffixe -2…) ; une collision concurrente (P2002) relance une fois.
    for (let attempt = 0; attempt < 2; attempt++) {
      const slug = existing && blogSlugify(d.slug ?? "") === existing.slug ? existing.slug : await uniquePostSlug(db, storeId, base, existing?.id);
      if (!slug) return fail("Adresse indisponible : choisissez-en une autre.", { slug: ["Adresse déjà utilisée"] });
      try {
        const post = existing
          ? await db.blogPost.update({ where: { id: existing.id }, data: { ...data, slug }, select: { id: true, slug: true, status: true } })
          : await db.blogPost.create({ data: { ...data, slug, storeId, createdById: ctx.user.id }, select: { id: true, slug: true, status: true } });
        const action = !existing ? "blog.post.created" : existing.status !== pub.status ? `blog.post.${pub.status.toLowerCase()}` : "blog.post.updated";
        await audit({ storeId, actorId: ctx.user.id, action, target: post.id, metadata: { slug, status: pub.status, publishedAt: pub.publishedAt?.toISOString() ?? null } });
        revalidate(storeId, ctx.store.slug);
        const msg = pub.status === "PUBLISHED" ? "Article publié" : pub.status === "SCHEDULED" ? "Publication programmée" : pub.status === "ARCHIVED" ? "Article archivé" : "Brouillon enregistré";
        return success({ id: post.id, slug: post.slug, status: post.status }, slug !== base && !existing ? `${msg} (adresse : ${slug})` : msg);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt === 0) continue;
        throw e;
      }
    }
    return fail("Adresse indisponible : choisissez-en une autre.", { slug: ["Adresse déjà utilisée"] });
  });
}

/** Changement de statut rapide depuis la liste (publier, repasser en brouillon, archiver). */
export async function setPostStatus(storeId: string, postId: string, intent: "draft" | "publish" | "archive"): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(postId).success || !["draft", "publish", "archive"].includes(intent)) return fail("Demande invalide");
    const b = await blogContext(storeId);
    if ("error" in b) return b.error;
    const { ctx } = b;
    const post = await db.blogPost.findFirst({ where: { id: postId, storeId: ctx.store.id }, select: { id: true, status: true, publishedAt: true, body: true } });
    if (!post) return fail("Article introuvable");
    if (intent === "publish" && post.body.trim().length < 20) return fail("Écrivez le contenu de l'article avant de le publier.");
    const pub = resolvePublication(intent, { previousPublishedAt: post.publishedAt });
    if (!pub.ok) return fail(pub.error);
    await db.blogPost.updateMany({ where: { id: post.id, storeId: ctx.store.id }, data: { status: pub.status, publishedAt: pub.publishedAt } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: `blog.post.${pub.status.toLowerCase()}`, target: post.id, metadata: { from: post.status } });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, pub.status === "PUBLISHED" ? "Article publié" : pub.status === "ARCHIVED" ? "Article archivé" : "Repassé en brouillon");
  });
}

export async function deletePost(storeId: string, postId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(postId).success) return fail("Demande invalide");
    // Suppression permise même sans le blog dans le plan (nettoyage après un changement de plan).
    const ctx = await requireStore(storeId, CAP);
    const r = await db.blogPost.deleteMany({ where: { id: postId, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Article introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "blog.post.deleted", target: postId });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Article supprimé");
  });
}

/* ───────────── Catégories ───────────── */

const categorySchema = z.object({
  storeId: zRawId,
  categoryId: z.preprocess((v) => (v === "" ? undefined : v), zRawId.optional()),
  name: z.string().trim().min(2, "Nom requis (2 caractères minimum)").max(BLOG_CATEGORY_NAME_MAX, `${BLOG_CATEGORY_NAME_MAX} caractères maximum`),
  slug: zOptionalString,
  description: z.string().trim().max(BLOG_CATEGORY_DESCRIPTION_MAX, `${BLOG_CATEGORY_DESCRIPTION_MAX} caractères maximum`).default(""),
});

export async function saveCategory(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard<{ id: string }>(async () => {
    const parsed = parseForm(categorySchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const b = await blogContext(d.storeId);
    if ("error" in b) return b.error;
    const { ctx } = b;
    const storeId = ctx.store.id;
    if (d.description && /<\/?[a-z!][^>]*>/i.test(d.description)) return fail("HTML interdit dans la description.", { description: ["HTML interdit"] });
    const existing = d.categoryId ? await db.blogCategory.findFirst({ where: { id: d.categoryId, storeId }, select: { id: true, slug: true } }) : null;
    if (d.categoryId && !existing) return fail("Catégorie introuvable");
    if (!existing && (await db.blogCategory.count({ where: { storeId } })) >= BLOG_CATEGORIES_MAX) return fail(`${BLOG_CATEGORIES_MAX} catégories maximum.`);
    const base = blogSlugify(d.slug || d.name, 48);
    if (base.length < 2) return fail("Adresse invalide", { slug: ["2 caractères minimum : lettres, chiffres, tirets"] });
    const slug = existing?.slug === base ? base : await uniqueCategorySlug(db, storeId, base, existing?.id);
    if (!slug) return fail("Adresse déjà utilisée", { slug: ["Adresse déjà utilisée"] });
    try {
      let id: string;
      if (existing) {
        await db.blogCategory.updateMany({ where: { id: existing.id, storeId }, data: { name: d.name, slug, description: d.description || null } });
        id = existing.id;
      } else {
        const last = await db.blogCategory.findFirst({ where: { storeId }, orderBy: { position: "desc" }, select: { position: true } });
        id = (await db.blogCategory.create({ data: { storeId, name: d.name, slug, description: d.description || null, position: (last?.position ?? -1) + 1 }, select: { id: true } })).id;
      }
      await audit({ storeId, actorId: ctx.user.id, action: existing ? "blog.category.updated" : "blog.category.created", target: id, metadata: { slug } });
      revalidate(storeId, ctx.store.slug);
      return success({ id }, existing ? "Catégorie enregistrée" : "Catégorie créée");
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("Adresse déjà utilisée", { slug: ["Adresse déjà utilisée"] });
      throw e;
    }
  });
}

/** Supprimer une catégorie : ses articles restent publiés, sans catégorie (onDelete: SetNull). */
export async function deleteCategory(storeId: string, categoryId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(categoryId).success) return fail("Demande invalide");
    const ctx = await requireStore(storeId, CAP);
    const cat = await db.blogCategory.findFirst({ where: { id: categoryId, storeId: ctx.store.id }, select: { id: true } });
    if (!cat) return fail("Catégorie introuvable");
    await db.$transaction([
      db.blogPost.updateMany({ where: { storeId: ctx.store.id, categoryId: cat.id }, data: { categoryId: null } }),
      db.blogCategory.deleteMany({ where: { id: cat.id, storeId: ctx.store.id } }),
    ]);
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "blog.category.deleted", target: cat.id });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Catégorie supprimée");
  });
}

export async function moveCategory(storeId: string, categoryId: string, direction: "up" | "down"): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(categoryId).success) return fail("Demande invalide");
    const b = await blogContext(storeId);
    if ("error" in b) return b.error;
    const { ctx } = b;
    const cats = await db.blogCategory.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true } });
    const i = cats.findIndex((c) => c.id === categoryId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= cats.length) return success();
    [cats[i], cats[j]] = [cats[j]!, cats[i]!];
    await db.$transaction(cats.map((c, position) => db.blogCategory.updateMany({ where: { id: c.id, storeId: ctx.store.id }, data: { position } })));
    revalidate(ctx.store.id, ctx.store.slug);
    return success();
  });
}

/* ───────────── Rédaction IA ───────────── */

const aiSchema = z.object({
  storeId: zRawId,
  topic: z.string().trim().min(5, "Décrivez le sujet de l'article (5 caractères minimum).").max(160, "160 caractères maximum"),
  notes: z.string().trim().max(800, "800 caractères maximum").nullable().optional(),
  postId: z.string().max(64).nullable().optional(),
});

export type AiDraftInput = z.input<typeof aiSchema>;

/**
 * « Rédiger un brouillon avec l'IA » : 3 crédits IA, débités avant l'appel et remboursés en cas d'échec.
 * Mêmes garde-fous que les descriptions produit (plan Business+ `aiAssistant`, débit limité, données entre balises,
 * filtrage des affirmations non vérifiables). Renvoie une proposition : rien n'est enregistré ni publié.
 */
export async function draftPostWithAi(input: AiDraftInput): Promise<ActionResult<BlogDraft & { creditsUsed: number }>> {
  return guard<BlogDraft & { creditsUsed: number }>(async () => {
    const p = aiSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Demande invalide.");
    const d = p.data;
    const b = await blogContext(d.storeId);
    if ("error" in b) return b.error;
    const { ctx } = b;
    if (!isAiConfigured()) return fail("L'assistant IA n'est pas encore activé sur la plateforme.");
    if (!PLANS[ctx.planId].features.aiAssistant) return fail(`L'assistant de rédaction est inclus à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}).`);

    const rl = await rateLimit(`ai:store:${ctx.store.id}`, 30, 10 * 60);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const reference = `ai:${randomToken(8)}`;
    const debit = await db.$transaction((tx) => debitCredits(ctx.store.id, "AI", BLOG_AI_COST, reference, tx));
    if (!debit.ok) return fail(debit.error);

    const log = (ok: boolean, extra: Record<string, unknown>) =>
      audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "ai.blog_draft", target: d.postId ?? undefined, metadata: { ok, model: AI_MODEL, credits: ok ? BLOG_AI_COST : 0, ...extra } }).catch(() => {});

    try {
      const res = await callClaudeJson({
        system: BLOG_DRAFT_SYSTEM,
        user: buildBlogDraftPrompt({ topic: d.topic, notes: d.notes, storeName: ctx.store.name, sector: ctx.store.sector }),
        schema: BLOG_DRAFT_JSON_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 4000,
      });
      const parsed = parseBlogDraftResponse(res.text);
      if (!parsed.ok) {
        await refundCredits(ctx.store.id, reference, null);
        await log(false, { error: "parse", inputTokens: res.usage.input, outputTokens: res.usage.output });
        return fail(parsed.error);
      }
      await log(true, { inputTokens: res.usage.input, outputTokens: res.usage.output, removed: parsed.data.removed.length });
      return success({ ...parsed.data, creditsUsed: BLOG_AI_COST }, "Brouillon prêt : relisez-le avant de l'enregistrer.");
    } catch (e) {
      await refundCredits(ctx.store.id, reference, null);
      await log(false, { error: e instanceof AiError ? e.message : "exception" });
      if (e instanceof AiError) return fail(`${e.message} Vos crédits n'ont pas été débités.`);
      throw e;
    }
  });
}
