import { exactMinor, type FxRate } from "@/lib/currency/convert";
import { applyRounding, pow10, roundHalfUp, type RoundingRuleId } from "@/lib/currency/rounding";
import { currencyDecimals } from "@/lib/money";
import { shareableImageUrl } from "@/lib/storage/public-url";
import type { ProductLink, TtsSettings } from "./model";
import type { TiktokAttribute, TiktokProductInput } from "./types";

/**
 * Mappage produit / variantes Axi → produit TikTok Shop et conversions de montants (module PUR).
 *
 * Montants Axi : entiers en unités mineures selon `currencyDecimals` (XOF 0, EUR 2…).
 * Montants TikTok : chaînes décimales dans la devise du marché, avec les décimales du marché (IDR, VND, JPY : 0).
 * Toute conversion passe par des fractions exactes (BigInt) : aucune dérive flottante.
 */

const B0 = BigInt(0);
const B10000 = BigInt(10_000);

/** Montant mineur Axi (devise du marché) → chaîne TikTok. Ex. 1250 EUR → « 12.50 » ; 150000 IDR (2 déc. Axi) → « 1500 ». */
export function toTiktokAmount(minor: number, currency: string, marketDecimals: number): string {
  const axiDec = currencyDecimals(currency);
  let value = BigInt(Math.trunc(minor));
  if (marketDecimals < axiDec) value = roundHalfUp(value, pow10(axiDec - marketDecimals));
  else if (marketDecimals > axiDec) value = value * pow10(marketDecimals - axiDec);
  const neg = value < B0;
  const abs = (neg ? -value : value).toString().padStart(marketDecimals + 1, "0");
  const out = marketDecimals > 0 ? `${abs.slice(0, -marketDecimals)}.${abs.slice(-marketDecimals)}` : abs;
  return neg ? `-${out}` : out;
}

/** Chaîne TikTok (« 12.5 », « 1500 », « 12,50 ») → unités mineures Axi de la même devise (arrondi au plus proche). */
export function parseTiktokAmount(raw: string | null | undefined, currency: string): number {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0;
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace("-", "").split(".");
  const axiDec = currencyDecimals(currency);
  const num = BigInt(int + frac);
  const den = pow10(frac.length);
  const minor = Number(roundHalfUp(num * pow10(axiDec), den));
  return neg ? -minor : minor;
}

/**
 * Convertit un prix Axi (devise boutique) vers la devise du marché TikTok, majoration comprise, arrondi au centime
 * supérieur du marché (on ne vend jamais sous le prix converti). `rate` : 1 unité de la devise boutique = rate
 * unités de la devise du marché (taux plateforme `resolvePlatformRate`).
 */
export function convertStorePrice(minor: number, p: { storeCurrency: string; marketCurrency: string; rate: FxRate; markupBps: number; rounding?: RoundingRuleId }): number {
  const markup = BigInt(Math.max(0, Math.min(5000, Math.trunc(p.markupBps))));
  const rate: FxRate = { num: p.rate.num * (B10000 + markup), den: p.rate.den * B10000 };
  const e = exactMinor(minor, { rate, baseDecimals: currencyDecimals(p.storeCurrency), quoteDecimals: currencyDecimals(p.marketCurrency) });
  return applyRounding(e.num, e.den, p.rounding ?? "NONE", currencyDecimals(p.marketCurrency));
}

/** Montant TikTok (devise marché, mineur Axi) → devise boutique, au plus proche. `rate` : 1 unité marché = rate unités boutique. */
export function convertToStore(minor: number, p: { marketCurrency: string; storeCurrency: string; rate: FxRate }): number {
  const e = exactMinor(minor, { rate: p.rate, baseDecimals: currencyDecimals(p.marketCurrency), quoteDecimals: currencyDecimals(p.storeCurrency) });
  return Number(roundHalfUp(e.num, e.den));
}

/* ───────────────────────── Produit ───────────────────────── */

export type AxiVariantForSync = { id: string; name: string; attributes: unknown; price: number | null; sku: string | null; weightGrams: number | null; imageUrl: string | null; available: boolean; stock: number };

export type AxiProductForSync = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  kind: string;
  isGiftCard: boolean;
  price: number;
  sku: string | null;
  trackStock: boolean;
  stock: number;
  weightGrams: number | null;
  images: unknown;
  variants: AxiVariantForSync[];
};

