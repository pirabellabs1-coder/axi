import { formatFeedPrice, META_AVAILABILITY, cleanText, type AvailabilityState, type CatalogItem } from "./feed-items";

/**
 * Rendu des flux publics (module PUR, testé dans tests/social-feeds.test.ts) :
 *  - Meta (Commerce Manager, catalogue WhatsApp) : RSS 2.0 avec l'espace de noms `g:` ;
 *  - Google Merchant Center : RSS 2.0 `g:` (disponibilité avec « _ », identifier_exists) ;
 *  - TikTok Catalog : CSV (virgule, UTF-8), cellules neutralisées contre l'injection de formules.
 */

export type FeedFormat = "meta" | "google" | "tiktok";

export type FeedChannelInfo = { title: string; link: string; description: string };

/** Échappement XML (texte et attributs) ; les caractères interdits en XML 1.0 sont déjà retirés par cleanText. */
export function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function tag(name: string, value: string | null | undefined): string {
  if (value == null || value === "") return "";
  return `<g:${name}>${xmlEscape(cleanText(value, 10_000))}</g:${name}>`;
}

const GOOGLE_AVAILABILITY: Record<AvailabilityState, string> = { in_stock: "in_stock", out_of_stock: "out_of_stock", preorder: "preorder" };

function rssItem(item: CatalogItem, format: "meta" | "google"): string {
  const parts = [
    tag("id", item.id),
    tag("title", item.title),
    tag("description", item.description),
    tag("link", item.link),
    tag("image_link", item.imageLink),
    ...item.additionalImageLinks.map((u) => tag("additional_image_link", u)),
    tag("brand", item.brand),
    tag("condition", item.condition),
    tag("availability", format === "google" ? GOOGLE_AVAILABILITY[item.availability] : META_AVAILABILITY[item.availability]),
    tag("price", formatFeedPrice(item.price, item.currency)),
    item.salePrice != null ? tag("sale_price", formatFeedPrice(item.salePrice, item.currency)) : "",
    tag("sale_price_effective_date", item.salePriceEffectiveDate),
    tag("item_group_id", item.itemGroupId),
    tag("gtin", item.gtin),
    format === "google" && !item.gtin ? tag("identifier_exists", "no") : "",
    tag("color", item.color),
    tag("size", item.size),
    tag("product_type", item.productType),
  ].filter(Boolean);
  return `<item>${parts.join("")}</item>`;
}

/** Flux RSS 2.0 (Meta ou Google). */
export function renderRssFeed(format: "meta" | "google", channel: FeedChannelInfo, items: CatalogItem[]): string {
  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "<channel>",
    `<title>${xmlEscape(cleanText(channel.title, 150))}</title>`,
    `<link>${xmlEscape(channel.link)}</link>`,
    `<description>${xmlEscape(cleanText(channel.description, 500))}</description>`,
  ];
  return [...head, ...items.map((i) => rssItem(i, format)), "</channel>", "</rss>", ""].join("\n");
}

/**
 * Cellule CSV sûre : formule neutralisée (=, +, -, @, tabulation, retour chariot en tête, y compris après des
 * espaces), puis guillemets RFC 4180 si nécessaire.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  const safe = /^[\s]*[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const TIKTOK_COLUMNS = [
  "sku_id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link",
  "additional_image_link", "brand", "gtin", "item_group_id", "color", "size", "product_type",
] as const;

/** Flux CSV TikTok Catalog (une ligne d'en-têtes puis une ligne par article). */
export function renderTiktokCsv(items: CatalogItem[]): string {
  const rows = items.map((i) => [
    i.id,
    i.title,
    i.description,
    META_AVAILABILITY[i.availability],
    i.condition,
    formatFeedPrice(i.price, i.currency),
    i.salePrice != null ? formatFeedPrice(i.salePrice, i.currency) : "",
    i.link,
    i.imageLink,
    i.additionalImageLinks.map((u) => u.replace(/,/g, "%2C")).join(","),
    i.brand,
    i.gtin ?? "",
    i.itemGroupId ?? "",
    i.color ?? "",
    i.size ?? "",
    i.productType ?? "",
  ]);
  return [TIKTOK_COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export function renderFeed(format: FeedFormat, channel: FeedChannelInfo, items: CatalogItem[]): string {
  return format === "tiktok" ? renderTiktokCsv(items) : renderRssFeed(format, channel, items);
}

export const FEED_CONTENT_TYPE: Record<FeedFormat, string> = {
  meta: "application/xml; charset=utf-8",
  google: "application/xml; charset=utf-8",
  tiktok: "text/csv; charset=utf-8",
};

export const FEED_FILE: Record<FeedFormat, string> = { meta: "meta.xml", google: "google.xml", tiktok: "tiktok.csv" };
