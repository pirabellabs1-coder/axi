import type { FxRate } from "@/lib/currency/convert";
import { convertToStore, parseTiktokAmount } from "./mapping";
import type { TiktokOrder } from "./types";

/**
 * Plan d'import d'une commande TikTok Shop (module PUR) : regroupement des lignes (une ligne TikTok par unité),
 * rattachement aux produits Axi, montants tels que payés dans TikTok convertis dans la devise de la boutique.
 *
 * Invariant des montants Axi : total = subtotal − discount + deliveryFee (+ taxTotal si taxes en sus, US).
 * Le total retenu est TOUJOURS celui payé par l'acheteur dans TikTok (converti) ; l'écart avec les lignes est
 * porté par `discount` (remises vendeur et plateforme) ou, s'il est positif, par `deliveryFee` (frais TikTok).
 */

/** Statuts payés : la commande est importée. ON_HOLD = payée, encore annulable par l'acheteur (délai de grâce). */
export const IMPORTABLE_STATUSES = new Set(["ON_HOLD", "AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED", "COMPLETED"]);
export const CANCELLED_STATUS = "CANCELLED";

/** Marchés où TikTok affiche les prix hors taxes (taxe ajoutée au paiement). */
const TAX_EXCLUDED_REGIONS = new Set(["US"]);

export const idempotencyKeyFor = (tiktokOrderId: string) => `tiktok_shop:${tiktokOrderId}`;

export type SkuTarget = { productId: string; variantId: string | null };

export type PlannedLine = {
  skuId: string;
  lineItemIds: string[];
  name: string;
  variantName: string | null;
  quantity: number;
  /** Prix unitaire payé, devise du marché (mineur Axi). */
  marketUnitPrice: number;
  /** Prix unitaire converti, devise boutique. */
  unitPrice: number;
  target: SkuTarget | null;
};

export type OrderPlan = {
  lines: PlannedLine[];
  storeCurrency: string;
  marketCurrency: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  taxTotal: number;
  taxesIncluded: boolean;
  total: number;
  presentment: { currency: string; total: number; subtotal: number; shipping: number; tax: number; sellerDiscount: number; platformDiscount: number } | null;
  sellerFulfilled: boolean;
};

export function planOrder(o: TiktokOrder, p: { storeCurrency: string; region: string | null; resolveSku: (skuId: string, sellerSku: string | null) => SkuTarget | null; rate: FxRate }): OrderPlan {
  const market = (o.payment.currency || o.lineItems[0]?.currency || p.storeCurrency).toUpperCase();
  const toStore = (minor: number) => (market === p.storeCurrency ? minor : convertToStore(minor, { marketCurrency: market, storeCurrency: p.storeCurrency, rate: p.rate }));

  // Regroupement par SKU ET prix (deux unités du même SKU à des prix différents restent sur deux lignes).
  const groups = new Map<string, PlannedLine>();
  for (const li of o.lineItems) {
    const marketUnitPrice = parseTiktokAmount(li.salePrice, market);
    const key = `${li.skuId}|${marketUnitPrice}`;
    const g = groups.get(key);
    if (g) {
      g.quantity++;
      g.lineItemIds.push(li.id);
      continue;
    }
    groups.set(key, {
      skuId: li.skuId,
      lineItemIds: [li.id],
      name: (li.productName || "Article TikTok").slice(0, 200),
      variantName: li.skuName ? li.skuName.slice(0, 120) : null,
      quantity: 1,
      marketUnitPrice,
      unitPrice: toStore(marketUnitPrice),
      target: p.resolveSku(li.skuId, li.sellerSku),
    });
  }
  const lines = [...groups.values()];

  const taxesIncluded = !TAX_EXCLUDED_REGIONS.has(String(p.region ?? "").toUpperCase());
  const mTotal = parseTiktokAmount(o.payment.totalAmount, market);
  const mShipping = parseTiktokAmount(o.payment.shippingFee, market);
  const mTax = parseTiktokAmount(o.payment.tax, market);

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const total = Math.max(0, toStore(mTotal));
  const taxTotal = Math.max(0, toStore(mTax));
  let deliveryFee = Math.max(0, toStore(mShipping));
  const base = subtotal + deliveryFee + (taxesIncluded ? 0 : taxTotal);
  let discount = 0;
  if (total <= base) discount = base - total;
  else deliveryFee += total - base;

  return {
    lines,
    storeCurrency: p.storeCurrency,
    marketCurrency: market,
    subtotal,
    discount,
    deliveryFee,
    taxTotal,
    taxesIncluded,
    total,
    presentment:
      market === p.storeCurrency
        ? null
        : {
            currency: market,
            total: mTotal,
            subtotal: lines.reduce((s, l) => s + l.marketUnitPrice * l.quantity, 0),
            shipping: mShipping,
            tax: mTax,
            sellerDiscount: parseTiktokAmount(o.payment.sellerDiscount, market),
            platformDiscount: parseTiktokAmount(o.payment.platformDiscount, market),
          },
    sellerFulfilled: o.fulfillmentType !== "FULFILLMENT_BY_TIKTOK",
  };
}

/** Téléphone exploitable (TikTok masque souvent les coordonnées : « (+33)6****12 » est rejeté). */
export function usablePhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? "");
  if (!s || s.includes("*")) return null;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Correspondance transporteur Axi → transporteur TikTok (nom normalisé, inclusion dans un sens ou l'autre). */
export function matchShippingProvider(carrier: string | null | undefined, providers: { id: string; name: string }[]): { id: string; name: string } | null {
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const c = norm(String(carrier ?? ""));
  if (!c || c === "manual" || c === "manuel") return null;
  const named = providers.filter((p) => norm(p.name).length >= 2);
  return named.find((p) => norm(p.name) === c) ?? named.find((p) => norm(p.name).includes(c) || c.includes(norm(p.name))) ?? null;
}
