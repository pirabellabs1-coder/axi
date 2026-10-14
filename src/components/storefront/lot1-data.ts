import "server-only";
import type { PlanId } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { getBuyer, getFavoriteProductIds } from "@/lib/buyer/session";
import { getBuyerKillSwitch } from "@/lib/buyer/settings";
import { getGiftCardsKillSwitch } from "@/lib/giftcards/kill-switch";
import { collectionIdsByProduct, getCartOffers, loadActiveAutomaticDiscounts } from "@/lib/discounts/service";
import { readDiscountConfig, type DiscountTarget, type ParsedDiscount } from "@/lib/discounts/schema";
import { describeDiscount } from "@/lib/discounts/summary";
import type { CartTier, OfferCard, PromoBadge, PromotionsData, RenderData, ShopperData } from "@/lib/storefront/render-types";

/**
 * Lot 1 (équipe E) : données « acheteur » et « promotions » ajoutées au rendu de la boutique, en lecture seule.
 * Calculées côté serveur à chaque requête (pages dynamiques) ; jamais d'information privée (seulement des ids de
 * produits favoris de l'acheteur connecté, et des libellés de remises déjà publics au checkout).
 */

type StoreRef = { id: string; slug: string; accountsEnabled: boolean; currency: string; timezone: string };

const EMPTY_PROMOTIONS: PromotionsData = { productOffers: [], productBadges: [], cartTiers: [], giftCardsEnabled: false, cartOffersEnabled: false };

export async function loadShopper(store: StoreRef, opts: { preview: boolean }): Promise<ShopperData> {
  const kill = await getBuyerKillSwitch().catch(() => ({ enabled: false, message: "" }));
  // Le cœur et l'icône restent visibles en lecture seule pendant un arrêt d'urgence (sessions conservées).
  const accountsEnabled = store.accountsEnabled;
  if (!accountsEnabled || opts.preview) return { accountsEnabled, loggedIn: false, favoriteIds: [] };
  const buyer = await getBuyer(store).catch(() => null);
  if (!buyer) return { accountsEnabled, loggedIn: false, favoriteIds: [] };
  const favorites = kill.enabled ? new Set<string>() : await getFavoriteProductIds(store).catch(() => new Set<string>());
  return { accountsEnabled, loggedIn: true, favoriteIds: [...favorites] };
}

function matchesProduct(target: DiscountTarget | undefined, productId: string, collectionIds: string[]): boolean {
  if (!target || "all" in target) return true;
  if ("productIds" in target) return target.productIds.includes(productId);
  return target.collectionIds.some((c) => collectionIds.includes(c));
}

/** La remise concerne-t-elle ce produit (affichage du badge sur la fiche) ? */
export function discountConcernsProduct(d: ParsedDiscount, p: { id: string; collectionIds: string[]; onSale: boolean; isGiftCard: boolean }): boolean {
  if (p.isGiftCard) return false;
  switch (d.kind) {
    case "PRODUCT_AMOUNT":
      return !(d.config.excludeOnSale && p.onSale) && matchesProduct(d.config.target, p.id, p.collectionIds);
    case "BUY_X_GET_Y":
      return !(d.config.excludeOnSale && p.onSale) && (matchesProduct(d.config.buy.target, p.id, p.collectionIds) || matchesProduct(d.config.get.target, p.id, p.collectionIds));
    case "BUNDLE":
      return d.config.items.some((i) => i.productId === p.id);
    case "CART_TIER":
      return matchesProduct(d.config.target, p.id, p.collectionIds);
  }
}

/**
 * Libellé court d'un palier (« −5 % », « −2 000 FCFA », « livraison offerte »). Pour une remise en montant,
 * `amountOff` est conservé : l'affichage le convertit dans la devise choisie par l'acheteur.
 */
function tierLabel(v: { type: string; amount?: number }, currency: string): { label: string; amountOff?: number } {
  if (v.type === "FREE_DELIVERY") return { label: "la livraison offerte" };
  if (v.type === "PERCENT") return { label: `−${v.amount} %` };
  return { label: `−${formatMoney(v.amount ?? 0, currency)}`, amountOff: Math.max(0, v.amount ?? 0) };
}

export async function loadPromotions(store: StoreRef & { planId: PlanId }, data: RenderData): Promise<PromotionsData> {
  const features = PLANS[store.planId].features;
  const now = new Date(data.now);
  const [discounts, giftKill, activeCards] = await Promise.all([
    loadActiveAutomaticDiscounts(store.id, store.planId, now).catch(() => []),
    getGiftCardsKillSwitch().catch(() => ({ enabled: false, message: "" })),
    // Les cartes déjà émises restent utilisables après une baisse de plan (obligation envers l'acheteur).
    features.giftCards ? Promise.resolve(1) : db.giftCard.count({ where: { storeId: store.id, status: "ACTIVE", balance: { gt: 0 } } }),
  ]);
  const parsed = discounts.map((d) => ({ row: d, parsed: readDiscountConfig(d.kind, d.config) })).filter((x): x is { row: (typeof discounts)[number]; parsed: ParsedDiscount } => x.parsed !== null);

  // Paliers de panier sur tout le panier (les paliers ciblés sont évalués au checkout seulement).
  const cartTiers: CartTier[] = [];
  for (const { parsed: p } of parsed) {
    if (p.kind !== "CART_TIER" || (p.config.target && !("all" in p.config.target))) continue;
    for (const t of p.config.tiers) cartTiers.push({ minSubtotal: t.minSubtotal, ...tierLabel(t.value, store.currency) });
  }
  cartTiers.sort((a, b) => a.minSubtotal - b.minSubtotal);

  let productOffers: OfferCard[] = [];
  let productBadges: PromoBadge[] = [];
  const product = data.product;
  if (product) {
    const card = data.products[product.id];
    const [offers, cols] = await Promise.all([
      features.cartOffers ? getCartOffers(store, "PRODUCT", { contextProductIds: [product.id], cartProductIds: [] }).catch(() => []) : Promise.resolve([]),
      parsed.length ? collectionIdsByProduct(store.id, [product.id]).catch(() => new Map<string, string[]>()) : Promise.resolve(new Map<string, string[]>()),
    ]);
    productOffers = offers
      .map((o): OfferCard | null => {
        const c = data.products[o.productId];
        if (!c) return null;
        return { offerId: o.offerId, title: o.title, mode: o.mode, product: { id: c.id, slug: c.slug, name: c.name, price: c.price, compareAt: c.compareAt, image: c.images[0]?.url ?? null, simple: c.simple, minQty: c.minQty } };
      })
      .filter((x): x is OfferCard => x !== null);
    const names = (id: string) => data.products[id]?.name;
    const colName = (id: string) => data.collections.find((c) => c.id === id)?.name;
    const info = { id: product.id, collectionIds: cols.get(product.id) ?? [], onSale: !!card?.onSale, isGiftCard: !!product.isGiftCard };
    productBadges = parsed
      .filter(({ parsed: p }) => discountConcernsProduct(p, info))
      .slice(0, 4)
      .map(({ row, parsed: p }) => ({ id: row.id, title: row.title, kind: p.kind, description: describeDiscount(p, { currency: store.currency, productName: names, collectionName: colName, timeZone: store.timezone }) }));
  }

  return {
    productOffers,
    productBadges,
    cartTiers: cartTiers.slice(0, 10),
    giftCardsEnabled: !giftKill.enabled && activeCards > 0,
    cartOffersEnabled: features.cartOffers,
  };
}

export { EMPTY_PROMOTIONS };
