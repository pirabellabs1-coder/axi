/**
 * Calculs de prix — fonctions pures, testées (tests/pricing.test.ts).
 * Tous les montants sont des entiers dans la devise de la boutique.
 * Le calcul complet (remises, fidélité, tenders) vit dans `checkout-pipeline.ts` (`priceCart`).
 */
import { priceCart } from "./checkout-pipeline";

export type PricedLine = {
  productId: string;
  variantId?: string | null;
  name: string;
  variantName?: string | null;
  unitPrice: number; // prix unitaire incluant les options
  quantity: number;
  options?: { name: string; priceDelta: number }[];
};

export type CouponInput = {
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_DELIVERY";
  value: number;
  minSubtotal: number;
  active: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxUses?: number | null;
  usesCount: number;
};

export type DeliveryInput =
  | { type: "PICKUP" }
  | { type: "WHATSAPP" }
  | { type: "DELIVERY"; fee: number; freeAbove?: number | null };

export type Totals = {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  couponApplied: boolean;
  couponError?: string;
};

/** Prix effectif d'un produit (promo bornée dans le temps). */
export function effectivePrice(
  p: { price: number; promoPrice?: number | null; promoStart?: Date | null; promoEnd?: Date | null },
  now = new Date(),
): { price: number; isPromo: boolean } {
  if (p.promoPrice != null && p.promoPrice < p.price) {
    const started = !p.promoStart || p.promoStart <= now;
    const notEnded = !p.promoEnd || p.promoEnd >= now;
    if (started && notEnded) return { price: p.promoPrice, isPromo: true };
  }
  return { price: p.price, isPromo: false };
}

export function lineTotal(line: PricedLine): number {
  return line.unitPrice * line.quantity;
}

export function subtotalOf(lines: PricedLine[]): number {
  return lines.reduce((s, l) => s + lineTotal(l), 0);
}

export function validateCoupon(coupon: CouponInput | null | undefined, subtotal: number, now = new Date()): { ok: true } | { ok: false; reason: string } {
  if (!coupon) return { ok: false, reason: "Code promo introuvable." };
  if (!coupon.active) return { ok: false, reason: "Ce code promo n'est plus actif." };
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, reason: "Ce code promo n'est pas encore valable." };
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, reason: "Ce code promo a expiré." };
  if (coupon.maxUses != null && coupon.usesCount >= coupon.maxUses) return { ok: false, reason: "Ce code promo a atteint sa limite d'utilisation." };
  if (subtotal < coupon.minSubtotal) return { ok: false, reason: `Minimum de commande non atteint pour ce code.` };
  return { ok: true };
}

export function computeDeliveryFee(delivery: DeliveryInput, subtotal: number): number {
  if (delivery.type !== "DELIVERY") return 0;
  if (delivery.freeAbove != null && subtotal >= delivery.freeAbove) return 0;
  return Math.max(0, delivery.fee);
}

/**
 * Totaux simples (compatibilité) : délègue au pipeline unique `priceCart` (checkout-pipeline.ts), sans remise
 * automatique, fidélité ni tender. `freeAbove` est comparé au net après remise (décision du 11/10/2026).
 */
export function computeTotals(lines: PricedLine[], delivery: DeliveryInput, coupon?: CouponInput | null, now = new Date()): Totals {
  const r = priceCart({
    lines: lines.map((l) => ({ ...l, collectionIds: [], isGiftCard: false, onSale: false })),
    delivery,
    coupon: coupon ?? null,
    now,
    currency: "XOF",
  });
  return { subtotal: r.subtotal, discount: r.discount, deliveryFee: r.deliveryFee, total: r.total, couponApplied: r.couponApplied, ...(r.couponError ? { couponError: r.couponError } : {}) };
}

/**
 * Vérifie min/max de quantité et stock disponible. Retourne un message d'erreur ou null.
 * `inventoryPolicy` CONTINUE (« continuer à vendre en cas de rupture ») : pas de contrôle de stock (précommande).
 * `revealStock` false (le thème masque le stock) : jamais de quantité restante dans le message.
 */
export function checkQuantity(
  item: { name: string; minQty: number; maxQty?: number | null; trackStock: boolean; stock: number; inventoryPolicy?: "DENY" | "CONTINUE" | null },
  quantity: number,
  opts: { revealStock?: boolean } = {},
): string | null {
  if (!Number.isInteger(quantity) || quantity < 1) return `Quantité invalide pour ${item.name}.`;
  if (quantity < item.minQty) return `Minimum ${item.minQty} pour ${item.name}.`;
  if (item.maxQty != null && quantity > item.maxQty) return `Maximum ${item.maxQty} pour ${item.name}.`;
  if (item.trackStock && item.inventoryPolicy !== "CONTINUE" && quantity > item.stock) {
    if (item.stock <= 0) return `${item.name} est épuisé.`;
    return opts.revealStock === false ? `Quantité demandée indisponible pour ${item.name}.` : `Il ne reste que ${item.stock} ${item.name}.`;
  }
  return null;
}
