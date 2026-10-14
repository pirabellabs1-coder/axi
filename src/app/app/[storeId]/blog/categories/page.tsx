import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { PlanGate } from "@/components/app/plan-gate";
import { blogPlan } from "@/lib/blog/service";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "Catégories du blog" };

export default async function BlogCategoriesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const back = { href: `/app/${store.id}/blog`, label: "Blog" };
  if (!blogPlan(ctx.planId).enabled) {
    return (
      <>
        <PageHeader title="Catégories du blog" back={back} />
        <PlanGate storeId={store.id} feature="blog" title="Blog de la boutique" />
      </>
    );
  }
  const cats = await db.blogCategory.findMany({
    where: { storeId: store.id },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, description: true, _count: { select: { posts: true } } },
  });
  return (
    <>
      <PageHeader title="Catégories du blog" description="Regroupez vos articles. L'ordre choisi ici est celui du filtre sur votre blog." back={back} />
      <CategoryManager storeId={store.id} storeSlug={store.slug} categories={cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, description: c.description, posts: c._count.posts }))} />
    </>
  );
}
