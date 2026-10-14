import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { checkProductsQuota } from "@/lib/commerce/quotas";
import { PageHeader } from "@/components/ui/misc";
import { ProductForm } from "../product-form";
import { productFormContext, productFormFeatures } from "../form-features";

export const metadata: Metadata = { title: "Nouveau produit" };

export default async function NewProductPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ collection?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "products.manage");
  const quota = await checkProductsQuota(ctx.store.id, ctx.planId);
  if (!quota.allowed) redirect(`/app/${ctx.store.id}/abonnement?raison=produits`);
  const { collections, suggestions, storeLowStockThreshold } = await productFormContext(ctx.store.id);
  const preset = collections.find((c) => c.id === sp.collection && !c.auto);

  return (
    <div className="mx-auto max-w-6xl">
      {/* L'en-tête est rendu PAR le formulaire, sous l'étape « Que vendez-vous ? » (le type se choisit d'abord). */}
      <ProductForm
        header={
          <PageHeader
            back={{ href: `/app/${ctx.store.id}/produits`, label: "Produits" }}
            title="Ajouter un produit"
            description="Un titre, un prix et une photo suffisent pour commencer. Ajoutez des options pour les couleurs et tailles."
          />
        }
        storeId={ctx.store.id}
        storeSlug={ctx.store.slug}
        currency={ctx.store.currency}
        collections={collections}
        suggestions={suggestions}
        features={productFormFeatures(ctx.planId)}
        storeLowStockThreshold={storeLowStockThreshold}
        presetCollectionId={preset?.id}
      />
    </div>
  );
}
