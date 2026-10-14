import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { roleHas } from "@/lib/auth/permissions";
import { BLOG_BODY_MAX, BLOG_EXCERPT_MAX, BLOG_SEO_DESCRIPTION_MAX, BLOG_SEO_TITLE_MAX, BLOG_STATUS_LABELS, BLOG_TITLE_MAX } from "@/lib/blog/constants";
import { blogMarkdownProblem } from "@/lib/blog/markdown-guard";
import { readingMinutes } from "@/lib/blog/markdown";
import { baseSlug } from "@/lib/blog/slug";
import { parseTags } from "@/lib/blog/tags";
import { effectiveStatus } from "@/lib/blog/visibility";
import { blogLimitMessage, blogPlan, canCreatePost, storeAbsBase, uniquePostSlug } from "@/lib/blog/service";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { assertWritable, auditApi, lines, revalidate, zLimit } from "./common";

/**
 * Outils MCP du blog (lot 2 D, scope `content:write`, Starter+) : un assistant peut rédiger un BROUILLON et lister
 * les articles. Il ne publie jamais : la publication reste une décision du commerçant dans Axi.
 */

type Ctx = MerchantContext;

function requireBlog(ctx: Ctx) {
  if (!roleHas(ctx.role, "store.settings")) throw new ToolError(`Managing the blog is not allowed for the ${ctx.role} role of the member who created this connection.`, "forbidden");
  if (!blogPlan(ctx.planId).enabled) throw new ToolError(`The blog is not included in the store's current plan. The owner can upgrade at /app/${ctx.store.id}/abonnement.`, "plan_required");
}

export const listBlogPosts = defineTool({
  name: "list_blog_posts",
  title: "List blog posts",
  description: "Blog posts of the store, most recently updated first: title, status (DRAFT, SCHEDULED, PUBLISHED, ARCHIVED; a scheduled post whose date has passed is PUBLISHED), publication date, category, tags and public URL.",
  scopes: ["content:write"],
  annotations: { readOnlyHint: true },
  input: z.object({
    status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional().describe("Keep only this (effective) status."),
    limit: zLimit(20, 50),
  }),
  handler: async (ctx: Ctx, a) => {
    requireBlog(ctx);
    const now = new Date();
    const rows = await db.blogPost.findMany({
      where: { storeId: ctx.store.id },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, slug: true, title: true, status: true, publishedAt: true, updatedAt: true, tags: true, readingMinutes: true, category: { select: { name: true } } },
    });
    const abs = storeAbsBase(ctx.store.slug);
    const posts = rows
      .map((r) => {
        const status = effectiveStatus(r, now);
        return { id: r.id, title: r.title, slug: r.slug, status, status_label: BLOG_STATUS_LABELS[status], published_at: r.publishedAt?.toISOString() ?? null, updated_at: r.updatedAt.toISOString(), category: r.category?.name ?? null, tags: r.tags, reading_minutes: r.readingMinutes, url: `${abs}/blog/${r.slug}` };
      })
      .filter((p) => !a.status || p.status === a.status)
      .slice(0, a.limit);
    const text = posts.length ? lines(`${posts.length} blog post(s):`, ...posts.map((p) => `- ${p.title} · ${p.status_label}${p.published_at ? ` · ${p.published_at.slice(0, 10)}` : ""} (id: ${p.id})`)) : "No blog post matches.";
    return { text, data: { posts } };
  },
});

export const createBlogPost = defineTool({
  name: "create_blog_post",
  title: "Create a blog post draft",
  description: `Create a blog post as a DRAFT (never published: the merchant reviews and publishes it in Axi). Body in limited Markdown: "## " subheadings, paragraphs, "- " lists, **bold**, *italic*, "> " quotes, links to https or store paths (/catalogue). No HTML. Do not invent prices, stock, delivery times, guarantees or promotions. Counts toward the plan's blog post limit.`,
  scopes: ["content:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  input: z.object({
    title: z.string().trim().min(3).max(BLOG_TITLE_MAX),
    body: z.string().min(20).max(BLOG_BODY_MAX).describe("Article body in limited Markdown (French by default)."),
    excerpt: z.string().trim().max(BLOG_EXCERPT_MAX).optional().describe("One or two sentences shown on article cards."),
    category_slug: z.string().trim().max(60).optional().describe("Slug of an existing blog category (see the store's blog)."),
    tags: z.array(z.string().trim().max(30)).max(10).optional(),
    seo_title: z.string().trim().max(BLOG_SEO_TITLE_MAX).optional(),
    seo_description: z.string().trim().max(BLOG_SEO_DESCRIPTION_MAX).optional(),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireBlog(ctx);
    const problem = blogMarkdownProblem(a.body);
    if (problem) throw new ToolError(`Invalid body: ${problem}`);
    if (/!\[/.test(a.body)) throw new ToolError("Images cannot be added through this connection: the merchant adds them in Axi.");
    if (!(await canCreatePost(ctx.store.id, ctx.planId))) throw new ToolError(blogLimitMessage(ctx.planId, ctx.store.id), "plan_required");
    const category = a.category_slug ? await db.blogCategory.findFirst({ where: { storeId: ctx.store.id, slug: a.category_slug.toLowerCase() }, select: { id: true, name: true } }) : null;
    if (a.category_slug && !category) throw new ToolError(`No blog category with slug "${a.category_slug}" in this store.`);
    const slug = await uniquePostSlug(db, ctx.store.id, baseSlug(null, a.title));
    if (!slug) throw new ToolError("Could not find a free address for this title: change the title.");
    const post = await db.blogPost.create({
      data: {
        storeId: ctx.store.id,
        slug,
        title: a.title,
        body: a.body,
        excerpt: a.excerpt || null,
        categoryId: category?.id ?? null,
        tags: parseTags((a.tags ?? []).join(",")),
        seoTitle: a.seo_title || null,
        seoDescription: a.seo_description || null,
        readingMinutes: readingMinutes(a.body),
        status: "DRAFT",
        createdById: ctx.actor.userId ?? null,
      },
      select: { id: true, slug: true },
    });
    await auditApi(ctx, "blog.post.created", post.id, { slug: post.slug, status: "DRAFT" });
    revalidate(ctx, "blog");
    return {
      text: `Draft "${a.title}" created (id: ${post.id}). It is NOT published: the merchant can review and publish it at /app/${ctx.store.id}/blog/${post.id}.`,
      data: { id: post.id, slug: post.slug, status: "DRAFT", edit_url: `/app/${ctx.store.id}/blog/${post.id}` },
    };
  },
});

export const BLOG_TOOLS: McpTool<Ctx>[] = [listBlogPosts, createBlogPost];
