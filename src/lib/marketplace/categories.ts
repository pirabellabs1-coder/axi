import { MEDIA } from "@/config/media";

/**
 * Catégories de la marketplace. Une catégorie regroupe une valeur de `Store.category`
 * et les secteurs (`Store.sector`) qui lui correspondent. Le slug est l'identifiant d'URL (français).
 * Module partagé (serveur et client) : aucune dépendance serveur.
 */
export type MarketplaceCategory = {
  slug: string;
  /** Valeur de `Store.category`. */
  id: string;
  label: string;
  short: string;
  description: string;
  /** Valeurs de `Store.sector` rattachées. */
  sectors: string[];
  media: keyof typeof MEDIA;
};

export const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  { slug: "restauration", id: "food", label: "Restauration et pâtisserie", short: "Restauration", description: "Plats du jour, gâteaux sur commande, viennoiseries et jus frais, à emporter ou livrés.", sectors: ["restaurant", "patisserie"], media: "bakery" },
  { slug: "mode", id: "fashion", label: "Mode et accessoires", short: "Mode", description: "Pagnes, tenues sur mesure, sacs et sandales de créateurs locaux.", sectors: ["mode"], media: "fabrics" },
  { slug: "beaute", id: "beauty", label: "Beauté et cosmétiques", short: "Beauté", description: "Soins naturels, beurre de karité, coiffure et salons de beauté.", sectors: ["beaute", "salon"], media: "braids" },
  { slug: "electronique", id: "electronics", label: "Électronique et téléphonie", short: "Électronique", description: "Téléphones garantis, accessoires, audio et informatique.", sectors: [], media: "electronicsShop" },
  { slug: "epicerie", id: "grocery", label: "Alimentation et épicerie", short: "Épicerie", description: "Produits frais, épices, céréales et produits du terroir.", sectors: [], media: "market" },
  { slug: "maison", id: "home", label: "Maison et décoration", short: "Maison", description: "Textiles, objets de décoration et équipement de la maison.", sectors: [], media: "boutique" },
  { slug: "services", id: "services", label: "Services et prestations", short: "Services", description: "Prestations sur rendez-vous, cliniques, ateliers et réparations.", sectors: ["clinique"], media: "laptopBraids" },
  { slug: "general", id: "general", label: "Boutiques générales", short: "Général", description: "Un peu de tout, près de chez vous.", sectors: [], media: "shopCounter" },
];

export function categoryBySlug(slug: string | null | undefined): MarketplaceCategory | undefined {
  if (!slug) return undefined;
  return MARKETPLACE_CATEGORIES.find((c) => c.slug === slug);
}

/** Catégorie d'une boutique à partir de `category` puis `sector`. */
export function categoryForStore(store: { category: string; sector?: string | null }): MarketplaceCategory {
  return (
    MARKETPLACE_CATEGORIES.find((c) => c.id === store.category) ??
    MARKETPLACE_CATEGORIES.find((c) => !!store.sector && c.sectors.includes(store.sector)) ??
    MARKETPLACE_CATEGORIES[MARKETPLACE_CATEGORIES.length - 1]
  );
}

/** Slug d'URL d'une ville (« Porto-Novo » → « porto-novo »). */
export function citySlug(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
