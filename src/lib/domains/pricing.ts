/**
 * Tarification des noms de domaine (module PUR, testé : tests/domains-registration.test.ts).
 *
 *   coût de gros     = (prix Route 53 + zone DNS hébergée ~6 $/an) (USD, centimes) × années
 *                      — la zone Route 53 (0,50 $/mois) est facturée par AWS pour chaque domaine : sans elle,
 *                        un .com à marge minimale serait vendu à perte.
 *   marge (USD)      = max(coût × pourcentage, minimum par année × années)
 *   total (USD)      = coût + marge
 *   prix marchand    = total converti dans la devise de la boutique (taux plateforme BCE, src/lib/currency),
 *                      arrondi SUPÉRIEUR « propre » : 100 unités pour une devise sans décimales (XOF, JPY…),
 *                      unité entière pour une devise à centimes (EUR, USD…)
 *   marge (devise)   = prix marchand − coût converti au plus proche (l'arrondi profite à la marge, jamais au coût)
 *
 * Aucune opération flottante sur les montants : fractions exactes (BigInt) de src/lib/currency/convert.ts.
 */
import { currencyDecimals } from "@/lib/money";
import { exactMinor, formatRate, type FxRate } from "@/lib/currency/convert";
import { ceilDiv, roundHalfUp } from "@/lib/currency/rounding";

export type MarginSettings = {
  /** Pourcentage en points de base (1500 = 15 %). */
  percentBps: number;
  /** Marge minimale par année, en centimes USD. */
  minUsdCentsPerYear: number;
};

/** Coût annuel de la zone DNS hébergée Route 53 créée pour chaque domaine (0,50 $/mois). */
export const HOSTED_ZONE_USD_CENTS_PER_YEAR = 600;

export const DEFAULT_MARGIN: MarginSettings = { percentBps: 2000, minUsdCentsPerYear: 500 };
export const MAX_MARGIN_BPS = 30_000; // 300 %
export const MAX_YEARS = 10;

export function normalizeMargin(raw: Partial<MarginSettings> | null | undefined): MarginSettings {
  const p = Number(raw?.percentBps);
  const m = Number(raw?.minUsdCentsPerYear);
  return {
    percentBps: Number.isInteger(p) && p >= 0 && p <= MAX_MARGIN_BPS ? p : DEFAULT_MARGIN.percentBps,
    minUsdCentsPerYear: Number.isInteger(m) && m >= 0 && m <= 100_000 ? m : DEFAULT_MARGIN.minUsdCentsPerYear,
  };
}

/** Marge et total en USD (centimes) pour un coût de gros. */
export function usdTotals(wholesaleUsdCentsPerYear: number, years: number, margin: MarginSettings) {
  if (!Number.isInteger(wholesaleUsdCentsPerYear) || wholesaleUsdCentsPerYear <= 0) throw new Error("Coût de gros invalide");
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) throw new Error("Durée invalide");
  const cost = (wholesaleUsdCentsPerYear + HOSTED_ZONE_USD_CENTS_PER_YEAR) * years;
  const pct = Number(roundHalfUp(BigInt(cost) * BigInt(margin.percentBps), BigInt(10_000)));
  const marginUsd = Math.max(pct, margin.minUsdCentsPerYear * years);
  return { costUsdCents: cost, marginUsdCents: marginUsd, totalUsdCents: cost + marginUsd };
}

/**
 * Pas d'arrondi « propre » en unités mineures : 100 dans tous les cas, soit 100 unités pour une devise sans
 * décimales (100 FCFA, 100 yens) et une unité entière pour une devise à centimes (1,00 €).
 */
export function cleanStep(): number {
  return 100;
}

export type DomainPrice = {
  currency: string;
  years: number;
  costUsdCents: number;
  marginUsdCents: number;
  totalUsdCents: number;
  /** Prix facturé au marchand (unités mineures de `currency`). */
  price: number;
  /** Coût converti (unités mineures de `currency`, au plus proche). */
  cost: number;
  /** Commission Axi = price − cost (unités mineures de `currency`). */
  margin: number;
  /** Taux USD → devise (10 décimales), null si la devise est l'USD. */
  fxRate: string | null;
  marginPercentBps: number;
};

/**
 * Prix marchand. `rate` = 1 USD en unités majeures de `currency` (ONE si USD).
 */
export function priceDomain(p: { wholesaleUsdCentsPerYear: number; years: number; currency: string; rate: FxRate; margin: MarginSettings }): DomainPrice {
  const t = usdTotals(p.wholesaleUsdCentsPerYear, p.years, p.margin);
  const fx = { rate: p.rate, baseDecimals: 2, quoteDecimals: currencyDecimals(p.currency) };
  const total = exactMinor(t.totalUsdCents, fx);
  const step = BigInt(cleanStep());
  const price = Number(ceilDiv(total.num, total.den * step) * step);
  const costExact = exactMinor(t.costUsdCents, fx);
  const cost = Number(roundHalfUp(costExact.num, costExact.den));
  return {
    currency: p.currency,
    years: p.years,
    ...t,
    price,
    cost,
    margin: price - cost,
    fxRate: p.currency === "USD" ? null : formatRate(p.rate),
    marginPercentBps: p.margin.percentBps,
  };
}

/** Montant USD en centimes depuis un prix Route 53 (nombre décimal en dollars). */
export function usdToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Prix registrar invalide");
  return Math.round(amount * 100);
}

