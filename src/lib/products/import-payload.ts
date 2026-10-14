/**
 * Import CSV : brouillon parsé → charge utile du formulaire produit. Module pur (tests/catalog-import-merge.test.ts).
 *
 * Création : la ligne CSV décrit le produit entier.
 * Mise à jour (`existing` fourni) : on part de la fiche existante et seules les colonnes associées ET non vides
 * remplacent les valeurs. Promo, vedette, quantités min/max, onglets de détails, collections manuelles, suppléments
 * et images (y compris data-URL) sont conservés quand le CSV ne les fournit pas. Le stock donné par le CSV est une
 * valeur absolue (sans `stockBase` : le serveur applique le delta par rapport à la valeur lue en transaction) ;
 * stock absent ⇒ `stock = stockBase` ⇒ aucun mouvement.
 */
import { slugify } from "@/lib/utils";
import type { DetailInput, ImageInput, ProductPayload, VariantInput } from "./schemas";
import type { CsvColumn, ImportDraft } from "./csv-catalog";
import { attrKey, optionsFromVariants, readOptions, type ProductOption } from "./variants";

export type ImportExisting = {
  id: string;
  description: string | null;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  isFeatured: boolean;
  categoryId: string | null;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  promoPrice: number | null;
  promoStart: Date | null;
  promoEnd: Date | null;
  sku: string | null;
  barcode?: string | null;
  trackStock: boolean;
  stock: number;
  inventoryPolicy?: "DENY" | "CONTINUE";
  lowStockThreshold?: number | null;
  minQty: number;
  maxQty: number | null;
  weightGrams: number | null;
  images: unknown;
  options: unknown;
  details: unknown;
  variants: { id: string; attributes: unknown; price: number | null; compareAtPrice: number | null; sku: string | null; barcode: string | null; stock: number; weightGrams: number | null; imageUrl: string | null; available: boolean; inventoryPolicy?: "DENY" | "CONTINUE" }[];
  /** Collections MANUELLES dont `rules.productIds` contient le produit. */
  manualCollectionIds: string[];
  /** Vague 2 : nature actuelle du produit. */
  kind?: "PHYSICAL" | "DIGITAL" | "SERVICE" | "GIFT_CARD";
};

type CollectionRef = { id: string; name: string; slug: string };

function readImages(raw: unknown): ImageInput[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((i): i is { url: string; alt?: unknown } => !!i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string")
    .map((i) => ({ url: i.url, alt: typeof i.alt === "string" ? i.alt : "" }));
}

function readDetails(raw: unknown): DetailInput[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((d): d is { title: string; body?: unknown } => !!d && typeof d === "object" && typeof (d as { title?: unknown }).title === "string")
    .map((d) => ({ title: d.title, body: typeof d.body === "string" ? d.body : "" }))
    .filter((d) => d.title.trim() && d.body.trim());
}

function readAttrs(raw: unknown, options: ProductOption[]): Record<string, string> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(options.map((o) => [o.name, typeof r[o.name] === "string" ? (r[o.name] as string) : ""]));
}

