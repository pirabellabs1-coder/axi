import "server-only";
import { db } from "@/lib/db";
import type { PickOption } from "./multi-picker";

export type PromoPickOptions = {
  products: PickOption[];
  collections: PickOption[];
  /** Variantes par produit (lots) : [{ id, label }]. */
  variants: Record<string, PickOption[]>;
};

/** Produits (hors archivés et cartes cadeaux) et collections de la boutique, pour les sélecteurs des formulaires. */
export async function loadPromoPickOptions(storeId: string): Promise<PromoPickOptions> {
  const [products, collections] = await Promise.all([
    db.product.findMany({
      where: { storeId, status: { not: "ARCHIVED" }, isGiftCard: false },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      take: 1000,
      select: { id: true, name: true, status: true, variants: { orderBy: { position: "asc" }, select: { id: true, name: true } } },
    }),
    db.category.findMany({ where: { storeId }, orderBy: { position: "asc" }, take: 300, select: { id: true, name: true } }),
  ]);
  return {
    products: products.map((p) => ({ id: p.id, label: p.name, hint: p.status === "DRAFT" ? "Brouillon" : undefined })),
    collections: collections.map((c) => ({ id: c.id, label: c.name })),
    variants: Object.fromEntries(products.filter((p) => p.variants.length).map((p) => [p.id, p.variants.map((v) => ({ id: v.id, label: v.name }))])),
  };
}