export const SIMPLE_KEY = "_";
export const MAX_MAIN_IMAGES = 9;
export const MAX_SKUS = 100;

export function productImageUrls(p: Pick<AxiProductForSync, "images">): string[] {
  const list = Array.isArray(p.images) ? p.images : [];
  return list
    .map((i) => (i && typeof i === "object" ? (i as { url?: unknown }).url : typeof i === "string" ? i : null))
    .map((u) => (typeof u === "string" ? shareableImageUrl(u) : undefined))
    .filter((u): u is string => typeof u === "string" && u.startsWith("https://"))
    .slice(0, MAX_MAIN_IMAGES);
}

/** Photo de variante en URL absolue https (ou null). */
export function variantImageUrl(v: Pick<AxiVariantForSync, "imageUrl">): string | null {
  const u = v.imageUrl ? shareableImageUrl(v.imageUrl) : undefined;
  return u && u.startsWith("https://") ? u : null;
}

/** Raisons pour lesquelles un produit ne peut pas être publié sur TikTok Shop (vide = publiable). */
export function eligibilityErrors(p: AxiProductForSync): string[] {
  const out: string[] = [];
  if (p.isGiftCard || (p.kind && p.kind !== "PHYSICAL")) out.push("Seuls les produits physiques peuvent être vendus sur TikTok Shop.");
  if (p.status !== "ACTIVE") out.push("Le produit doit être actif dans Axi.");
  if (!productImageUrls(p).length) out.push("Ajoutez au moins une photo (adresse https).");
  if (p.variants.length > MAX_SKUS) out.push(`TikTok accepte au plus ${MAX_SKUS} variantes par produit.`);
  if (p.price <= 0 && !p.variants.some((v) => (v.price ?? 0) > 0)) out.push("Le prix doit être supérieur à zéro.");
  return out;
}

/** Quantité annoncée à TikTok pour une variante (ou le produit simple). Jamais négative. */
export function sellableQuantity(p: Pick<AxiProductForSync, "status" | "trackStock" | "stock" | "kind">, v: Pick<AxiVariantForSync, "available" | "stock"> | null, settings: Pick<TtsSettings, "untrackedQuantity">): number {
  if (p.status !== "ACTIVE") return 0;
  if (v && !v.available) return 0;
  if (!p.trackStock) return settings.untrackedQuantity;
  return Math.max(0, Math.trunc(v ? v.stock : p.stock));
}

/** Attributs de vente (≤ 3, contrainte TikTok) depuis `Variant.attributes` ({ "Taille": "M" }) ; repli sur le nom. */
export function salesAttributesOf(v: AxiVariantForSync): { name: string; valueName: string }[] {
  const a = v.attributes && typeof v.attributes === "object" && !Array.isArray(v.attributes) ? (v.attributes as Record<string, unknown>) : {};
  const pairs = Object.entries(a)
    .filter(([k, x]) => k.trim() && (typeof x === "string" || typeof x === "number") && String(x).trim())
    .slice(0, 3)
    .map(([k, x]) => ({ name: k.trim().slice(0, 40), valueName: String(x).trim().slice(0, 50) }));
  return pairs.length ? pairs : [{ name: "Variante", valueName: v.name.slice(0, 50) }];
}

