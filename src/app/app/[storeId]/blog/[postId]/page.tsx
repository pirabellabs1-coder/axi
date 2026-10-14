import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { PlanGate } from "@/components/app/plan-gate";
import { blogPlan, coverOf } from "@/lib/blog/service";
import { utcToZonedLocal } from "@/lib/blog/visibility";
import type { BlogStatus } from "@/lib/blog/constants";
import { PostEditor } from "../post-editor";
import { editorData } from "../editor-data";

export const metadata: Metadata = { title: "Modifier l'article" };

export default async function EditPostPage({ params }: { params: Promise<{ storeId: string; postId: string }> }) {
  const { storeId, postId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const post = await db.blogPost.findFirst({ where: { id: postId, storeId: store.id } });
  if (!post) notFound();
  const back = { href: `/app/${store.id}/blog`, label: "Blog" };
  if (!blogPlan(ctx.planId).enabled) {
    return (
      <>
        <PageHeader title={post.title} back={back} />
        <PlanGate storeId={store.id} feature="blog" title="Blog de la boutique" description="Vos articles sont conservés mais masqués de la boutique. Passez au plan Starter pour les modifier et les publier à nouveau." />
      </>
    );
  }
  const d = await editorData(store.id, ctx.planId, store.timezone);
  const cover = coverOf(post.coverImage);
  return (
    <>
      <PageHeader
        title={post.title}
        back={back}
        actions={
          <ButtonLink href={`/s/${store.slug}/blog/${post.slug}`} target="_blank" variant="outline" trailing={ExternalLink}>
            {post.status === "PUBLISHED" ? "Voir l'article" : "Aperçu"}
          </ButtonLink>
        }
      />
      <PostEditor
        key={post.updatedAt.toISOString()}
        storeId={store.id}
        storeSlug={store.slug}
        timezone={d.timezone}
        categories={d.categories}
        ai={d.ai}
        minSchedule={d.minSchedule}
        post={{
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt ?? "",
          body: post.body,
          coverUrl: cover?.url ?? "",
          coverAlt: cover?.alt ?? "",
          categoryId: post.categoryId ?? "",
          tags: post.tags.join(", "),
          authorName: post.authorName ?? "",
          seoTitle: post.seoTitle ?? "",
          seoDescription: post.seoDescription ?? "",
          status: post.status as BlogStatus,
          scheduledLocal: post.status === "SCHEDULED" && post.publishedAt ? utcToZonedLocal(post.publishedAt, d.timezone) : d.defaultSchedule,
        }}
      />
    </>
  );
}
