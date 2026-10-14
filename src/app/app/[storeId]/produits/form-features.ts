import "server-only";
import type { Product, Variant, OptionGroup, Option } from "@prisma/client";
import { PLANS, PLAN_ORDER, type PlanId } from "@/config/plans";
import { db } from "@/lib/db";
import { readRules } from "@/lib/collections/rules";
import { storeLowStockThreshold as storeLowStockThresholdOf } from "@/lib/inventory/service";
import { optionsFromVariants, readOptions } from "@/lib/products/variants";
import type { DetailInput, ImageInput } from "@/lib/products/schemas";
import { productKindOf } from "@/lib/digital/kinds";
import type { CollectionChoice, ProductFormFeatures, ProductFormValues } from "./product-form";

/** Droits du plan utiles au formulaire produit (affichage ; le serveur reste l'autorité). */
export function productFormFeatures(planId: PlanId): ProductFormFeatures {
  const plan = PLANS[planId];
  return {
    stockTracking: plan.features.stockTracking,
    variants: plan.features.variants,
    options: plan.features.options,
    giftCards: plan.features.giftCards,
    digitalProducts: plan.features.digitalProducts,
    photosPerProduct: plan.limits.photosPerProduct,
    planName: plan.name,
    canUpgrade: PLAN_ORDER.indexOf(planId) < PLAN_ORDER.length - 1,
  };
}

/** Collections et suggestions (étiquettes, types, marques) de la boutique. */
export async function productFormContext(storeId: string): Promise<{ collections: CollectionChoice[]; suggestions: { tags: string[]; types: string[]; vendors: string[] }; storeLowStockThreshold: number }> {
  const [cols, meta, storeLowStockThreshold] = await Promise.all([
    db.category.findMany({ where: { storeId }, orderBy: { position: "asc" }, select: { id: true, name: true, rules: true } }),
    db.product.findMany({ where: { storeId }, select: { tags: true, productType: true, vendor: true }, take: 2000 }),
    storeLowStockThresholdOf(storeId),
  ]);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  return {
    collections: cols.map((c) => ({ id: c.id, name: c.name, auto: readRules(c.rules).type === "auto" })),
    suggestions: { tags: uniq(meta.flatMap((m) => m.tags)), types: uniq(meta.map((m) => m.productType)), vendors: uniq(meta.map((m) => m.vendor)) },
    storeLowStockThreshold,
  };
}

const toLocalInput = (d: Date | null) => {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

/** Produit en base → valeurs du formulaire (options reconstruites pour les produits anciens). */
export function productToFormValues(p: Product & { variants: Variant[]; optionGroups: (OptionGroup & { options: Option[] })[] }, collectionIds: string[]): ProductFormValues {
  const images = (Array.isArray(p.images) ? (p.images as unknown[]) : [])
    .filter((i): i is ImageInput => !!i && typeof i === "object" && typeof (i as ImageInput).url === "string")
    .map((i) => ({ url: i.url, alt: i.alt ?? "" }));
  let options = readOptions(p.options);
  if (options.length === 0 && p.variants.length > 0) options = optionsFromVariants(p.variants);
  const details = (Array.isArray(p.details) ? (p.details as unknown[]) : [])
    .filter((d): d is DetailInput => !!d && typeof d === "object" && typeof (d as DetailInput).title === "string")
    .map((d) => ({ title: d.title, body: typeof d.body === "string" ? d.body : "" }));
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description ?? "",
    status: p.status,
    isFeatured: p.isFeatured,
    categoryId: p.categoryId ?? "",
    collectionIds: collectionIds.filter((id) => id !== p.categoryId),
    productType: p.productType ?? "",
    vendor: p.vendor ?? "",
    tags: p.tags,
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    price: str(p.price),
    compareAtPrice: str(p.compareAtPrice),
    costPrice: str(p.costPrice),
    promoPrice: str(p.promoPrice),
    promoStart: toLocalInput(p.promoStart),
    promoEnd: toLocalInput(p.promoEnd),
    sku: p.sku ?? "",
    barcode: p.barcode ?? "",
    trackStock: p.trackStock,
    stock: str(p.stock),
    stockBase: p.stock,
    inventoryPolicy: p.inventoryPolicy,
    lowStockThreshold: str(p.lowStockThreshold),
    minQty: str(p.minQty),
    maxQty: str(p.maxQty),
    weightGrams: str(p.weightGrams),
    images,
    options,
    variants: p.variants.map((v) => {
      const raw = (v.attributes && typeof v.attributes === "object" ? v.attributes : {}) as Record<string, unknown>;
      const attributes = Object.fromEntries(options.map((o) => [o.name, typeof raw[o.name] === "string" ? (raw[o.name] as string) : ""]));
      return { id: v.id, attributes, price: v.price, compareAtPrice: v.compareAtPrice, sku: v.sku, barcode: v.barcode, stock: v.stock, stockBase: v.stock, weightGrams: v.weightGrams, imageUrl: v.imageUrl, available: v.available, inventoryPolicy: v.inventoryPolicy };
    }),
    optionGroups: p.optionGroups.map((g) => ({ id: g.id, name: g.name, required: g.required, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta })) })),
    details,
    isGiftCard: p.isGiftCard,
    giftCardValidityDays: str(p.giftCardValidityDays),
    // Vague 2 : nature et réglages numériques / services.
    kind: productKindOf(p),
    downloadLimit: str(p.downloadLimit),
    downloadValidityDays: str(p.downloadValidityDays),
    serviceDurationMinutes: str(p.serviceDurationMinutes),
    serviceLocation: p.serviceLocation ?? "",
    serviceRemote: p.serviceRemote,
    serviceBookingNote: p.serviceBookingNote ?? "",
    postPurchaseInstructions: p.postPurchaseInstructions ?? "",
  };
}