/** Seller SKU stable : SKU marchand s'il est unique dans le produit, sinon identifiant Axi (idempotence de création). */
export function sellerSkus(p: AxiProductForSync): Record<string, string> {
  const entries: [string, string | null, string][] = p.variants.length ? p.variants.map((v) => [v.id, v.sku, v.id]) : [[SIMPLE_KEY, p.sku, p.id]];
  const counts = new Map<string, number>();
  for (const [, sku] of entries) if (sku?.trim()) counts.set(sku.trim(), (counts.get(sku.trim()) ?? 0) + 1);
  return Object.fromEntries(entries.map(([key, sku, id]) => [key, sku?.trim() && counts.get(sku.trim()) === 1 ? sku.trim().slice(0, 50) : `AXI-${id}`.slice(0, 50)]));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Description TikTok (HTML simple) depuis le texte Axi : paragraphes échappés. */
export function descriptionHtml(p: Pick<AxiProductForSync, "name" | "description">): string {
  const text = (p.description ?? "").trim() || p.name;
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("")
    .slice(0, 10_000);
}

/** Attributs obligatoires (propriétés produit) non renseignés dans le lien. */
export function missingRequiredAttributes(attributes: TiktokAttribute[], link: Pick<ProductLink, "attributes">): TiktokAttribute[] {
  return attributes.filter((a) => a.required && a.type === "PRODUCT_PROPERTY" && !link.attributes.some((x) => x.id === a.id && x.values.length > 0));
}

export type BuildInput = {
  product: AxiProductForSync;
  link: ProductLink;
  storeCurrency: string;
  market: { currency: string; priceDecimals: number };
  /** 1 unité devise boutique = rate unités devise marché (identité si même devise). */
  rate: FxRate;
  settings: TtsSettings;
  warehouseId: string;
  /** URL Axi → URI TikTok déjà téléversée. */
  imageUris: Record<string, string>;
};

export type BuildResult = { ok: true; input: TiktokProductInput; skuKeys: string[]; quantities: Record<string, number> } | { ok: false; errors: string[] };

export function buildProductInput(b: BuildInput): BuildResult {
  const { product: p, link, settings } = b;
  const errors = eligibilityErrors(p);
  const urls = productImageUrls(p);
  const mainImageUris = urls.map((u) => b.imageUris[u]).filter((u): u is string => !!u);
  if (urls.length && mainImageUris.length !== urls.length) errors.push("Images non encore envoyées à TikTok.");
  if (errors.length) return { ok: false, errors };

  const price = (minor: number) => toTiktokAmount(convertStorePrice(minor, { storeCurrency: b.storeCurrency, marketCurrency: b.market.currency, rate: b.rate, markupBps: settings.markupBps }), b.market.currency, b.market.priceDecimals);
  const skuOf = sellerSkus(p);
  const quantities: Record<string, number> = {};
  const skus: TiktokProductInput["skus"] = [];
  const keys: string[] = [];
  if (p.variants.length) {
    for (const v of p.variants) {
      const q = sellableQuantity(p, v, settings);
      quantities[v.id] = q;
      keys.push(v.id);
      skus.push({
        ...(link.skus[v.id] ? { id: link.skus[v.id] } : {}),
        sellerSku: skuOf[v.id],
        price: { amount: price(v.price ?? p.price), currency: b.market.currency },
        inventory: [{ warehouseId: b.warehouseId, quantity: q }],
        salesAttributes: salesAttributesOf(v).map((a, i) => {
          const img = variantImageUrl(v);
          return i === 0 && img && b.imageUris[img] ? { ...a, skuImgUri: b.imageUris[img] } : a;
        }),
      });
    }
  } else {
    const q = sellableQuantity(p, null, settings);
    quantities[SIMPLE_KEY] = q;
    keys.push(SIMPLE_KEY);
    skus.push({
      ...(link.skus[SIMPLE_KEY] ? { id: link.skus[SIMPLE_KEY] } : {}),
      sellerSku: skuOf[SIMPLE_KEY],
      price: { amount: price(p.price), currency: b.market.currency },
      inventory: [{ warehouseId: b.warehouseId, quantity: q }],
      salesAttributes: [],
    });
  }
  const grams = Math.max(p.weightGrams ?? 0, ...p.variants.map((v) => v.weightGrams ?? 0)) || settings.defaultWeightGrams;
  return {
    ok: true,
    skuKeys: keys,
    quantities,
    input: {
      title: p.name.trim().slice(0, 255),
      description: descriptionHtml(p),
      categoryId: link.categoryId,
      mainImageUris,
      skus,
      productAttributes: link.attributes.filter((a) => a.values.length),
      packageWeight: { value: (grams / 1000).toFixed(3), unit: "KILOGRAM" },
      packageDimensions: { length: String(settings.lengthCm), width: String(settings.widthCm), height: String(settings.heightCm), unit: "CENTIMETER" },
    },
  };
}

/** Associe les SKU renvoyés par TikTok aux clés de variante Axi (par seller_sku, sinon par position). */
export function mapReturnedSkus(product: AxiProductForSync, skuKeys: string[], returned: { id: string; sellerSku: string }[]): Record<string, string> {
  const bySeller = sellerSkus(product);
  const out: Record<string, string> = {};
  skuKeys.forEach((key, i) => {
    const hit = returned.find((r) => r.sellerSku && r.sellerSku === bySeller[key]) ?? returned[i];
    if (hit?.id) out[key] = hit.id;
  });
  return out;
}
