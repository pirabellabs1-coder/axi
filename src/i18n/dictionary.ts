import { DEFAULT_LOCALE, isPlatformLocale } from "./locales";
import { fr, type StorefrontDictionary, type StorefrontKey } from "./storefront/fr";
import { en } from "./storefront/en";
import { pt } from "./storefront/pt";
import { es } from "./storefront/es";
import { ar } from "./storefront/ar";
import { wo } from "./storefront/wo";
import { fon } from "./storefront/fon";
import { yo } from "./storefront/yo";
import { ha } from "./storefront/ha";
import { sw } from "./storefront/sw";
import { ln } from "./storefront/ln";
import { bm } from "./storefront/bm";

/**
 * Libellés d'interface de la vitrine (lot 2 §1.1). Module PUR (client et serveur).
 *
 *  - le français est complet et sert de repli pour TOUTE clé absente ;
 *  - l'anglais est complet ; les autres langues sont partielles (langues locales validées par des locuteurs) ;
 *  - le repli est fait clé par clé : un libellé est soit entièrement traduit, soit entièrement en français.
 *    On ne mélange jamais deux langues DANS un même libellé.
 */

export type { StorefrontKey, StorefrontDictionary };

const DICTIONARIES: Record<string, StorefrontDictionary> = { fr, en, pt, es, ar, wo, fon, yo, ha, sw, ln, bm };

/** Dictionnaire brut d'une langue (vide si la langue est inconnue). */
export function rawDictionary(locale: string): StorefrontDictionary {
  return DICTIONARIES[locale] ?? {};
}

export type Translator = {
  locale: string;
  /** Libellé traduit, repli français, puis la clé elle-même si elle est inconnue. */
  t: (key: StorefrontKey, vars?: Record<string, string | number>) => string;
  /** Vrai si la langue couvre réellement cette clé (sans repli). */
  has: (key: StorefrontKey) => boolean;
};

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([a-z_]+)\}/gi, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Traducteur d'interface d'une langue. Jamais d'exception : la clé inconnue est renvoyée telle quelle. */
export function storefrontTranslator(locale: string | null | undefined): Translator {
  const code = isPlatformLocale(locale) ? locale : DEFAULT_LOCALE;
  const dict = rawDictionary(code);
  return {
    locale: code,
    has: (key) => typeof dict[key] === "string" && dict[key] !== "",
    t: (key, vars) => interpolate(dict[key] ?? fr[key] ?? String(key), vars),
  };
}

/** Clés de `StoreInfo.copy` (formules de secteur) traduites par le dictionnaire. */
const COPY_KEYS = [
  "browseCta",
  "catalogTitle",
  "featuredTitle",
  "addLabel",
  "searchPlaceholder",
  "emptyCatalog",
  "pickupTitle",
  "pickupHint",
  "slotLabel",
  "checkoutTitle",
  "confirmLabel",
  "itemNoun",
] as const;

/**
 * Traduit les formules de secteur (`StoreInfo.copy`). En langue principale (ou si la langue ne couvre pas la
 * clé), la formule du secteur choisie par le commerçant est conservée : elle est plus précise que le
 * dictionnaire générique (« Nos douceurs » plutôt que « Nos produits »).
 */
export function localizeSectorCopy<T extends Record<string, string>>(copy: T, locale: string): T {
  const code = isPlatformLocale(locale) ? locale : DEFAULT_LOCALE;
  if (code === DEFAULT_LOCALE) return copy;
  const dict = rawDictionary(code);
  const out = { ...copy };
  for (const key of COPY_KEYS) {
    const value = dict[`copy.${key}` as StorefrontKey];
    if (typeof value === "string" && value) (out as Record<string, string>)[key] = value;
  }
  return out;
}

/** Couverture d'une langue (écran marchand) : part des clés d'interface réellement traduites. */
export function dictionaryCoverage(locale: string): { translated: number; total: number } {
  const total = Object.keys(fr).length;
  if (locale === DEFAULT_LOCALE) return { translated: total, total };
  const dict = rawDictionary(locale);
  return { translated: Object.keys(fr).filter((k) => typeof dict[k as StorefrontKey] === "string").length, total };
}
