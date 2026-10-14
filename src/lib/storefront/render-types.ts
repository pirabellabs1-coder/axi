/**
 * Données de rendu de la boutique : sérialisables (dates en ISO), préparées côté serveur (resolve.ts)
 * et transmises telles quelles à l'aperçu en direct côté client. Aucun champ privé (coût, notes internes…).
 */
import type { SectorCopy } from "./theme";
import type { ProductOption } from "./variants";

export type Img = { url: string; alt?: string };

/** Fenêtre « Nouveau » : un produit est mis en avant comme récent pendant ses 30 premiers jours. */
export const NEW_PRODUCT_WINDOW_DAYS = 30;

/**
 * Produit « Nouveau » : créé/publié depuis ≤ 30 jours (fonction PURE, testée). Une date future ou invalide
 * n'est jamais « nouvelle ». `createdAtISO` provient de `CardProduct.createdAt` (champ `Product.createdAt`).
 */
export function isNewProduct(createdAtISO: string, now: Date): boolean {
  const created = Date.parse(createdAtISO);
  if (!Number.isFinite(created)) return false;
  const ageMs = now.getTime() - created;
  return ageMs >= 0 && ageMs <= NEW_PRODUCT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export type SaleBadgeMode = "percent" | "text" | "hidden";

/**
 * Libellé du badge promo (fonction PURE, testée) : `null` si masqué ou remise < 5 % (seuil inchangé),
 * « -20 % » en mode pourcentage (défaut), « Promo » en mode texte.
 */
export function saleBadgeLabel(mode: SaleBadgeMode, discountPct: number): string | null {
  if (mode === "hidden" || discountPct < 5) return null;
  return mode === "text" ? "Promo" : `-${discountPct} %`;
}

export type CardProduct = {
  id: string;
  slug: string;
  name: string;
  vendor: string | null;
  description: string | null;
  /** Prix « à partir de » (promo et variantes comprises). */
  price: number;
  /** Prix barré (promo ou prix de comparaison), null sinon. */
  compareAt: number | null;
  /** En promotion (promo active, prix barré produit OU d'une variante) : condition « En promotion » des collections auto. */
  onSale?: boolean;
  range: boolean;
  discountPct: number;
  soldOut: boolean;
  /** Achetable uniquement en précommande (rupture + « continuer à vendre »). */
  preorder?: boolean;
  images: Img[];
  /** Ajout direct possible (sans variante ni supplément). */
  simple: boolean;
  /** Prix unitaire de l'ajout rapide (produit simple). */
  unitPrice: number;
  minQty: number;
  variantCount: number;
  categoryId: string | null;
  tags: string[];
  productType: string | null;
  options: ProductOption[];
  isFeatured: boolean;
  position: number;
  createdAt: string;
  /** Produit récent (créé depuis ≤ 30 jours) : pilote le badge « Nouveau » (dérivé de `createdAt`, voir `isNewProduct`). */
  isNew: boolean;
  sales: number;
  rating: { average: number; count: number } | null;
  /** Variantes (filtre de disponibilité par option). */
  variants: { attributes: Record<string, string>; purchasable: boolean }[];
};

export type CollectionData = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  image: Img | null;
  seoTitle: string | null;
  seoDescription: string | null;
  sortOrder: string;
  /** Produits de la collection (manuelle ou règles automatiques), déjà triés selon `sortOrder`. */
  productIds: string[];
};

export type MenuLink = { label: string; href: string; children: MenuLink[] };

export type ReviewItem = {
  id: string;
  name: string;
  rating: number;
  body: string;
  reply: string | null;
  createdAt: string;
  verified: boolean;
  product: { name: string; slug: string; image: string | null } | null;
};

export type ReviewSummary = { average: number; count: number; /** index 0 = 5 étoiles … 4 = 1 étoile */ histogram: [number, number, number, number, number] };

