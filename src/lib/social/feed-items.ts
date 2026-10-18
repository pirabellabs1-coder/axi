import { createHash } from "node:crypto";
import { effectivePrice } from "@/lib/commerce/pricing";
import { isBackorder, isSellable } from "@/lib/inventory/policy";
import { markdownToText } from "@/lib/products/markdown";
import { currencyDecimals } from "@/lib/money";
import { shareableImageUrl, storagePublicBase } from "@/lib/storage/public-url";
import { isLocalMediaPath, isValidMediaKey, MEDIA_ROUTE_PREFIX } from "@/lib/storage/keys";

/**
 * Articles de catalogue (flux publics Meta / Google / TikTok et synchronisation Graph API) : module PUR, testé dans
 * tests/social-feeds.test.ts. Une ligne par variante (`id` = variantId), ou par produit sans variante (`id` = productId).
 *
 * Règle de confidentialité : seules des informations DÉJÀ PUBLIQUES sur la boutique sont émises. Jamais de prix
 * d'achat, de quantité en stock, de SKU interne, d'étiquette, de note ni de produit non actif. La disponibilité est
 * binaire (en stock / rupture / précommande), comme sur la fiche produit.
 *
 * Spécifications de référence (consultées le 14/10/2026) : Google Merchant Center « Product data specification »
 * (support.google.com/merchants/answer/7052112), Meta « Product data specifications for catalogs »
 * (facebook.com/business/help/120325381656392) et « Product Catalog Items Batch » (API Graph), TikTok « Catalog
 * Product Parameters » (ads.tiktok.com/help/article/catalog-product-parameters). Détail : docs/SOCIAL-COMMERCE.md.
 */

export type AvailabilityState = "in_stock" | "out_of_stock" | "preorder";

/** Champs lus (sélection Prisma minimale, voir catalog-data.ts). */
export type SourceVariant = {
  id: string;
  name: string;
  attributes: unknown;
  price: number | null;
  compareAtPrice: number | null;
  barcode: string | null;
  imageUrl: string | null;
  available: boolean;
  stock: number;
  inventoryPolicy: string;
};

export type SourceProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  promoPrice: number | null;
  promoStart: Date | null;
  promoEnd: Date | null;
  barcode: string | null;
  trackStock: boolean;
  stock: number;
  inventoryPolicy: string;
  images: unknown;
  vendor: string | null;
  categoryId: string | null;
  isGiftCard: boolean;
  variants: SourceVariant[];
};

export type SourceStore = { slug: string; name: string; currency: string; status: string };

/**
 * Réglages d'un canal (SocialCatalogSync.settings), liste blanche.
 * `googleProductCategory` : catégorie de la taxonomie Google (identifiant numérique ou chemin complet), appliquée à
 * tout le catalogue ; lue par Google Merchant Center (donc les annonces YouTube), Meta et TikTok. Facultative.
 */
export type CatalogSettings = { includeOutOfStock: boolean; brand: string | null; googleProductCategory: string | null };

export const DEFAULT_SETTINGS: CatalogSettings = { includeOutOfStock: true, brand: null, googleProductCategory: null };

export type CatalogItem = {
  /** retailer_id envoyé à Meta : variantId ?? productId. */
  id: string;
  productId: string;
  variantId: string | null;
  /** Groupe d'articles (produit parent) : seulement pour les produits à variantes. */
  itemGroupId: string | null;
  title: string;
  description: string;
  link: string;
  /** Images d'origine (Google accepte JPEG, PNG, WebP, GIF…). */
  imageLink: string;
  additionalImageLinks: string[];
  /**
   * Mêmes images en JPEG/PNG pour Meta et TikTok, qui exigent ces formats : les photos téléversées (WebP par défaut)
   * passent par la conversion `/s/{slug}/feeds/img/{clé}.jpg` (voir feed-image.ts). Images externes : inchangées.
   */
  compatImageLink: string;
  compatAdditionalImageLinks: string[];
  brand: string;
  condition: "new";
  availability: AvailabilityState;
  /** Montant entier dans l'unité mineure de la devise (XOF : francs ; EUR : centimes). */
  price: number;
  salePrice: number | null;
  /** Période de la promotion (« début/fin », ISO 8601 à la minute, UTC), ou null. */
  salePriceEffectiveDate: string | null;
  currency: string;
  gtin: string | null;
  color: string | null;
  size: string | null;
  productType: string | null;
  googleProductCategory: string | null;
};

export type SkippedItem = { id: string; productId: string; title: string; reason: string };

export type BuildResult = { items: CatalogItem[]; skipped: SkippedItem[] };

