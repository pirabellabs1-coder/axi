import "server-only";
import { db } from "@/lib/db";
import type { CollectionProductLite } from "./collection-form";

/** Produits (allégés) de la boutique pour l'éditeur de collection : recherche et aperçu des règles côté client. */
export async function collectionEditorProducts(storeId: string): Promise<CollectionProductLite[]> {
  const products = await db.product.findMany({
    where: { storeId, status: { not: "ARCHIVED" } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    take: 2000,
    select: { id: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, compareAtPrice: true, tags: true, productType: true, vendor: true, categoryId: true, createdAt: true, position: true, status: true, images: true, variants: { select: { price: true, compareAtPrice: true } } },
  });
  return products.map((p) => {
    const img = Array.isArray(p.images) ? (p.images as { url?: string }[])[0]?.url : undefined;
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      promoPrice: p.promoPrice,
      promoStart: p.promoStart?.toISOString() ?? null,
      promoEnd: p.promoEnd?.toISOString() ?? null,
      compareAtPrice: p.compareAtPrice,
      tags: p.tags,
      productType: p.productType,
      vendor: p.vendor,
      categoryId: p.categoryId,
      createdAt: p.createdAt.toISOString(),
      position: p.position,
      status: p.status,
      variants: p.variants,
      thumb: typeof img === "string" ? img : null,
    };
  });
}