export type ReviewBlock = {
  summary: ReviewSummary;
  items: ReviewItem[];
  /** Pagination et filtre (fiche produit) ; null = sélection récente (accueil). */
  page: number;
  pages: number;
  rating: number | null;
  /** Avis d'un seul produit (fiche produit). */
  productScoped: boolean;
};

export type StoreInfo = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  whatsappNumber: string | null;
  whatsappOrdering: boolean;
  currency: string;
  closed: boolean;
  unpublished: boolean;
  booking: boolean;
  sector: string;
  copy: SectorCopy;
  openNow: boolean | null;
  hours: { day: string; ranges: string }[];
  todayIndex: number;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryZones: { name: string; fee: number; freeAbove: number | null; etaLabel: string | null }[];
  /** Livraison offerte dès (plus petit seuil des zones), null si aucun. */
  freeShippingFrom: number | null;
  paymentLabels: string[];
  showPoweredBy: boolean;
  loyalty: { pointsPer1000: number; rewardPoints: number; rewardValue: number } | null;
  metaPixelId: string | null;
  gaMeasurementId: string | null;
  /** Lot 2 (langues) : segment de langue des liens de la boutique ("" en langue principale, "/en" sinon). */
  localePrefix?: string;
};

export type ProductPageData = {
  id: string;
  slug: string;
  name: string;
  vendor: string | null;
  productType: string | null;
  description: string | null;
  images: Img[];
  /** Prix effectif de base (promo appliquée). */
  basePrice: number;
  /** Prix barré du produit (promo ou comparaison). */
  compareAt: number | null;
  /** Référence : null si le thème ne l'affiche pas (`settings.product.showSku` ni bloc « sku »). */
  sku: string | null;
  trackStock: boolean;
  /** Quantité exacte : uniquement si le thème affiche le stock (`settings.product.showStock`), sinon null. */
  stock: number | null;
  /** Achetable côté stock : en stock, non suivi, ou vendable en rupture (toujours fourni). */
  inStock: boolean;
  /** Rupture vendue en précommande (« continuer à vendre en cas de rupture »), toujours fourni. */
  backorder: boolean;
  /** « Continuer à vendre en cas de rupture » : la quantité n'est pas plafonnée au stock (le surplus part en précommande). */
  continueSelling: boolean;
  /** Stock bas (≤ seuil du produit, sinon de la boutique), toujours fourni. */
  lowStock: boolean;
  minQty: number;
  maxQty: number | null;
  options: ProductOption[];
  variants: { id: string; name: string; attributes: Record<string, string>; price: number | null; compareAtPrice: number | null; sku: string | null; stock: number | null; inStock: boolean; backorder: boolean; continueSelling: boolean; lowStock: boolean; available: boolean; imageUrl: string | null }[];
  optionGroups: { id: string; name: string; required: boolean; minSelect: number; maxSelect: number; options: { id: string; name: string; priceDelta: number }[] }[];
  details: { title: string; body: string }[];
  tags: string[];
  collection: { name: string; handle: string } | null;
  rating: { average: number; count: number } | null;
  requestedVariantId: string | null;
  url: string;
  /** Lot 1 : carte cadeau (variantes = valeurs faciales ; formulaire destinataire sur la fiche). */
  isGiftCard?: boolean;
  /** Nature vendue : pilote livraison, stock et paiement à la livraison côté vitrine. */
  productKind?: "PHYSICAL" | "DIGITAL" | "SERVICE" | "GIFT_CARD";
};

