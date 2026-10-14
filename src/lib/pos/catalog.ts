import "server-only";
import { db } from "@/lib/db";
import { loadTaxSettings } from "@/lib/commerce/checkout-context";
import { loadActiveAutomaticDiscounts } from "@/lib/discounts/service";
import { effectivePlanId } from "@/lib/auth/permissions";
import { CASH_ROUNDING_STEP } from "./cash";

/**
 * Instantané du catalogue pour la caisse hors ligne (lot 3 §2) : produits actifs, variantes,
 * codes-barres, prix, stock DU DÉPÔT de l'appareil, remises automatiques et taux de TVA.
 * Il est versionné (`version`, `generatedAt`) et conservé dans IndexedDB ; au-delà de 72 h sans
 * synchronisation, l'appareil bloque la vente. Aucun prix client n'est accepté au retour : le serveur
 * recalcule tout (seule exception contrôlée : `priceSource = "offline_snapshot"`).
 */

const MAX_PRODUCTS = 2_000;

export type PosCatalogItem = {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  barcode: string | null;
  price: number;
  trackStock: boolean;
  available: number;
  taxable: boolean;
  taxCategory: string;
  imageUrl: string | null;
};

export type PosCatalogSnapshot = {
  version: string;
  generatedAt: string;
  storeId: string;
  storeName: string;
  currency: string;
  locationId: string;
  locationName: string;
  cashRoundingStep: number;
  taxesEnabled: boolean;
  pricesIncludeTax: boolean;
  taxRates: { name: string; rateBps: number; category: string }[];
  automaticDiscounts: { id: string; label: string; kind: string }[];
  items: PosCatalogItem[];
};

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const first = images[0] as { url?: unknown } | undefined;
  return first && typeof first.url === "string" ? first.url : null;
}

export async function buildCatalogSnapshot(p: { storeId: string; locationId: string }): Promise<PosCatalogSnapshot> {
  const store = await db.store.findUnique({ where: { id: p.storeId }, include: { subscription: true } });
  if (!store) throw new Error("Boutique introuvable");
  const location = await db.location.findFirst({ where: { id: p.locationId, storeId: p.storeId }, select: { id: true, name: true } });
  if (!location) throw new Error("Dépôt introuvable");

  const products = await db.product.findMany({
    where: { storeId: p.storeId, status: "ACTIVE", isGiftCard: false, kind: { in: ["PHYSICAL", "SERVICE"] } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    take: MAX_PRODUCTS,
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      price: true,
      promoPrice: true,
      promoStart: true,
      promoEnd: true,
      trackStock: true,
      taxable: true,
      taxCategory: true,
      images: true,
      variants: { where: { available: true }, select: { id: true, name: true, sku: true, barcode: true, price: true, imageUrl: true }, orderBy: { position: "asc" } },
    },
  });
  const levels = await db.inventoryLevel.findMany({ where: { storeId: p.storeId, locationId: p.locationId }, select: { itemKey: true, available: true } });
  const stock = new Map(levels.map((l) => [l.itemKey, l.available]));
  const now = new Date();
  const onPromo = (x: { promoPrice: number | null; promoStart: Date | null; promoEnd: Date | null }) =>
    x.promoPrice != null && (!x.promoStart || x.promoStart <= now) && (!x.promoEnd || x.promoEnd >= now);

  const items: PosCatalogItem[] = [];
  for (const product of products) {
    const base = onPromo(product) ? product.promoPrice! : product.price;
    if (!product.variants.length) {
      items.push({
        productId: product.id,
        variantId: null,
        name: product.name,
        variantName: null,
        sku: product.sku,
        barcode: product.barcode,
        price: base,
        trackStock: product.trackStock,
        available: stock.get(product.id) ?? 0,
        taxable: product.taxable !== false,
        taxCategory: product.taxCategory ?? "standard",
        imageUrl: firstImage(product.images),
      });
      continue;
    }
    for (const variant of product.variants) {
      items.push({
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        variantName: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        price: variant.price ?? base,
        trackStock: product.trackStock,
        available: stock.get(variant.id) ?? 0,
        taxable: product.taxable !== false,
        taxCategory: product.taxCategory ?? "standard",
        imageUrl: variant.imageUrl ?? firstImage(product.images),
      });
    }
  }

  const tax = await loadTaxSettings(db, store);
  const discounts = await loadActiveAutomaticDiscounts(store.id, effectivePlanId(store.subscription), now);
  return {
    version: `${now.getTime()}`,
    generatedAt: now.toISOString(),
    storeId: store.id,
    storeName: store.name,
    currency: store.currency,
    locationId: location.id,
    locationName: location.name,
    cashRoundingStep: CASH_ROUNDING_STEP,
    taxesEnabled: !!tax?.enabled,
    pricesIncludeTax: tax?.pricesIncludeTax ?? true,
    taxRates: (tax?.rates ?? []).map((r) => ({ name: r.name, rateBps: r.rateBps, category: r.taxCategory })),
    automaticDiscounts: discounts.map((d) => ({ id: d.id, label: d.title, kind: String(d.kind) })),
    items,
  };
}
