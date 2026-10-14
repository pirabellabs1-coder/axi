import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Boxes, ExternalLink } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { collectionsByProduct } from "@/lib/collections/service";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { ProductRowActions } from "../row-actions";
import { ProductForm } from "../product-form";
import { MetafieldsEditor } from "@/components/app/metafields-editor";
import { ProductTaxFields } from "@/lib/tax/product-tax-fields";
import { productFormContext, productFormFeatures, productToFormValues } from "../form-features";
import { listProductAssets } from "@/lib/digital/service";

export const metadata: Metadata = { title: "Modifier le produit" };

const STATUS = {
  ACTIVE: { label: "Actif", tone: "success" },
  DRAFT: { label: "Brouillon", tone: "neutral" },
  ARCHIVED: { label: "Archivé", tone: "warning" },
} as const;

export default async function EditProductPage({ params }: { params: Promise<{ storeId: string; productId: string }> }) {
  const { storeId, productId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const product = await db.product.findFirst({
    where: { id: productId, storeId: ctx.store.id },
    include: { variants: { orderBy: { position: "asc" } }, optionGroups: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
  });
  if (!product) notFound();
  const [{ collections, suggestions, storeLowStockThreshold }, membership, digitalAssets] = await Promise.all([
    productFormContext(ctx.store.id),
    collectionsByProduct(ctx.store.id, [product.id]),
    // Vague 2 : fichiers vendus du produit (affichés dans la carte « Fichiers à remettre »).
    listProductAssets(ctx.store.id, product.id),
  ]);
  const member = membership.get(product.id) ?? [];
  const autoIds = new Set(collections.filter((c) => c.auto).map((c) => c.id));
  const initial = productToFormValues(
    product,
    member.filter((m) => !autoIds.has(m.id)).map((m) => m.id),
    ctx.store.currency,
  );
  const base = `/app/${ctx.store.id}`;
  const st = STATUS[product.status];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        back={{ href: `${base}/produits`, label: "Produits" }}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="min-w-0 [overflow-wrap:anywhere]">{product.name}</span>
            <Badge tone={st.tone} dot>
              {st.label}
            </Badge>
          </span>
        }
        description={`Modifié le ${formatDateTime(product.updatedAt)}`}
        actions={
          <>
            {product.status === "ACTIVE" && (
              <ButtonLink href={`/s/${ctx.store.slug}/p/${product.slug}`} target="_blank" rel="noopener" variant="ghost">
                <ExternalLink className="size-4" aria-hidden /> Voir en boutique
              </ButtonLink>
            )}
            {product.trackStock && (
              <ButtonLink href={`${base}/produits/${product.id}/stock`} variant="outline">
                <Boxes className="size-4" aria-hidden /> Stock
              </ButtonLink>
            )}
            <ProductRowActions storeId={ctx.store.id} productId={product.id} name={product.name} status={product.status} isFeatured={product.isFeatured} trackStock={product.trackStock} />
          </>
        }
      />
      <ProductForm
        key={product.updatedAt.toISOString()}
        storeId={ctx.store.id}
        storeSlug={ctx.store.slug}
        currency={ctx.store.currency}
        collections={collections}
        autoCollections={member.filter((m) => autoIds.has(m.id)).map((m) => m.name)}
        suggestions={suggestions}
        initial={initial}
        features={productFormFeatures(ctx.planId)}
        storeLowStockThreshold={storeLowStockThreshold}
        digitalAssets={digitalAssets.map((a) => ({ id: a.id, name: a.name, variantId: a.variantId, bytes: a.bytes, mime: a.mime, version: a.version, position: a.position }))}
      />
      {/* Lot 2 : fiscalité du produit (enregistrée immédiatement ; carte cadeau toujours exonérée). */}
      {!product.isGiftCard && <ProductTaxFields storeId={ctx.store.id} productId={product.id} taxable={product.taxable} taxCategory={product.taxCategory} />}
      <MetafieldsEditor storeId={ctx.store.id} ownerType="PRODUCT" ownerId={product.id} />
    </div>
  );
}
