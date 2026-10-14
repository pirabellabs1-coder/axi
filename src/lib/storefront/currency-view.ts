/**
 * Devise d'affichage de la vitrine : vue SÉRIALISABLE du contexte de conversion (`FxContext` contient des BigInt,
 * donc inutilisable dans `RenderData`, l'aperçu en direct ou les îlots clients du panier).
 *
 * Règles (spécification lot 2, §1.2 — voir `docs/vague2/C-devises-taxes-checkout.md`) :
 *  - les montants sont TOUJOURS calculés et encaissés dans la devise de la boutique ; l'affichage converti est
 *    indicatif et porte une mention claire (`chargeNotice`) ;
 *  - la conversion d'un prix catalogue applique la règle d'arrondi de la devise (`presentPrice`) ;
 *  - un montant informatif (remise, écart, seuil) est converti au plus proche (`viewPlain`) ;
 *  - les données structurées schema.org gardent la devise de la boutique ;
 *  - devise désactivée, absente ou taux périmé (> 72 h) : `loadStoreFx` ne fournit aucun contexte, la vue reste
 *    celle de la boutique (`storeCurrencyView`) et rien n'est converti.
 *
 * Module PUR (aucun accès base, aucun `server-only`) : testé dans `tests/storefront-currency-view.test.ts`.
 */
import { formatMoney } from "@/lib/money";
import { convertPlain, makeFx, type FxContext } from "@/lib/currency/convert";
import { isRoundingRule, type RoundingRuleId } from "@/lib/currency/rounding";
import { presentCompareAt, presentPrice } from "@/lib/currency/present";

/** Prix fixé par devise (`ProductPrice`) : clé `variantId ?? productId`. */
export type FixedPrice = { price: number; compareAt?: number | null };

export type CurrencyView = {
  /** Devise de calcul et d'encaissement (jamais convertie). */
  storeCurrency: string;
  /** Devise affichée à l'acheteur (= `storeCurrency` s'il n'y a pas de conversion). */
  currency: string;
  /** Taux effectif (marge comprise) : absent = aucune conversion. BigInt sérialisés en chaînes. */
  quote?: { num: string; den: string; markupBps: number; rounding: RoundingRuleId; source: string };
  /** Prix fixés par devise, par `variantId ?? productId` (ignorés sans conversion). */
  fixed?: Record<string, FixedPrice>;
};

/** Devise de la boutique : aucune conversion (repli d'un taux périmé ou d'une devise désactivée). */
export function storeCurrencyView(storeCurrency: string): CurrencyView {
  return { storeCurrency, currency: storeCurrency };
}

/** Vue sérialisable d'un contexte de conversion (`getDisplayCurrency`). `fx` nul = devise de la boutique. */
export function currencyView(storeCurrency: string, currency: string, fx: FxContext | null, fixed?: Record<string, FixedPrice>): CurrencyView {
  if (!fx || fx.quote === storeCurrency || fx.base !== storeCurrency) return storeCurrencyView(storeCurrency);
  return {
    storeCurrency,
    currency: fx.quote,
    quote: { num: fx.rate.num.toString(), den: fx.rate.den.toString(), markupBps: fx.markupBps, rounding: fx.rounding, source: fx.source },
    ...(fixed && Object.keys(fixed).length > 0 ? { fixed } : {}),
  };
}

export function isConverted(v: CurrencyView | null | undefined): boolean {
  return !!v?.quote && v.currency !== v.storeCurrency;
}

/** Devise d'affichage d'une vue (repli : XOF, comme `formatMoney`). */
export function viewCurrency(v: CurrencyView | null | undefined): string {
  return v?.currency ?? v?.storeCurrency ?? "XOF";
}

/* ───────────── Contexte de conversion (reconstruit une fois par vue) ───────────── */

const fxCache = new WeakMap<CurrencyView, FxContext | null>();

