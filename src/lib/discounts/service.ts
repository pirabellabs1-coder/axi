import "server-only";
import type { PlanId } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { collectionsByProduct } from "@/lib/collections/service";
import type { PipelineAutomaticDiscount } from "@/lib/commerce/checkout-pipeline";
import { ADVANCED_KINDS, type CartOfferPlacement, type DiscountKind } from "./schema";
import { offerRevenue, selectCartOffers, type SelectedOffer } from "./offers";

/**
 * Services serveur des remises automatiques et des offres au panier (lot 1, §2). Toujours isolés par `storeId`.
 */

/** Types de remises automatiques autorisés par le plan (contrôle serveur, y compris à l'évaluation). */
export function allowedDiscountKinds(planId: PlanId): Set<DiscountKind> {
  const f = PLANS[planId].features;
  const out = new Set<DiscountKind>();
  if (f.automaticDiscounts) {
    out.add("PRODUCT_AMOUNT");
    out.add("CART_TIER");
  }
  if (f.advancedDiscounts) {
    for (const k of ADVANCED_KINDS) out.add(k);
  }
  return out;
}

/**
 * Remises automatiques actives à la date `now`, autorisées par le plan, non épuisées.
 * Le pipeline relit et valide chaque configuration (une configuration invalide est ignorée).
 */
export async function loadActiveAutomaticDiscounts(storeId: string, planId: PlanId, now = new Date(), client: Tx | typeof db = db): Promise<PipelineAutomaticDiscount[]> {
  const kinds = allowedDiscountKinds(planId);
  if (kinds.size === 0) return [];
  const rows = await client.automaticDiscount.findMany({
    where: {
      storeId,
      active: true,
      kind: { in: [...kinds] },
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
    take: 100,
  });
  return rows
    .filter((r) => r.maxUses == null || r.usesCount < r.maxUses)
    .map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      config: r.config,
      priority: r.priority,
      combinesWithCoupons: r.combinesWithCoupons,
      combinesWithOtherAutomatic: r.combinesWithOtherAutomatic,
      maxUses: r.maxUses,
      usesCount: r.usesCount,
    }));
}

/** Collections (ids) par produit, uniquement si une remise ou un coupon les cible. */
export async function collectionIdsByProduct(storeId: string, productIds: string[]): Promise<Map<string, string[]>> {
  const map = await collectionsByProduct(storeId, productIds);
  return new Map([...map.entries()].map(([id, cols]) => [id, cols.map((c) => c.id)]));
}

/** Vrai si une remise (config brute) ou un `appliesTo` de coupon référence des collections. */
export function needsCollections(discounts: readonly { config: unknown }[], appliesTo?: { collectionIds?: string[] } | null): boolean {
  if (appliesTo?.collectionIds?.length) return true;
  return discounts.some((d) => JSON.stringify(d.config ?? null).includes("collectionIds"));
}

export type CartOfferSuggestion = SelectedOffer & {
  product: { id: string; name: string; slug: string; price: number; promoPrice: number | null; promoStart: Date | null; promoEnd: Date | null; images: unknown; hasVariants: boolean };
};

/**
 * Offres au panier à afficher (contrat pour la vitrine, équipe E) : `placement` PRODUCT (contexte = produit de la fiche),
 * CART ou CHECKOUT (contexte = produits du panier). Vide si le plan n'inclut pas les offres au panier.
 */
export async function getCartOffers(
  store: { id: string; planId: PlanId },
  placement: CartOfferPlacement,
  ctx: { contextProductIds: string[]; cartProductIds: string[] },
): Promise<CartOfferSuggestion[]> {
  if (!PLANS[store.planId].features.cartOffers) return [];
  const contextIds = [...new Set(ctx.contextProductIds)].slice(0, 60);
  if (contextIds.length === 0) return [];
  const offers = await db.cartOffer.findMany({ where: { storeId: store.id, active: true, placement }, orderBy: [{ position: "asc" }, { id: "asc" }], take: 50 });
  if (offers.length === 0) return [];
  const needCols = offers.some((o) => o.triggerCollectionIds.length > 0);
  const cols = needCols ? await collectionIdsByProduct(store.id, contextIds) : new Map<string, string[]>();
  const candidateIds = [...new Set(offers.flatMap((o) => o.offerProductIds))].slice(0, 200);
  const products = await db.product.findMany({
    where: { storeId: store.id, id: { in: candidateIds } },
    select: { id: true, name: true, slug: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, images: true, status: true, trackStock: true, stock: true, inventoryPolicy: true, isGiftCard: true, variants: { select: { available: true, stock: true, inventoryPolicy: true } } },
  });
  const info = new Map(
    products.map((p) => {
      const sellable = p.variants.length
        ? p.variants.some((v) => v.available && (!p.trackStock || v.inventoryPolicy === "CONTINUE" || v.stock > 0))
        : !p.trackStock || p.inventoryPolicy === "CONTINUE" || p.stock > 0;
      return [p.id, { status: p.status, sellable }] as const;
    }),
  );
  const selected = selectCartOffers(offers, {
    placement,
    contextProductIds: contextIds,
    contextCollectionIds: [...new Set([...cols.values()].flat())],
    cartProductIds: ctx.cartProductIds,
    products: info,
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return selected.map((s) => {
    const p = byId.get(s.productId)!;
    return { ...s, product: { id: p.id, name: p.name, slug: p.slug, price: p.price, promoPrice: p.promoPrice, promoStart: p.promoStart, promoEnd: p.promoEnd, images: p.images, hasVariants: p.variants.length > 0 } };
  });
}

/**
 * Attribution des offres (Order.attribution.offers) : ids d'offres actives de la boutique uniquement, dédoublonnés.
 * Incrémente `conversions` (+1) et `revenue` (net des lignes proposées) dans la transaction de la commande.
 */
export async function recordOfferConversionsTx(tx: Tx, storeId: string, offerIds: readonly string[], lines: readonly { productId: string | null; netTotal: number }[]): Promise<string[]> {
  const ids = [...new Set(offerIds)].filter((x) => typeof x === "string" && x.length >= 8 && x.length <= 64).slice(0, 20);
  if (ids.length === 0) return [];
  const offers = await tx.cartOffer.findMany({ where: { storeId, id: { in: ids } }, select: { id: true, offerProductIds: true } });
  const kept: string[] = [];
  for (const o of offers) {
    const revenue = offerRevenue(o.offerProductIds, lines);
    if (revenue <= 0) continue; // le produit proposé n'est pas dans la commande : pas de conversion
    kept.push(o.id);
    await tx.cartOffer.updateMany({ where: { id: o.id, storeId }, data: { conversions: { increment: 1 }, revenue: { increment: revenue } } });
  }
  return kept;
}
