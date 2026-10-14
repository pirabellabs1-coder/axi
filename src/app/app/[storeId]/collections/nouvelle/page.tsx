import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/misc";
import { CollectionForm } from "../collection-form";
import { collectionEditorProducts } from "../data";

export const metadata: Metadata = { title: "Nouvelle collection" };

export default async function NewCollectionPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const products = await collectionEditorProducts(ctx.store.id);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader back={{ href: `/app/${ctx.store.id}/collections`, label: "Collections" }} title="Créer une collection" description="Regroupez vos produits par thème, saison ou occasion : manuellement ou avec des conditions." />
      <CollectionForm
        storeId={ctx.store.id}
        storeSlug={ctx.store.slug}
        currency={ctx.store.currency}
        products={products}
        initial={{ name: "", slug: "", description: "", imageUrl: null, seoTitle: "", seoDescription: "", published: true, sortOrder: "manual", type: "manual", match: "all", conditions: [], productIds: [] }}
      />
    </div>
  );
}
