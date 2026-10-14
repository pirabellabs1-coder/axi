import { createHash } from "node:crypto";
import { effectivePrice } from "@/lib/commerce/pricing";
import { isBackorder, isSellable } from "@/lib/inventory/policy";
import { markdownToText } from "@/lib/products/markdown";
import { currencyDecimals } from "@/lib/money";
import { shareableImageUrl } from "@/lib/storage/public-url";

/**
 * Articles de catalogue (flux publics Meta / Google / TikTok et synchronisation Graph API) : module PUR, testé dans
 * tests/social-feeds.test.ts. Une ligne par variante (`id` = variantId), ou par produit sans variante (`id` = productId).
 *
 * Règle de confidentialité : seules des informations DÉJÀ PUBLIQUES sur la boutique sont émises. Jamais de prix
 * d'achat, de quantité en stock, de SKU interne, d'étiquette, de note ni de produit non actif. La disponibilité est
 * binaire (en stock / rupture / précommande), comme sur la fiche produit.
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

/** Réglages d'un canal (SocialCatalogSync.settings), liste blanche. */
export type CatalogSettings = { includeOutOfStock: boolean; brand: string | null };

export const DEFAULT_SETTINGS: CatalogSettings = { includeOutOfStock: true, brand: null };

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
  imageLink: string;
  additionalImageLinks: string[];
  brand: string;
  condition: "new";
  availability: AvailabilityState;
  /** Montant entier dans l'unité de la devise (XOF : francs ; EUR : centimes). */
  price: number;
  salePrice: number | null;
  /** Période de la promotion (ISO 8601 « début/fin »), ou null. */
  salePriceEffectiveDate: string | null;
  currency: string;
  gtin: string | null;
  color: string | null;
  size: string | null;
  productType: string | null;
};

export type SkippedItem = { id: string; productId: string; title: string; reason: string };

export type BuildResult = { items: CatalogItem[]; skipped: SkippedItem[] };

const TITLE_MAX = 150;
const DESCRIPTION_MAX = 5000;
const BRAND_MAX = 70;
const MAX_ADDITIONAL_IMAGES = 10;

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

/** Prix au format des flux : « 18000 XOF », « 19.99 EUR ». */
export function formatFeedPrice(amount: number, currency: string): string {
  const d = currencyDecimals(currency);
  const value = d === 0 ? String(Math.round(amount)) : (amount / 10 ** d).toFixed(d);
  return `${value} ${currency}`;
}

function imageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const i of raw) {
    const url = i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string" ? shareableImageUrl((i as { url: string }).url) : undefined;
    if (url && !out.includes(url)) out.push(url);
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
    const effective = p.promoEnd ? `${start.toISOString()}/${p.promoEnd.toISOString()}` : null;
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

export function readSettings(raw: unknown): CatalogSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  const brand = typeof r.brand === "string" ? cleanText(r.brand, BRAND_MAX) : "";
  return { includeOutOfStock: r.includeOutOfStock !== false, brand: brand || null };
}

/**
 * Articles du catalogue d'une boutique. `baseUrl` = origine publique de l'application (sans « / » final).
 * `categories` : collections PUBLIÉES (id → nom), seules utilisées comme type de produit.
 */
export function buildCatalogItems(input: {
  store: SourceStore;
  products: SourceProduct[];
  categories?: Map<string, string>;
  settings?: CatalogSettings;
  baseUrl: string;
  now?: Date;
}): BuildResult {
  const { store, products, baseUrl } = input;
  const settings = input.settings ?? DEFAULT_SETTINGS;
  const now = input.now ?? new Date();
  const storeOpen = store.status === "PUBLISHED";
  const items: CatalogItem[] = [];
  const skipped: SkippedItem[] = [];

  for (const p of products) {
    if (p.isGiftCard) continue; // cartes cadeaux : hors catalogues sociaux (politiques commerce Meta / Google)
    const title = cleanText(p.name, TITLE_MAX);
    const productImages = imageUrls(p.images);
    const link = `${baseUrl}/s/${encodeURIComponent(store.slug)}/p/${encodeURIComponent(p.slug)}`;
    const description = cleanDescription(p.description) || title;
    const brand = settings.brand ?? (cleanText(p.vendor, BRAND_MAX) || cleanText(store.name, BRAND_MAX));
    const productType = p.categoryId ? (input.categories?.get(p.categoryId) ?? null) : null;

    const lines: { v: SourceVariant | null }[] = p.variants.length ? p.variants.map((v) => ({ v })) : [{ v: null }];
    for (const { v } of lines) {
      const id = v?.id ?? p.id;
      const fullTitle = v ? cleanText(`${p.name} (${v.name})`, TITLE_MAX) : title;
      const own = v?.imageUrl ? shareableImageUrl(v.imageUrl) : undefined;
      const images = own ? [own, ...productImages.filter((u) => u !== own)] : productImages;
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
      items.push({
        id,
        productId: p.id,
        variantId: v?.id ?? null,
        itemGroupId: v ? p.id : null,
        title: fullTitle,
        description,
        link: v ? `${link}${separator}variant=${encodeURIComponent(v.id)}` : link,
        imageLink: images[0],
        additionalImageLinks: images.slice(1, 1 + MAX_ADDITIONAL_IMAGES),
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
      });
    }
  }
  return { items, skipped };
}

/* ───────────────────────── Données envoyées à l'API Graph (items_batch) ───────────────────────── */

/** Libellés de disponibilité Meta (catalogue Commerce Manager / WhatsApp). */
export const META_AVAILABILITY: Record<AvailabilityState, string> = { in_stock: "in stock", out_of_stock: "out of stock", preorder: "preorder" };

export type MetaItemData = Record<string, string>;

/** Données d'un article pour `items_batch` (item_type PRODUCT_ITEM), mêmes champs que le flux RSS. */
export function toMetaItemData(item: CatalogItem): MetaItemData {
  const data: MetaItemData = {
    id: item.id,
    title: item.title,
    description: item.description,
    availability: META_AVAILABILITY[item.availability],
    condition: item.condition,
    price: formatFeedPrice(item.price, item.currency),
    link: item.link,
    image_link: item.imageLink,
    brand: item.brand,
  };
  if (item.additionalImageLinks.length) data.additional_image_link = item.additionalImageLinks.map((u) => u.replace(/,/g, "%2C")).join(",");
  if (item.salePrice != null) data.sale_price = formatFeedPrice(item.salePrice, item.currency);
  if (item.salePriceEffectiveDate) data.sale_price_effective_date = item.salePriceEffectiveDate;
  if (item.itemGroupId) data.item_group_id = item.itemGroupId;
  if (item.gtin) data.gtin = item.gtin;
  if (item.color) data.color = item.color;
  if (item.size) data.size = item.size;
  if (item.productType) data.product_type = item.productType;
  return data;
}

/** Empreinte stable des champs envoyés (synchronisation incrémentale : SocialCatalogItem.contentHash). */
export function contentHash(data: MetaItemData): string {
  const canonical = JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]]));
  return createHash("sha256").update(canonical).digest("hex");
}
