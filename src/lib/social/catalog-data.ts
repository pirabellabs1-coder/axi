import "server-only";
import { db, type Tx } from "@/lib/db";
import type { SourceProduct } from "./feed-items";

/** Plafond de produits lus par flux ou synchronisation (une petite boutique en a quelques dizaines à centaines). */
export const MAX_FEED_PRODUCTS = 5000;

const PRODUCT_SELECT = {
  id: true, slug: true, name: true, description: true, price: true, compareAtPrice: true, promoPrice: true, promoStart: true, promoEnd: true,
  barcode: true, trackStock: true, stock: true, inventoryPolicy: true, images: true, vendor: true, categoryId: true, isGiftCard: true,
  variants: {
    select: { id: true, name: true, attributes: true, price: true, compareAtPrice: true, barcode: true, imageUrl: true, available: true, stock: true, inventoryPolicy: true },
    orderBy: { position: "asc" as const },
  },
};

/**
 * Catalogue PUBLIC d'une boutique : produits ACTIFS (hors cartes cadeaux) et collections publiées.
 * Toujours filtré par `storeId` ; aucune colonne privée sélectionnée (prix d'achat, SKU, étiquettes, notes).
 * `stock` n'est lu que pour calculer la disponibilité binaire ; il n'est jamais émis.
 */
export async function loadCatalogSource(storeId: string, client: Tx | typeof db = db): Promise<{ products: SourceProduct[]; categories: Map<string, string> }> {
  const [products, categories] = await Promise.all([
    client.product.findMany({
      where: { storeId, status: "ACTIVE", isGiftCard: false },
      select: PRODUCT_SELECT,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      take: MAX_FEED_PRODUCTS,
    }),
    client.category.findMany({ where: { storeId, published: true }, select: { id: true, name: true } }),
  ]);
  return {
    products: products.map((p) => ({ ...p, inventoryPolicy: String(p.inventoryPolicy), variants: p.variants.map((v) => ({ ...v, inventoryPolicy: String(v.inventoryPolicy) })) })),
    categories: new Map(categories.map((c) => [c.id, c.name])),
  };
}

/**
 * Adresse publique de la boutique pour les liens produits des catalogues : domaine personnalisé VÉRIFIÉ (principal
 * d'abord, comme la page « Partager »), sinon `${baseUrl}/s/{slug}`. Le protocole suit celui de l'application.
 * Meta (vente) et Google Merchant Center demandent des liens sur un domaine revendiqué par le marchand.
 */
export async function loadStoreUrl(store: { id: string; slug: string }, baseUrl: string, client: Tx | typeof db = db): Promise<string> {
  const domain = await client.domain.findFirst({
    where: { storeId: store.id, verified: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { hostname: true },
  });
  if (domain && /^[a-z0-9.-]{1,253}$/.test(domain.hostname)) return `${baseUrl.startsWith("https://") ? "https" : "http"}://${domain.hostname}`;
  return `${baseUrl}/s/${encodeURIComponent(store.slug)}`;
}
