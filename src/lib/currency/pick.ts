/**
 * Choix de la devise d'affichage d'un acheteur (spécification lot 2, §1.2). Module PUR, testé.
 * Ordre : cookie `axi_cur` (choix explicite) → pays de l'IP fourni par l'hébergeur (`x-vercel-ip-country`) →
 * région de la langue du navigateur (`Accept-Language`) → devise de la boutique. Seule une devise ACTIVE et
 * affichable (taux frais) est retenue.
 */

export const CURRENCY_COOKIE = "axi_cur";
/** Un an : simple préférence d'affichage (pas une donnée sensible ; lisible par le script de la page). */
export const CURRENCY_COOKIE_MAX_AGE = 365 * 24 * 3600;

/** Devise usuelle par pays (ISO 3166-1 alpha-2), limitée aux marchés probables de la plateforme. */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  BJ: "XOF", SN: "XOF", CI: "XOF", TG: "XOF", BF: "XOF", ML: "XOF", NE: "XOF", GW: "XOF",
  CM: "XAF", GA: "XAF", CG: "XAF", TD: "XAF", CF: "XAF", GQ: "XAF",
  FR: "EUR", BE: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", PT: "EUR", NL: "EUR", LU: "EUR", IE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR", MC: "EUR",
  US: "USD", GB: "GBP", CA: "CAD", CH: "CHF", NG: "NGN", GH: "GHS", MA: "MAD", TN: "TND", DZ: "DZD", GN: "GNF", CD: "CDF", RW: "RWF", CN: "CNY", JP: "JPY", AE: "AED",
};

export const isCurrencyCode = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{3}$/.test(v);

function countryFromLanguage(acceptLanguage: string | null | undefined): string | null {
  if (!acceptLanguage) return null;
  for (const part of acceptLanguage.split(",").slice(0, 8)) {
    const tag = part.split(";")[0]?.trim();
    const region = tag?.split("-")[1];
    if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  }
  return null;
}

export function pickDisplayCurrency(p: { cookie?: string | null; ipCountry?: string | null; acceptLanguage?: string | null; available: readonly string[]; storeCurrency: string }): string {
  const ok = (c: string | null | undefined): c is string => !!c && (c === p.storeCurrency || p.available.includes(c));
  if (isCurrencyCode(p.cookie) && ok(p.cookie)) return p.cookie;
  const ip = p.ipCountry && /^[A-Za-z]{2}$/.test(p.ipCountry) ? COUNTRY_CURRENCY[p.ipCountry.toUpperCase()] : undefined;
  if (ok(ip)) return ip;
  const lang = countryFromLanguage(p.acceptLanguage);
  const fromLang = lang ? COUNTRY_CURRENCY[lang] : undefined;
  if (ok(fromLang)) return fromLang;
  return p.storeCurrency;
}

/** Libellés courts des devises proposées (sélecteur, écran /devises). */
export const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  XOF: "Franc CFA (UEMOA)", XAF: "Franc CFA (CEMAC)", EUR: "Euro", USD: "Dollar américain", GBP: "Livre sterling", CAD: "Dollar canadien",
  CHF: "Franc suisse", NGN: "Naira", GHS: "Cedi", MAD: "Dirham marocain", TND: "Dinar tunisien", DZD: "Dinar algérien", GNF: "Franc guinéen",
  CDF: "Franc congolais", RWF: "Franc rwandais", CNY: "Yuan", JPY: "Yen", AED: "Dirham des Émirats",
};

export function currencyName(code: string): string {
  return CURRENCY_NAMES[code] ?? code;
}
