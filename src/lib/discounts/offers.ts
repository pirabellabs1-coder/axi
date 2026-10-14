import type { CartOfferMode, CartOfferPlacement } from "./schema";

/**
 * Sélection des offres au panier (ventes croisées, montées en gamme), spécification lot 1 §2 « Offres au panier ».
 * Fonction pure, testée (tests/discounts-evaluate.test.ts).
 *  - au moins un déclencheur (produit ou collection) présent dans le contexte (panier ou fiche) ;
 *  - produits proposés ACTIFS, pas déjà au panier, disponibles (politique DENY avec stock ≤ 0 exclue) ;
 *  - 4 maximum au total, triés par `position` de l'offre puis par ordre dans l'offre ; sans doublon.
 */

export type OfferRow = {
  id: string;
  title: string;
  placement: CartOfferPlacement;
  mode: string;
  triggerProductIds: string[];
  triggerCollectionIds: string[];
  offerProductIds: string[];
  automaticDiscountId: string | null;
  position: number;
  active: boolean;
};

export type OfferProductInfo = { status: string; sellable: boolean };

export type SelectedOffer = { offerId: string; title: string; mode: CartOfferMode; productId: string; automaticDiscountId: string | null };

export const MAX_OFFER_PRODUCTS = 4;

export function selectCartOffers(
  offers: readonly OfferRow[],
  ctx: {
    placement: CartOfferPlacement;
    /** Produits déclencheurs possibles : contenu du panier, ou produit de la fiche. */
    contextProductIds: readonly string[];
    /** Collections des produits du contexte. */
    contextCollectionIds: readonly string[];
    /** Produits déjà au panier (jamais reproposés). */
    cartProductIds: readonly string[];
    products: ReadonlyMap<string, OfferProductInfo>;
    limit?: number;
  },
): SelectedOffer[] {
  const limit = Math.min(MAX_OFFER_PRODUCTS, Math.max(0, ctx.limit ?? MAX_OFFER_PRODUCTS));
  const inContext = new Set(ctx.contextProductIds);
  const inCollections = new Set(ctx.contextCollectionIds);
  const inCart = new Set(ctx.cartProductIds);
  const out: SelectedOffer[] = [];
  const seen = new Set<string>();
  const sorted = [...offers].filter((o) => o.active && o.placement === ctx.placement).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  for (const o of sorted) {
    const triggered = o.triggerProductIds.some((id) => inContext.has(id)) || o.triggerCollectionIds.some((id) => inCollections.has(id));
    if (!triggered) continue;
    for (const productId of o.offerProductIds) {
      if (out.length >= limit) return out;
      if (seen.has(productId) || inCart.has(productId) || inContext.has(productId)) continue;
      const info = ctx.products.get(productId);
      if (!info || info.status !== "ACTIVE" || !info.sellable) continue;
      seen.add(productId);
      out.push({ offerId: o.id, title: o.title, mode: o.mode === "replace" ? "replace" : "add", productId, automaticDiscountId: o.automaticDiscountId });
    }
  }
  return out;
}

/**
 * Chiffre d'affaires attribuable à une offre dans une commande : net des lignes dont le produit fait partie
 * des produits proposés. Une conversion n'est comptée que si ce montant est > 0.
 */
export function offerRevenue(offerProductIds: readonly string[], lines: readonly { productId: string | null; netTotal: number }[]): number {
  const set = new Set(offerProductIds);
  return lines.reduce((s, l) => s + (l.productId && set.has(l.productId) ? Math.max(0, l.netTotal) : 0), 0);
}