function findCollection(name: string | null, collections: CollectionRef[]): CollectionRef | null {
  if (!name) return null;
  return collections.find((c) => c.slug === slugify(name) || c.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/**
 * `warn` : avertissements non bloquants (ex. stock négatif réexporté alors que le stock a bougé depuis l'export).
 */
export function draftToPayload(p: ImportDraft, stockOk: boolean, collections: CollectionRef[], existing?: ImportExisting | null, warn: (message: string) => void = () => {}): ProductPayload {
  const col = findCollection(p.collection, collections);
  const newCollection = p.collection && !col ? p.collection.slice(0, 60) : null;
  const strip = ({ given: _g, ...v }: ImportDraft["variants"][number]) => (void _g, v);

  if (!existing) {
    const trackStock = stockOk && (p.variants.length ? true : p.stock != null);
    return {
      name: p.name,
      slug: p.handle,
      description: p.description ?? "",
      status: p.status,
      categoryId: col?.id ?? null,
      newCollection,
      collectionIds: [],
      productType: p.productType,
      vendor: p.vendor,
      tags: p.tags,
      seoTitle: p.seoTitle?.slice(0, 70) ?? null,
      seoDescription: p.seoDescription?.slice(0, 320) ?? null,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      costPrice: p.costPrice,
      sku: p.sku,
      barcode: p.barcode,
      trackStock,
      stock: p.stock ?? 0,
      inventoryPolicy: p.inventoryPolicy ?? "DENY",
      lowStockThreshold: p.lowStockThreshold,
      weightGrams: p.weightGrams,
      images: p.images.slice(0, 10),
      options: p.options,
      variants: p.variants.map((v) => ({ ...strip(v), stock: trackStock ? v.stock : 0 })),
      optionGroups: [],
      details: [],
      // Vague 2 : nature (colonne « Nature »), physique par défaut ; une carte cadeau garde son drapeau.
      ...(p.kind ? { kind: p.kind, isGiftCard: p.kind === "GIFT_CARD" } : {}),
    };
  }

  /* ── Mise à jour : fusion colonne par colonne ── */
  const has = (c: CsvColumn) => p.given.includes(c);
  const e = existing;
  const stockGiven = (has("stock") && p.stock != null) || p.variants.some((v) => v.given.includes("stock"));
  const trackStock = stockOk && (e.trackStock || stockGiven);

  let existingOptions = readOptions(e.options);
  if (existingOptions.length === 0 && e.variants.length > 0) existingOptions = optionsFromVariants(e.variants);

  let options: ProductOption[];
  let variants: VariantInput[];
  if (p.options.length > 0) {
    // Options du CSV ; pastilles et images des valeurs existantes conservées.
    options = p.options.map((o) => {
      const prev = existingOptions.find((x) => x.name === o.name);
      return {
        ...o,
        type: prev?.type ?? o.type,
        values: o.values.map((v) => {
          const pv = prev?.values.find((x) => x.value === v.value);
          return { ...v, ...(pv?.swatch ? { swatch: pv.swatch } : {}), ...(pv?.image ? { image: pv.image } : {}) };
        }),
      };
    });
    const byKey = new Map(e.variants.map((v) => [attrKey(readAttrs(v.attributes, options), options), v]));
    variants = p.variants.map((cv) => {
      const g = (c: CsvColumn) => cv.given.includes(c);
      const ev = byKey.get(attrKey(cv.attributes, options));
      // Stock inchangé (colonne absente, ou même valeur que la base) : aucun mouvement, même si la valeur est négative.
      // Valeur NÉGATIVE différente de l'actuelle (survente qui a bougé depuis l'export) : on ne la saisit pas, on garde
      // le stock actuel et on prévient (un stock négatif ne se fixe jamais par import).
      const negativeMoved = !!ev && g("stock") && cv.stock < 0 && cv.stock !== ev.stock;
      if (negativeMoved) warn(`Stock ${cv.stock} ignoré pour « ${p.name} » (${Object.values(cv.attributes).join(" / ")}) : le stock a changé depuis l'export (actuel : ${ev!.stock}). Ajustez-le depuis l'inventaire.`);
      const keepStock = !!ev && (!g("stock") || cv.stock === ev.stock || negativeMoved);
      return {
        id: ev?.id,
        attributes: cv.attributes,
        price: cv.price,
        compareAtPrice: g("compareAt") ? cv.compareAtPrice : (ev?.compareAtPrice ?? null),
        sku: cv.sku ?? ev?.sku ?? null,
        barcode: cv.barcode ?? ev?.barcode ?? null,
        weightGrams: cv.weightGrams ?? ev?.weightGrams ?? null,
        imageUrl: cv.imageUrl ?? ev?.imageUrl ?? null,
        available: g("available") ? cv.available : (ev?.available ?? true),
        inventoryPolicy: g("inventoryPolicy") && cv.inventoryPolicy ? cv.inventoryPolicy : (ev?.inventoryPolicy ?? "DENY"),
        stock: !trackStock ? 0 : keepStock ? ev!.stock : cv.stock,
        stockBase: keepStock ? ev!.stock : null,
      };
    });
  } else if (e.variants.length > 0) {
    // Pas de colonnes d'options : les variantes existantes restent telles quelles (stock inchangé).
    options = existingOptions;
    variants = e.variants.map((v) => ({
      id: v.id,
      attributes: readAttrs(v.attributes, existingOptions),
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      sku: v.sku,
      barcode: v.barcode,
      weightGrams: v.weightGrams,
      imageUrl: v.imageUrl,
      available: v.available,
      inventoryPolicy: v.inventoryPolicy ?? "DENY",
      stock: v.stock,
      stockBase: v.stock,
    }));
  } else {
    options = [];
    variants = [];
  }

  // Même valeur que l'existant : traité comme inchangé (pas de mouvement ; une survente réexportée reste acceptée).
  // Valeur négative différente de l'actuelle : ignorée avec avertissement (le stock a bougé depuis l'export).
  const simpleNegativeMoved = has("stock") && p.stock != null && p.stock < 0 && p.stock !== e.stock;
  if (simpleNegativeMoved) warn(`Stock ${p.stock} ignoré pour « ${p.name} » : le stock a changé depuis l'export (actuel : ${e.stock}). Ajustez-le depuis l'inventaire.`);
  const simpleStockGiven = has("stock") && p.stock != null && p.stock !== e.stock && !simpleNegativeMoved;
  const categoryId = has("collection") ? (col?.id ?? null) : e.categoryId;
  const images = p.images.length ? p.images.slice(0, 10) : readImages(e.images).slice(0, 10);
  return {
    productId: e.id,
    name: p.name,
    slug: p.handle,
    description: p.description ?? e.description ?? "",
    status: has("status") ? p.status : e.status,
    isFeatured: e.isFeatured,
    categoryId,
    newCollection: has("collection") ? newCollection : null,
    collectionIds: e.manualCollectionIds.filter((id) => id !== categoryId),
    productType: p.productType ?? e.productType,
    vendor: p.vendor ?? e.vendor,
    tags: p.tags.length ? p.tags : e.tags,
    seoTitle: (p.seoTitle ?? e.seoTitle)?.slice(0, 70) ?? null,
    seoDescription: (p.seoDescription ?? e.seoDescription)?.slice(0, 320) ?? null,
    price: p.price,
    compareAtPrice: p.compareAtPrice ?? e.compareAtPrice,
    costPrice: p.costPrice ?? e.costPrice,
    promoPrice: e.promoPrice,
    promoStart: e.promoStart?.toISOString() ?? null,
    promoEnd: e.promoEnd?.toISOString() ?? null,
    sku: p.sku ?? e.sku,
    barcode: p.barcode ?? e.barcode ?? null,
    trackStock,
    stock: simpleStockGiven ? p.stock! : e.stock,
    stockBase: simpleStockGiven ? null : e.stock,
    inventoryPolicy: p.inventoryPolicy ?? e.inventoryPolicy ?? "DENY",
    lowStockThreshold: has("lowStock") ? p.lowStockThreshold : (e.lowStockThreshold ?? null),
    minQty: e.minQty,
    maxQty: e.maxQty,
    weightGrams: p.weightGrams ?? e.weightGrams,
    images,
    options,
    variants,
    optionGroups: [],
    details: readDetails(e.details),
    // Vague 2 : nature seulement si la colonne est fournie et lisible ; sinon inchangée.
    ...(has("kind") && p.kind ? { kind: p.kind, isGiftCard: p.kind === "GIFT_CARD" } : {}),
  };
}