/** Contexte de conversion d'une vue (mémorisé par objet : une seule analyse BigInt par rendu). */
export function viewFx(v: CurrencyView | null | undefined): FxContext | null {
  if (!v || !v.quote) return null;
  if (fxCache.has(v)) return fxCache.get(v) ?? null;
  let fx: FxContext | null = null;
  try {
    const num = BigInt(v.quote.num);
    const den = BigInt(v.quote.den);
    if (num > BigInt(0) && den > BigInt(0)) {
      fx = makeFx({
        base: v.storeCurrency,
        quote: v.currency,
        rate: { num, den },
        markupBps: v.quote.markupBps,
        rounding: isRoundingRule(v.quote.rounding) ? v.quote.rounding : "NONE",
        source: v.quote.source,
        rateIncludesMarkup: true,
      });
    }
  } catch {
    fx = null; // chaîne illisible : aucune conversion (la boutique reste lisible)
  }
  fxCache.set(v, fx);
  return fx;
}

/* ───────────── Conversion des montants affichés ───────────── */

const fixedOf = (v: CurrencyView, itemKey?: string | null): FixedPrice | undefined => (itemKey ? v.fixed?.[itemKey] : undefined);

/**
 * Prix catalogue affiché (carte produit, fiche, section de thème) : prix fixé de la devise s'il existe, sinon
 * conversion arrondie selon la règle de la boutique. Sans conversion, le montant est rendu tel quel.
 */
export function viewPrice(v: CurrencyView | null | undefined, amountMinor: number, itemKey?: string | null): number {
  const fx = viewFx(v);
  if (!fx || !v) return amountMinor;
  return presentPrice(amountMinor, fx, fixedOf(v, itemKey)?.price ?? null);
}

/** Prix barré converti avec la même règle ; null s'il n'est plus supérieur au prix affiché. */
export function viewCompareAt(v: CurrencyView | null | undefined, compareAtMinor: number | null | undefined, shownPrice: number, itemKey?: string | null): number | null {
  if (compareAtMinor == null) return null;
  const fx = viewFx(v);
  if (!fx || !v) return compareAtMinor > shownPrice ? compareAtMinor : null;
  return presentCompareAt(compareAtMinor, shownPrice, fx, fixedOf(v, itemKey)?.compareAt ?? null);
}

/** Montant informatif (remise, écart, seuil, sous-total indicatif) : conversion au plus proche, sans arrondi commercial. */
export function viewPlain(v: CurrencyView | null | undefined, amountMinor: number): number {
  const fx = viewFx(v);
  return fx ? convertPlain(amountMinor, fx) : amountMinor;
}

/* ───────────── Formatage ───────────── */

/** Prix catalogue formaté dans la devise d'affichage. */
export function viewMoney(v: CurrencyView | null | undefined, amountMinor: number, itemKey?: string | null): string {
  return formatMoney(viewPrice(v, amountMinor, itemKey), viewCurrency(v));
}

/** Montant informatif formaté dans la devise d'affichage (remise, seuil, total indicatif du panier). */
export function viewPlainMoney(v: CurrencyView | null | undefined, amountMinor: number): string {
  return formatMoney(viewPlain(v, amountMinor), viewCurrency(v));
}

/** Montant formaté dans la devise de la boutique (données structurées, cartes cadeaux, filtres de prix). */
export function storeMoney(v: CurrencyView | null | undefined, amountMinor: number): string {
  return formatMoney(amountMinor, v?.storeCurrency ?? "XOF");
}

/** Nom court d'une devise tel qu'affiché à l'acheteur (« FCFA » pour les francs CFA). */
export function currencyShortLabel(code: string): string {
  return code === "XOF" || code === "XAF" ? "FCFA" : code;
}

/**
 * Mention obligatoire quand l'affichage est converti : l'encaissement a lieu dans la devise de la boutique.
 * null s'il n'y a pas de conversion (rien à signaler).
 */
export function chargeNotice(v: CurrencyView | null | undefined): string | null {
  if (!isConverted(v)) return null;
  return `Prix indicatifs convertis en ${currencyShortLabel(v!.currency)} : vous serez débité en ${currencyShortLabel(v!.storeCurrency)}.`;
}

/** Mention courte, sous un prix (fiche produit). */
export function chargeNoticeShort(v: CurrencyView | null | undefined): string | null {
  if (!isConverted(v)) return null;
  return `Vous serez débité en ${currencyShortLabel(v!.storeCurrency)}.`;
}
