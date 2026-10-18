/**
 * Marchés TikTok Shop ouverts aux vendeurs (région renvoyée par `GET /authorization/202309/shops` → `shops[].region`).
 * Module PUR (importable côté client).
 *
 * TikTok n'ouvre PAS de marché en Afrique subsaharienne : un marchand béninois ne peut vendre sur TikTok Shop qu'avec
 * une entité (société, compte bancaire, adresse d'expédition) enregistrée dans l'un de ces pays. Liste à revoir à
 * chaque ouverture annoncée par TikTok ; la vérité opérationnelle reste la région de la boutique autorisée.
 */
export type TiktokMarket = {
  /** Code région TikTok (ISO 3166-1 alpha-2 ; « GB » pour le Royaume-Uni). */
  region: string;
  name: string;
  /** Devise imposée par le marché : prix, commandes et versements. */
  currency: string;
  /** Décimales attendues par TikTok dans les prix (chaînes) : IDR, VND et JPY sans décimales. */
  priceDecimals: number;
  /** Hôte d'autorisation vendeur (les vendeurs US passent par l'hôte dédié). */
  authHost: "global" | "us";
};

export const TIKTOK_MARKETS: readonly TiktokMarket[] = [
  { region: "US", name: "États-Unis", currency: "USD", priceDecimals: 2, authHost: "us" },
  { region: "GB", name: "Royaume-Uni", currency: "GBP", priceDecimals: 2, authHost: "global" },
  { region: "FR", name: "France", currency: "EUR", priceDecimals: 2, authHost: "global" },
  { region: "DE", name: "Allemagne", currency: "EUR", priceDecimals: 2, authHost: "global" },
  { region: "IT", name: "Italie", currency: "EUR", priceDecimals: 2, authHost: "global" },
  { region: "ES", name: "Espagne", currency: "EUR", priceDecimals: 2, authHost: "global" },
  { region: "IE", name: "Irlande", currency: "EUR", priceDecimals: 2, authHost: "global" },
  { region: "MX", name: "Mexique", currency: "MXN", priceDecimals: 2, authHost: "global" },
  { region: "BR", name: "Brésil", currency: "BRL", priceDecimals: 2, authHost: "global" },
  { region: "JP", name: "Japon", currency: "JPY", priceDecimals: 0, authHost: "global" },
  { region: "ID", name: "Indonésie", currency: "IDR", priceDecimals: 0, authHost: "global" },
  { region: "MY", name: "Malaisie", currency: "MYR", priceDecimals: 2, authHost: "global" },
  { region: "TH", name: "Thaïlande", currency: "THB", priceDecimals: 2, authHost: "global" },
  { region: "VN", name: "Viêt Nam", currency: "VND", priceDecimals: 0, authHost: "global" },
  { region: "PH", name: "Philippines", currency: "PHP", priceDecimals: 2, authHost: "global" },
  { region: "SG", name: "Singapour", currency: "SGD", priceDecimals: 2, authHost: "global" },
];

/** « UK » est parfois renvoyé pour le Royaume-Uni. */
export function normalizeRegion(region: string | null | undefined): string {
  const r = String(region ?? "").trim().toUpperCase();
  return r === "UK" ? "GB" : r;
}

export function marketFor(region: string | null | undefined): TiktokMarket | null {
  const r = normalizeRegion(region);
  return TIKTOK_MARKETS.find((m) => m.region === r) ?? null;
}

/** Le pays de la boutique Axi est-il un marché TikTok Shop ? (information : la région de la boutique TikTok fait foi). */
export function isCountryCovered(country: string | null | undefined): boolean {
  return marketFor(country) !== null;
}

export function marketNames(): string {
  return TIKTOK_MARKETS.map((m) => m.name).join(", ");
}
