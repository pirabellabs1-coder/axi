/**
 * Devises qu'un commerçant peut choisir comme devise de SA boutique (création, paramètres). Module PUR, testé
 * (tests/store-currency.test.ts), importable côté client.
 *
 * Critères d'inclusion :
 *  - formatage : `formatMoney` / `currencyDecimals` (src/lib/money.ts) connaissent le nombre de décimales ISO 4217
 *    (0 pour XOF/XAF/GNF/CDF, 2 pour les autres) ; les montants sont stockés en unités MINEURES (centimes) ;
 *  - paiement : le paiement à la livraison et les moyens manuels fonctionnent dans toutes ces devises ; les
 *    passerelles en ligne déclarent leurs propres `supportedCurrencies` (src/lib/payments/**) et ne sont proposées
 *    que si elles acceptent la devise de la boutique.
 * Ajouter une devise ici = vérifier ses décimales dans `ZERO_DECIMAL` (money.ts) et son nom dans `CURRENCY_NAMES`.
 */
import { COUNTRY_CURRENCY, currencyName } from "./pick";

export const STORE_CURRENCIES = ["XOF", "XAF", "EUR", "USD", "GBP", "CAD", "CHF", "MAD", "NGN", "GHS", "KES", "ZAR", "GNF", "CDF"] as const;
export type StoreCurrencyCode = (typeof STORE_CURRENCIES)[number];

export function isStoreCurrency(v: unknown): v is StoreCurrencyCode {
  return typeof v === "string" && (STORE_CURRENCIES as readonly string[]).includes(v);
}

/** Devise proposée par défaut pour un pays (modifiable par le commerçant) ; repli sur la devise du pays, puis XOF. */
export function defaultStoreCurrency(country: string, countryCurrency?: string): StoreCurrencyCode {
  const guess = COUNTRY_CURRENCY[country.toUpperCase()] ?? countryCurrency;
  if (isStoreCurrency(guess)) return guess;
  if (isStoreCurrency(countryCurrency)) return countryCurrency;
  return "XOF";
}

/** Libellé de sélecteur : « Euro (EUR) », « Franc CFA (UEMOA) (XOF) ». */
export function storeCurrencyLabel(code: string): string {
  return `${currencyName(code)} (${code})`;
}

export const STORE_CURRENCY_OPTIONS: readonly { code: StoreCurrencyCode; label: string }[] = STORE_CURRENCIES.map((code) => ({ code, label: storeCurrencyLabel(code) }));

/** Message affiché quand la devise ne peut plus changer (boutique ayant déjà des commandes). */
export const CURRENCY_LOCKED_MESSAGE =
  "La devise ne peut plus être modifiée : votre boutique a déjà des commandes ou des cartes cadeaux, et leur historique comptable (totaux, remboursements, factures, soldes) est enregistré dans la devise actuelle.";

/** Règle de changement de devise : autorisé uniquement tant qu'aucune commande n'existe. */
export function canChangeStoreCurrency(orderCount: number): boolean {
  return orderCount === 0;
}
