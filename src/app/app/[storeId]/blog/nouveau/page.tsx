import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { PlanGate } from "@/components/app/plan-gate";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { blogPlan } from "@/lib/blog/service";
import { PostEditor } from "../post-editor";
import { editorData } from "../editor-data";

export const metadata: Metadata = { title: "Nouvel article" };

export default async function NewPostPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const back = { href: `/app/${store.id}/blog`, label: "Blog" };
  const plan = blogPlan(ctx.planId);
  if (!plan.enabled) {
    return (
      <>
        <PageHeader title="Nouvel article" back={back} />
        <PlanGate storeId={store.id} feature="blog" title="Blog de la boutique" />
      </>
    );
  }
  if (plan.limit !== null && (await db.blogPost.count({ where: { storeId: store.id } })) >= plan.limit) {
    return (
      <>
        <PageHeader title="Nouvel article" back={back} />
        <Alert tone="info" title="Limite d'articles atteinte">
          Votre plan inclut {plan.limit} articles. Archivez ou supprimez un article, ou passez au plan Business pour des articles illimités.
        </Alert>
        <ButtonLink href={`/app/${store.id}/abonnement`} variant="outline" className="mt-4">
          Voir les plans
        </ButtonLink>
      </>
    );
  }
  const d = await editorData(store.id, ctx.planId, store.timezone);
  return (
    <>
      <PageHeader title="Nouvel article" back={back} />
      <PostEditor
        storeId={store.id}
        storeSlug={store.slug}
        timezone={d.timezone}
        categories={d.categories}
        ai={d.ai}
        minSchedule={d.minSchedule}
        post={{ title: "", slug: "", excerpt: "", body: "", coverUrl: "", coverAlt: "", categoryId: "", tags: "", authorName: ctx.user.name ?? "", seoTitle: "", seoDescription: "", status: "DRAFT", scheduledLocal: d.defaultSchedule }}
      />
    </>
  );
}
