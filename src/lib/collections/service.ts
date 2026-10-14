import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { readRules, readSortOrder, resolveCollection, type CollectionRules, type SortOrder } from "./rules";

/**
 * Verrouille les collections de la boutique (`SELECT … FOR UPDATE`) avant une lecture-modification-écriture de
 * `Category.rules.productIds` : deux enregistrements concurrents ne peuvent plus s'écraser mutuellement.
 * À appeler en DÉBUT de transaction (ordre de verrouillage constant : collections, puis produits).
 */
export async function lockStoreCategories(tx: Tx, storeId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Category" WHERE "storeId" = ${storeId} FOR UPDATE`;
}

/** Champs produit renvoyés par `getCollectionProducts` (prêts pour une grille de boutique). */
export const collectionProductSelect = {
  id: true,
  name: true,
  slug: true,
  price: true,
  compareAtPrice: true,
  promoPrice: true,
  promoStart: true,
  promoEnd: true,
  images: true,
  tags: true,
  productType: true,
  vendor: true,
  categoryId: true,
  isFeatured: true,
  trackStock: true,
  stock: true,
  status: true,
  position: true,
  createdAt: true,
  options: true,
  variants: { orderBy: { position: "asc" }, select: { id: true, name: true, attributes: true, price: true, compareAtPrice: true, stock: true, imageUrl: true, available: true } },
} satisfies Prisma.ProductSelect;

export type CollectionProduct = Prisma.ProductGetPayload<{ select: typeof collectionProductSelect }>;

/** Ventes par produit (quantités, commandes non annulées) — pour le tri « meilleures ventes ». */
async function salesByProduct(storeId: string, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.orderItem.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, order: { storeId, status: { notIn: ["CANCELLED"] } } },
    _sum: { quantity: true },
  });
  return new Map(rows.filter((r) => r.productId).map((r) => [r.productId as string, r._sum.quantity ?? 0]));
}

/**
 * Produits d'une collection, filtrés (actifs par défaut) et triés selon le réglage de la collection.
 * Utilisé par la boutique publique et l'espace marchand. Toujours isolé par `storeId`.
 */
export async function getCollectionProducts(
  storeId: string,
  collectionId: string,
  opts: { includeInactive?: boolean; limit?: number; sortOrder?: SortOrder } = {},
): Promise<{ collection: { id: string; name: string; slug: string; rules: CollectionRules; sortOrder: SortOrder; published: boolean }; products: CollectionProduct[] } | null> {
  const col = await db.category.findFirst({ where: { id: collectionId, storeId }, select: { id: true, name: true, slug: true, rules: true, sortOrder: true, published: true } });
  if (!col) return null;
  const rules = readRules(col.rules);
  const sortOrder = opts.sortOrder ?? readSortOrder(col.sortOrder);
  const statusWhere: Prisma.ProductWhereInput = opts.includeInactive ? { status: { not: "ARCHIVED" } } : { status: "ACTIVE" };
  const where: Prisma.ProductWhereInput =
    rules.type === "manual"
      ? { storeId, ...statusWhere, OR: [{ categoryId: col.id }, ...(rules.productIds.length ? [{ id: { in: rules.productIds } }] : [])] }
      : { storeId, ...statusWhere };
  const candidates = await db.product.findMany({ where, select: collectionProductSelect, take: 2000 });
  const sales = sortOrder === "best_selling" ? await salesByProduct(storeId, candidates.map((p) => p.id)) : undefined;
  const products = resolveCollection(col.id, rules, sortOrder, candidates, { sales });
  return { collection: { ...col, rules, sortOrder }, products: opts.limit ? products.slice(0, opts.limit) : products };
}

/** Ids des collections (manuelles et automatiques) auxquelles appartient chaque produit. */
export async function collectionsByProduct(storeId: string, productIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>(productIds.map((id) => [id, []]));
  if (productIds.length === 0) return out;
  const [cols, products] = await Promise.all([
    db.category.findMany({ where: { storeId }, orderBy: { position: "asc" }, select: { id: true, name: true, rules: true } }),
    db.product.findMany({ where: { storeId, id: { in: productIds } }, select: { id: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, compareAtPrice: true, tags: true, productType: true, vendor: true, categoryId: true, variants: { select: { price: true, compareAtPrice: true } } } }),
  ]);
  for (const c of cols) {
    const members = resolveCollection(c.id, readRules(c.rules), "manual", products);
    for (const m of members) out.get(m.id)?.push({ id: c.id, name: c.name });
  }
  return out;
}