export type ListingData = {
  kind: "collection" | "catalog" | "search";
  title: string;
  description: string | null;
  image: Img | null;
  collectionId: string | null;
  query: string;
  productIds: string[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  /** Filtres applicables (facettes calculées sur l'ensemble de la liste avant filtrage). */
  facets: import("./catalog").Facets;
  params: import("./catalog").CatalogParams;
  basePath: string;
};

/** Lot 1 : produit proposé par une offre au panier (ventes croisées, montées en gamme). */
export type OfferCard = {
  offerId: string;
  title: string;
  mode: "add" | "replace";
  product: { id: string; slug: string; name: string; price: number; compareAt: number | null; image: string | null; simple: boolean; minQty: number };
};

/** Lot 1 : remise automatique affichable (badges « Offres disponibles », barre d'offres). */
export type PromoBadge = { id: string; title: string; description: string; kind: "PRODUCT_AMOUNT" | "BUY_X_GET_Y" | "CART_TIER" | "BUNDLE" };

/** Lot 1 : palier de panier (CART_TIER sur tout le panier), évalué côté client sur le sous-total indicatif. */
export type CartTier = {
  minSubtotal: number;
  label: string;
  /** Remise en montant fixe (devise boutique) : le libellé est reconstruit dans la devise d'affichage. */
  amountOff?: number;
};

/**
 * Lot 1 : état de l'acheteur et promotions, préparés par StorefrontView (jamais dans l'aperçu de l'éditeur :
 * valeurs d'exemple). Toujours optionnel : un document ou un rendu antérieur reste valide sans ces champs.
 */
export type ShopperData = {
  /** Comptes acheteurs activés sur la boutique (et non suspendus par la plateforme). */
  accountsEnabled: boolean;
  loggedIn: boolean;
  favoriteIds: string[];
};

export type PromotionsData = {
  /** Fiche produit : « Souvent achetés ensemble » (placement PRODUCT). */
  productOffers: OfferCard[];
  /** Fiche produit : remises automatiques qui concernent ce produit. */
  productBadges: PromoBadge[];
  /** Paliers de panier actifs (le meilleur palier est appliqué au checkout). */
  cartTiers: CartTier[];
  /** Cartes cadeaux utilisables au checkout (plan, arrêt d'urgence plateforme). */
  giftCardsEnabled: boolean;
  /** Offres au panier possibles (plan Business+) : le panier les demande au serveur. */
  cartOffersEnabled: boolean;
};

export type RenderData = {
  store: StoreInfo;
  now: string;
  collections: CollectionData[];
  products: Record<string, CardProduct>;
  /** Ordre par défaut de toute la boutique (mis en avant, position, nouveauté). */
  allProductIds: string[];
  menus: Record<string, MenuLink[]>;
  reviews: ReviewBlock;
  pages: { slug: string; title: string }[];
  product?: ProductPageData;
  listing?: ListingData;
  page?: { title: string; body: string; updatedAt: string };
  /** Lot 1 : acheteur connecté, favoris. */
  shopper?: ShopperData;
  /** Lot 1 : offres et remises automatiques. */
  promotions?: PromotionsData;
  /** Panier restauré depuis un lien de relance (?panier=). */
  restoredCart?: { token: string; lines: { productId: string; variantId: string | null; optionIds: string[]; quantity: number; snapshot: { name: string; variantName: string | null; unitPrice: number; image: string | null; productSlug: string; optionNames: string[] } }[] } | { error: string };
  /** Lot 4 (T3) : champs personnalisés publics du contexte (produit, variante, collection, boutique, page), par `namespace.key`. */ metafields?: import("@/components/storefront/lot4-types").RenderMetafields;
  /**
   * Lot 2 (devises) : devise d'affichage de l'acheteur, chargée une fois par requête (cookie `axi_cur`).
   * Absente ou sans `quote` = aucune conversion (devise de la boutique). Les montants de `RenderData` restent
   * TOUJOURS exprimés dans la devise de la boutique : seule la présentation convertit (`src/lib/storefront/currency-view.ts`).
   */
  currency?: import("./currency-view").CurrencyView;
  /**
   * Lot 2 (langues) : langue affichée, langues servies et suggestion éventuelle. Absente = langue principale
   * sans alternative. Les textes de `RenderData` sont déjà traduits (repli sur la langue principale champ par champ).
   */
  locale?: import("@/i18n/locales").LocaleView;
};
