import { db } from "@/lib/db";
import { requireStore, planFeature, AuthError } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { toCsv, csvResponse } from "@/lib/csv";
import { exportCatalogRows } from "@/lib/products/csv-catalog";
import { optionsFromVariants, readOptions } from "@/lib/products/variants";
import { productMetafieldCsv } from "@/lib/metafields/csv-server";
import { productKindOf } from "@/lib/digital/kinds";

/** Export du catalogue, une ligne par variante (réimportable tel quel). `?ids=a,b` limite à une sélection. */
export async function GET(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  try {
    const ctx = await requireStore(storeId, "export");
    if (!planFeature(ctx.planId, "csvExport")) return new Response("L'export CSV n'est pas inclus dans votre plan.", { status: 403 });
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter((x) => /^[a-z0-9]{8,64}$/i.test(x)).slice(0, 500);
    const products = await db.product.findMany({
      where: { storeId: ctx.store.id, ...(ids.length ? { id: { in: ids } } : {}) },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { category: { select: { name: true } }, variants: { orderBy: { position: "asc" } } },
    });
    // Lot 4 : champs personnalisés produit en colonnes `metafield:{namespace}.{key}`.
    const mf = await productMetafieldCsv(ctx.store.id, products.map((p) => p.id));
    const { headers, rows } = exportCatalogRows(
      products.map((p) => {
        let options = readOptions(p.options);
        if (options.length === 0 && p.variants.length) options = optionsFromVariants(p.variants);
        return {
          slug: p.slug,
          name: p.name,
          description: p.description,
          vendor: p.vendor,
          productType: p.productType,
          tags: p.tags,
          status: p.status,
          collection: p.category?.name ?? null,
          kind: productKindOf(p),
          seoTitle: p.seoTitle,
          seoDescription: p.seoDescription,
          price: p.price,
          compareAtPrice: p.compareAtPrice,
          costPrice: p.costPrice,
          sku: p.sku,
          barcode: p.barcode,
          trackStock: p.trackStock,
          stock: p.stock,
          inventoryPolicy: p.inventoryPolicy,
          lowStockThreshold: p.lowStockThreshold,
          weightGrams: p.weightGrams,
          images: Array.isArray(p.images) ? (p.images as { url: string; alt?: string }[]).filter((i) => i && typeof i.url === "string") : [],
          options,
          variants: p.variants.map((v) => ({ attributes: (v.attributes ?? {}) as Record<string, string>, price: v.price, compareAtPrice: v.compareAtPrice, sku: v.sku, barcode: v.barcode, stock: v.stock, weightGrams: v.weightGrams, imageUrl: v.imageUrl, available: v.available, inventoryPolicy: v.inventoryPolicy })),
          extra: mf.cells.get(p.id),
        };
      }),
      mf.headers,
    );
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "products.exported", metadata: { count: products.length } });
    return csvResponse(`produits-${ctx.store.slug}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.code === "UNAUTHENTICATED" ? 401 : 403 });
    throw e;
  }
}
