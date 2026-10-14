import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { readRules, readSortOrder } from "@/lib/collections/rules";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { CollectionForm } from "../collection-form";
import { MetafieldsEditor } from "@/components/app/metafields-editor";
import { collectionEditorProducts } from "../data";

export const metadata: Metadata = { title: "Collection" };

export default async function EditCollectionPage({ params }: { params: Promise<{ storeId: string; collectionId: string }> }) {
  const { storeId, collectionId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const col = await db.category.findFirst({ where: { id: collectionId, storeId: ctx.store.id } });
  if (!col) notFound();
  const products = await collectionEditorProducts(ctx.store.id);
  const rules = readRules(col.rules);
  // Collection manuelle : liste ordonnée + produits rattachés par la catégorie principale (anciens produits).
  const productIds =
    rules.type === "manual"
      ? [...rules.productIds.filter((id) => products.some((p) => p.id === id)), ...products.filter((p) => p.categoryId === col.id && !rules.productIds.includes(p.id)).map((p) => p.id)]
      : [];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        back={{ href: `/app/${ctx.store.id}/collections`, label: "Collections" }}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {col.name}
            <Badge tone={col.published ? "success" : "neutral"} dot>
              {col.published ? "Publiée" : "Masquée"}
            </Badge>
          </span>
        }
      />
      <CollectionForm
        key={`${col.id}-${col.slug}-${JSON.stringify(col.rules)?.length ?? 0}-${col.sortOrder}`}
        storeId={ctx.store.id}
        storeSlug={ctx.store.slug}
        currency={ctx.store.currency}
        products={products}
        initial={{
          id: col.id,
          name: col.name,
          slug: col.slug,
          description: col.description ?? "",
          imageUrl: col.imageUrl,
          seoTitle: col.seoTitle ?? "",
          seoDescription: col.seoDescription ?? "",
          published: col.published,
          sortOrder: readSortOrder(col.sortOrder),
          type: rules.type,
          match: rules.type === "auto" ? rules.match : "all",
          conditions: rules.type === "auto" ? rules.conditions : [],
          productIds,
        }}
      />
      <MetafieldsEditor storeId={ctx.store.id} ownerType="COLLECTION" ownerId={col.id} />
    </div>
  );
}
