/**
 * Tarifs d'expédition par zone (lot 3 §1.2) — module PUR (tests/shipping-rates.test.ts).
 *
 *  - Poids de la commande = Σ `weightGrams × quantité` (poids de la variante, sinon du produit, sinon 0
 *    avec un avertissement au commerçant : un article sans poids ne bloque jamais une vente).
 *  - Sous-total retenu = NET après remises (automatiques, coupon), avant les points de fidélité et
 *    l'avoir (décision du 11/10/2026, cohérente avec `freeAbove`).
 *  - Bornes INCLUSIVES des deux côtés (`min ≤ valeur ≤ max`) ; une borne absente = pas de limite.
 *  - `freeAbove` : au-dessus (ou égal) de ce net, la livraison est offerte (prix 0) sans masquer le tarif.
 *  - Une zone SANS tarif actif garde `DeliveryZone.fee` / `freeAbove` (compatibilité : aucune régression).
 */

export type WeightLine = {
  quantity: number;
  /** Poids de la variante vendue (prioritaire). */
  variantWeightGrams?: number | null;
  /** Poids du produit. */
  productWeightGrams?: number | null;
  /** Ligne sans expédition (carte cadeau, produit numérique, service) : ignorée. */
  shippable?: boolean;
};

/** Poids total expédié et signalement des articles sans poids renseigné. */
export function orderWeightGrams(lines: readonly WeightLine[]): { grams: number; missingWeight: number } {
  let grams = 0;
  let missingWeight = 0;
  for (const l of lines) {
    if (l.shippable === false) continue;
    const qty = Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 0;
    const w = l.variantWeightGrams ?? l.productWeightGrams ?? null;
    if (w == null || !Number.isFinite(w) || w <= 0) {
      if (qty > 0) missingWeight += qty;
      continue;
    }
    grams += Math.round(w) * qty;
  }
  return { grams, missingWeight };
}

export type ShippingRateLike = {
  id: string;
  name: string;
  minWeightGrams?: number | null;
  maxWeightGrams?: number | null;
  minSubtotal?: number | null;
  maxSubtotal?: number | null;
  price: number;
  freeAbove?: number | null;
  etaLabel?: string | null;
  active?: boolean;
  position?: number;
  carrierAccountId?: string | null;
};

export type RateContext = { weightGrams: number; subtotalNet: number };

function within(value: number, min: number | null | undefined, max: number | null | undefined): boolean {
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/** Le tarif s'applique-t-il au poids et au sous-total net de la commande ? */
export function rateMatches(rate: ShippingRateLike, ctx: RateContext): boolean {
  if (rate.active === false) return false;
  return within(ctx.weightGrams, rate.minWeightGrams, rate.maxWeightGrams) && within(ctx.subtotalNet, rate.minSubtotal, rate.maxSubtotal);
}

/** Prix effectif d'un tarif (0 si le seuil de livraison offerte est atteint). */
export function ratePrice(rate: ShippingRateLike, subtotalNet: number): number {
  if (rate.freeAbove != null && subtotalNet >= rate.freeAbove) return 0;
  return Math.max(0, Math.round(rate.price));
}

export type RateQuote = { id: string; name: string; price: number; free: boolean; etaLabel: string | null; carrierAccountId: string | null };

/** Tarifs applicables, du moins cher au plus cher (départage : `position`, puis nom). */
export function quoteRates(rates: readonly ShippingRateLike[], ctx: RateContext): RateQuote[] {
  return rates
    .filter((r) => rateMatches(r, ctx))
    .map((r) => ({
      id: r.id,
      name: r.name,
      price: ratePrice(r, ctx.subtotalNet),
      free: ratePrice(r, ctx.subtotalNet) === 0,
      etaLabel: r.etaLabel ?? null,
      carrierAccountId: r.carrierAccountId ?? null,
      position: r.position ?? 0,
    }))
    .sort((a, b) => a.price - b.price || a.position - b.position || a.name.localeCompare(b.name, "fr"))
    .map((q) => ({ id: q.id, name: q.name, price: q.price, free: q.free, etaLabel: q.etaLabel, carrierAccountId: q.carrierAccountId }));
}

export type ZoneFallback = { fee: number; freeAbove?: number | null; etaLabel?: string | null; name?: string };

export type ShippingChoice = { fee: number; rateId: string | null; rateName: string | null; etaLabel: string | null; source: "rate" | "zone" };

/**
 * Frais de livraison retenus pour une commande : le tarif applicable le moins cher, sinon le forfait
 * de la zone (compatibilité). `rateId` est l'instantané conservé sur la commande.
 */
export function chooseShippingFee(rates: readonly ShippingRateLike[], zone: ZoneFallback, ctx: RateContext, preferredRateId?: string | null): ShippingChoice {
  const quotes = quoteRates(rates, ctx);
  const preferred = preferredRateId ? quotes.find((q) => q.id === preferredRateId) : undefined;
  const chosen = preferred ?? quotes[0];
  if (chosen) return { fee: chosen.price, rateId: chosen.id, rateName: chosen.name, etaLabel: chosen.etaLabel, source: "rate" };
  const free = zone.freeAbove != null && ctx.subtotalNet >= zone.freeAbove;
  return { fee: free ? 0 : Math.max(0, Math.round(zone.fee)), rateId: null, rateName: zone.name ?? null, etaLabel: zone.etaLabel ?? null, source: "zone" };
}

/** Avertissement affiché au commerçant quand des articles n'ont pas de poids (tarifs au poids faussés). */
export function missingWeightWarning(missingWeight: number): string | null {
  if (missingWeight <= 0) return null;
  return `${missingWeight} article${missingWeight > 1 ? "s" : ""} sans poids renseigné : les tarifs au poids peuvent être sous-évalués. Renseignez le poids des produits concernés.`;
}
