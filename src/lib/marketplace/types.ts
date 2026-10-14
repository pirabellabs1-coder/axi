/** Formes de données affichées par la marketplace (sérialisables, partagées serveur et client). */

export type MkImage = { url: string; alt: string };

export type StoreCardData = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  categorySlug: string;
  categoryLabel: string;
  city: string | null;
  countryName: string;
  logoUrl: string | null;
  /** Bannière, sinon première photo produit, sinon null (photo de catégorie côté UI). */
  cover: MkImage | null;
  isFeatured: boolean;
  productCount: number;
  rating: { average: number; count: number } | null;
  /** true si les horaires sont renseignés et la boutique ouverte maintenant. */
  openNow: boolean | null;
};

export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  image: MkImage | null;
  price: number;
  /** Prix barré (prix normal pendant une promo, ou prix de comparaison). */
  compareAt: number | null;
  isPromo: boolean;
  currency: string;
  store: { slug: string; name: string; city: string | null };
  /** En rupture (stock suivi, vente refusée à zéro) : affiché « Épuisé ». */
  soldOut?: boolean;
};

export type CityCount = { city: string; slug: string; country: string; stores: number; /** Orthographes brutes en base. */ variants: string[] };

export type Suggestion =
  | { type: "store"; label: string; sub: string; href: string; image: string | null }
  | { type: "product"; label: string; sub: string; href: string; image: string | null }
  | { type: "category"; label: string; sub: string; href: string; image: null }
  | { type: "city"; label: string; sub: string; href: string; image: null };