const TITLE_MAX = 150; // Google : 150 ; Meta (flux) : 200 ; TikTok : non précisé
const DESCRIPTION_MAX = 5000; // Google : 5 000 ; Meta : 9 999 (flux) / 5 000 (items_batch)
const BRAND_MAX = 70; // Google : 70 ; Meta : 100
/** Google et TikTok : 10 images supplémentaires au plus (Meta en accepte 20). */
const MAX_ADDITIONAL_IMAGES = 10;
/** API Graph items_batch : titre limité à 100 caractères. */
export const META_BATCH_TITLE_MAX = 100;

/** Caractères interdits en XML 1.0 (contrôles, non-caractères) et surrogates isolés : retirés partout. */
const INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanText(raw: string | null | undefined, max: number): string {
  const t = (raw ?? "").replace(INVALID_CHARS, "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Description en texte brut : Markdown limité retiré, balises supprimées, espaces normalisés. */
export function cleanDescription(md: string | null | undefined, max = DESCRIPTION_MAX): string {
  if (!md) return "";
  return cleanText(markdownToText(md.replace(INVALID_CHARS, "")), max);
}

/** GTIN valide (EAN-8, UPC-A, EAN-13, GTIN-14) avec clé de contrôle ; null sinon (jamais de code inventé). */
export function validGtin(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return null;
  const digits = s.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? s : null;
}

/**
 * Prix au format des trois plateformes : nombre (point décimal, sans séparateur de milliers), espace, code ISO 4217.
 * « 18000 XOF », « 19.99 EUR », « 1500 JPY », « 12.345 KWD ». Les montants sont stockés en unités mineures.
 */
export function formatFeedPrice(amount: number, currency: string): string {
  const d = currencyDecimals(currency);
  const value = d === 0 ? String(Math.round(amount)) : (amount / 10 ** d).toFixed(d);
  return `${value} ${currency.toUpperCase()}`;
}

/**
 * Période de promotion au format commun aux trois plateformes (ISO 8601 à la minute, UTC) :
 * « 2026-10-01T00:00Z/2026-10-31T23:59Z » (Google : « YYYY-MM-DDThh:mmZ », 25 caractères au plus par date).
 */
export function formatEffectiveDate(start: Date, end: Date): string {
  const f = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;
  return `${f(start)}/${f(end)}`;
}

/** Clé de stockage d'un média téléversé (pilote local ou bucket), ou null pour une image externe. */
export function storedMediaKey(url: string, publicBase: string | null = storagePublicBase()): string | null {
  let key: string | null = null;
  if (isLocalMediaPath(url)) key = url.slice(MEDIA_ROUTE_PREFIX.length);
  else if (publicBase && url.startsWith(`${publicBase}/`)) key = url.slice(publicBase.length + 1);
  return key && isValidMediaKey(key) ? key : null;
}

/** Formats refusés par Meta et TikTok (JPEG ou PNG exigés). */
const NOT_JPEG_PNG = /\.(webp|avif|gif)$/;

type FeedImage = { url: string; compat: string };

function feedImage(raw: string, proxyBase: string): FeedImage | null {
  const url = shareableImageUrl(raw);
  if (!url) return null;
  const key = storedMediaKey(raw);
  return { url, compat: key && NOT_JPEG_PNG.test(key) ? `${proxyBase}/${key}.jpg` : url };
}

function imageUrls(raw: unknown, proxyBase: string): FeedImage[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedImage[] = [];
  for (const i of raw) {
    const img = i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string" ? feedImage((i as { url: string }).url, proxyBase) : null;
    if (img && !out.some((o) => o.url === img.url)) out.push(img);
  }
  return out;
}

const COLOR_KEYS = new Set(["couleur", "color", "colour", "coloris"]);
const SIZE_KEYS = new Set(["taille", "size", "pointure"]);

function variantAttribute(attributes: unknown, keys: Set<string>): string | null {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return null;
  for (const [k, v] of Object.entries(attributes as Record<string, unknown>)) {
    if (keys.has(k.trim().toLowerCase()) && typeof v === "string" && v.trim()) return cleanText(v, 100);
  }
  return null;
}

/** Prix affiché, prix barré éventuel et période de promotion (même règle que la fiche produit). */
export function itemPricing(p: SourceProduct, v: SourceVariant | null, now: Date): { price: number; salePrice: number | null; effective: string | null } {
  // Variante à prix propre : la promotion du produit ne s'applique pas (comme au panier).
  if (v && v.price != null) {
    const cmp = v.compareAtPrice;
    return cmp != null && cmp > v.price ? { price: cmp, salePrice: v.price, effective: null } : { price: v.price, salePrice: null, effective: null };
  }
  const eff = effectivePrice(p, now);
  if (eff.isPromo) {
    const start = p.promoStart ?? now;
    const effective = p.promoEnd ? formatEffectiveDate(start, p.promoEnd) : null;
    return { price: p.price, salePrice: eff.price, effective };
  }
  const cmp = v?.compareAtPrice ?? p.compareAtPrice;
  return cmp != null && cmp > p.price ? { price: cmp, salePrice: p.price, effective: null } : { price: p.price, salePrice: null, effective: null };
}

/** Disponibilité selon la politique de stock (jamais de quantité). Boutique fermée temporairement : rupture. */
export function itemAvailability(p: Pick<SourceProduct, "trackStock">, stock: { stock: number; inventoryPolicy: string; available?: boolean }, storeOpen: boolean): AvailabilityState {
  if (!storeOpen || stock.available === false) return "out_of_stock";
  const item = { trackStock: p.trackStock, stock: stock.stock, policy: stock.inventoryPolicy };
  if (!isSellable(item)) return "out_of_stock";
  return isBackorder(item) ? "preorder" : "in_stock";
}

/**
 * Catégorie Google : identifiant numérique (« 2271 ») ou chemin de la taxonomie
 * (« Apparel & Accessories > Clothing > Dresses »), 250 caractères au plus (limite Meta). Toute autre valeur est ignorée.
 */
export function cleanGoogleCategory(raw: string): string | null {
  const v = cleanText(raw, 250);
  if (/^\d{1,7}$/.test(v)) return v;
  const segment = "[\\p{L}\\p{N}][\\p{L}\\p{N} &,'()\\-]*";
  return new RegExp(`^${segment}( > ${segment})*$`, "u").test(v) ? v : null;
}

export function readSettings(raw: unknown): CatalogSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  const brand = typeof r.brand === "string" ? cleanText(r.brand, BRAND_MAX) : "";
  const gpc = typeof r.googleProductCategory === "string" ? cleanGoogleCategory(r.googleProductCategory) : null;
  return { includeOutOfStock: r.includeOutOfStock !== false, brand: brand || null, googleProductCategory: gpc };
}

/**
 * Articles du catalogue d'une boutique. `baseUrl` = origine publique de l'application (sans « / » final).
 * `storeUrl` = adresse publique de la boutique (domaine personnalisé vérifié, sinon `${baseUrl}/s/{slug}`) : Meta
 * (vente) et Google exigent des liens produits sur un domaine que le marchand peut revendiquer.
 * `categories` : collections PUBLIÉES (id → nom), seules utilisées comme type de produit.
 */
export function buildCatalogItems(input: {
  store: SourceStore;
  products: SourceProduct[];
  categories?: Map<string, string>;
  settings?: CatalogSettings;
  baseUrl: string;
  storeUrl?: string;
  now?: Date;
}): BuildResult {
  const { store, products, baseUrl } = input;
  const settings = input.settings ?? DEFAULT_SETTINGS;
  const now = input.now ?? new Date();
  const storeOpen = store.status === "PUBLISHED";
  const storeUrl = (input.storeUrl ?? `${baseUrl}/s/${encodeURIComponent(store.slug)}`).replace(/\/+$/, "");
  // Conversion JPEG servie par l'application (toujours sur l'origine Axi, quel que soit le domaine de la boutique).
  const proxyBase = `${baseUrl}/s/${encodeURIComponent(store.slug)}/feeds/img`;
  const items: CatalogItem[] = [];
  const skipped: SkippedItem[] = [];

  for (const p of products) {
    if (p.isGiftCard) continue; // cartes cadeaux : hors catalogues sociaux (politiques commerce Meta / Google)
    const title = cleanText(p.name, TITLE_MAX);
    const productImages = imageUrls(p.images, proxyBase);
    const link = `${storeUrl}/p/${encodeURIComponent(p.slug)}`;
    const description = cleanDescription(p.description) || title;
    const brand = settings.brand ?? (cleanText(p.vendor, BRAND_MAX) || cleanText(store.name, BRAND_MAX));
    const productType = p.categoryId ? (input.categories?.get(p.categoryId) ?? null) : null;

    const lines: { v: SourceVariant | null }[] = p.variants.length ? p.variants.map((v) => ({ v })) : [{ v: null }];
    for (const { v } of lines) {
      const id = v?.id ?? p.id;
      const fullTitle = v ? cleanText(`${p.name} (${v.name})`, TITLE_MAX) : title;
      const own = v?.imageUrl ? feedImage(v.imageUrl, proxyBase) : null;
      const images = own ? [own, ...productImages.filter((u) => u.url !== own.url)] : productImages;
      const pricing = itemPricing(p, v, now);
      const availability = itemAvailability(p, v ? { stock: v.stock, inventoryPolicy: v.inventoryPolicy, available: v.available } : { stock: p.stock, inventoryPolicy: p.inventoryPolicy }, storeOpen);

      if (pricing.price <= 0 || (pricing.salePrice != null && pricing.salePrice <= 0)) {
        skipped.push({ id, productId: p.id, title: fullTitle, reason: "Prix nul : les catalogues Meta et Google refusent les articles gratuits." });
        continue;
      }
      if (!images.length) {
        skipped.push({ id, productId: p.id, title: fullTitle, reason: "Aucune photo publique (https) : ajoutez une photo au produit." });
        continue;
      }
      if (availability === "out_of_stock" && !settings.includeOutOfStock) continue;

      const separator = link.includes("?") ? "&" : "?";
      const extra = images.slice(1, 1 + MAX_ADDITIONAL_IMAGES);
      items.push({
        id,
        productId: p.id,
        variantId: v?.id ?? null,
        itemGroupId: v ? p.id : null,
        title: fullTitle,
        description,
        link: v ? `${link}${separator}variant=${encodeURIComponent(v.id)}` : link,
        imageLink: images[0].url,
        additionalImageLinks: extra.map((i) => i.url),
        compatImageLink: images[0].compat,
        compatAdditionalImageLinks: extra.map((i) => i.compat),
        brand,
        condition: "new",
        availability,
        price: pricing.price,
        salePrice: pricing.salePrice,
        salePriceEffectiveDate: pricing.effective,
        currency: store.currency,
        gtin: validGtin(v ? (v.barcode ?? (p.variants.length === 1 ? p.barcode : null)) : p.barcode),
        color: v ? variantAttribute(v.attributes, COLOR_KEYS) : null,
        size: v ? variantAttribute(v.attributes, SIZE_KEYS) : null,
        productType,
        googleProductCategory: settings.googleProductCategory,
      });
    }
  }
  return { items, skipped };
}

/* ───────────────────────── Valeurs par plateforme ───────────────────────── */

/**
 * Disponibilité Meta (flux Commerce Manager et items_batch). La spécification des flux n'accepte que « in stock » /
 * « out of stock » : un article vendu en rupture (politique « continuer à vendre ») est réellement achetable, il est
 * donc publié « in stock ».
 */
export const META_AVAILABILITY: Record<AvailabilityState, string> = { in_stock: "in stock", out_of_stock: "out of stock", preorder: "in stock" };

/** Disponibilité TikTok Catalog : « available for order » = commandable, expédié plus tard. */
export const TIKTOK_AVAILABILITY: Record<AvailabilityState, string> = { in_stock: "in stock", out_of_stock: "out of stock", preorder: "available for order" };

/**
 * Disponibilité Google Merchant Center. « preorder » y exige `availability_date` (inconnue ici) ; la vente en rupture
 * d'Axi correspond à « backorder » (en rupture mais commandable).
 */
export const GOOGLE_AVAILABILITY: Record<AvailabilityState, string> = { in_stock: "in_stock", out_of_stock: "out_of_stock", preorder: "backorder" };

/* ───────────────────────── Données envoyées à l'API Graph (items_batch) ───────────────────────── */

export type MetaItemData = { id: string } & Record<string, string | string[]>;

/** Données d'un article pour `items_batch` (item_type PRODUCT_ITEM), mêmes champs que le flux RSS. */
export function toMetaItemData(item: CatalogItem): MetaItemData {
  const data: MetaItemData = {
    id: item.id,
    title: cleanText(item.title, META_BATCH_TITLE_MAX),
    description: item.description,
    availability: META_AVAILABILITY[item.availability],
    condition: item.condition,
    price: formatFeedPrice(item.price, item.currency),
    link: item.link,
    image_link: item.compatImageLink,
    brand: item.brand,
  };
  // items_batch : `additional_image_link` est un tableau JSON d'URL (pas une chaîne séparée par des virgules).
  if (item.compatAdditionalImageLinks.length) data.additional_image_link = item.compatAdditionalImageLinks;
  if (item.salePrice != null) data.sale_price = formatFeedPrice(item.salePrice, item.currency);
  if (item.salePriceEffectiveDate) data.sale_price_effective_date = item.salePriceEffectiveDate;
  if (item.itemGroupId) data.item_group_id = item.itemGroupId;
  if (item.gtin) data.gtin = item.gtin;
  if (item.color) data.color = item.color;
  if (item.size) data.size = item.size;
  if (item.productType) data.product_type = item.productType;
  if (item.googleProductCategory) data.google_product_category = item.googleProductCategory;
  return data;
}

/** Empreinte stable des champs envoyés (synchronisation incrémentale : SocialCatalogItem.contentHash). */
export function contentHash(data: MetaItemData): string {
  const canonical = JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]]));
  return createHash("sha256").update(canonical).digest("hex");
}
