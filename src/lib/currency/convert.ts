/**
 * Conversion de devises (spécification lot 2, §1.2). Module PUR, importable côté client et testé
 * (tests/currency-convert.test.ts).
 *
 * Représentation : un taux est une FRACTION EXACTE `num / den` (BigInt) d'unités MAJEURES de la devise cible pour
 * une unité majeure de la devise source. Les taux saisis ou importés ont au plus 10 décimales (`parseRate`) ; les
 * parités fixes BCEAO (XOF/EUR = XAF/EUR = 655,957 ; XOF/XAF = 1) sont codées en dur et composées exactement
 * (XOF → EUR = 1000 / 655957, sans arrondi intermédiaire). Aucune opération flottante.
 *
 *   tauxEff   = taux × (10 000 + markupBps) / 10 000
 *   brutMinor = montantMinorBase × tauxEff × 10^(décimalesCible − décimalesBase)
 *   résultat  = arrondi(brutMinor, règle)        (prix catalogue, livraison)
 *             = round(brutMinor)                 (remises, avoir : « Math.round », jamais de règle commerciale)
 */
import { currencyDecimals } from "@/lib/money";
import { applyRounding, isRoundingRule, pow10, roundHalfUp, type RoundingRuleId } from "./rounding";

export type FxRate = { num: bigint; den: bigint };

/** 10 décimales (ExchangeRate.rate, StoreCurrency.manualRate, Order.presentmentRate : Decimal(20, 10)). */
export const RATE_DECIMALS = 10;
export const RATE_SCALE = pow10(RATE_DECIMALS);
/** Un taux plus vieux que 72 h désactive l'affichage converti (repli sur la devise de la boutique). */
export const FX_MAX_AGE_MS = 72 * 3600_000;
/** Cotation verrouillée au checkout (Cart.fxQuote). */
export const FX_QUOTE_TTL_MS = 15 * 60_000;
export const MAX_MARKUP_BPS = 500;

const B0 = BigInt(0);
const B1 = BigInt(1);

function gcd(a: bigint, b: bigint): bigint {
  let x = a < B0 ? -a : a;
  let y = b < B0 ? -b : b;
  while (y !== B0) [x, y] = [y, x % y];
  return x === B0 ? B1 : x;
}

export function reduce(r: FxRate): FxRate {
  const g = gcd(r.num, r.den);
  return { num: r.num / g, den: r.den / g };
}

export const ONE: FxRate = { num: B1, den: B1 };

export function mul(a: FxRate, b: FxRate): FxRate {
  return reduce({ num: a.num * b.num, den: a.den * b.den });
}

export function invert(r: FxRate): FxRate {
  if (r.num === B0) throw new Error("Taux nul : inversion impossible");
  return { num: r.den, den: r.num };
}

/**
 * Lit un taux décimal (« 655.957 », « 0,0015244902 », Prisma.Decimal, nombre) : au plus 10 décimales, l'excédent
 * est arrondi au plus proche. Retourne null si invalide ou ≤ 0.
 */
export function parseRate(raw: unknown): FxRate | null {
  if (raw == null) return null;
  let s = typeof raw === "string" ? raw : typeof raw === "number" ? (Number.isFinite(raw) ? raw.toFixed(12) : "") : String(raw);
  s = s.trim().replace(",", ".").replace(/\s/g, "");
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  let scaled: bigint;
  if (frac.length <= RATE_DECIMALS) {
    scaled = BigInt(m[1] + frac.padEnd(RATE_DECIMALS, "0"));
  } else {
    const all = BigInt(m[1] + frac);
    scaled = roundHalfUp(all, pow10(frac.length - RATE_DECIMALS));
  }
  if (scaled <= B0) return null;
  return reduce({ num: scaled, den: RATE_SCALE });
}

/** Taux à 10 décimales (chaîne « 0.0015244902 ») pour l'affichage, Decimal(20, 10) et l'instantané. */
export function formatRate(r: FxRate): string {
  const scaled = roundHalfUp(r.num * RATE_SCALE, r.den);
  const s = scaled.toString().padStart(RATE_DECIMALS + 1, "0");
  return `${s.slice(0, -RATE_DECIMALS)}.${s.slice(-RATE_DECIMALS)}`;
}

/** Taux effectif avec la marge de change (0..500 points de base). */
export function withMarkup(r: FxRate, markupBps: number): FxRate {
  const bps = Math.min(MAX_MARKUP_BPS, Math.max(0, Math.trunc(markupBps || 0)));
  if (bps === 0) return r;
  return reduce({ num: r.num * BigInt(10_000 + bps), den: r.den * BigInt(10_000) });
}

/* ───────────────────────── Parités fixes et résolution ───────────────────────── */

/** Parités fixes (source BCEAO_FIXED), exprimées en « 1 EUR = x ». */
export const FIXED_EUR_PARITIES: Readonly<Record<string, FxRate>> = {
  XOF: { num: BigInt(655957), den: BigInt(1000) },
  XAF: { num: BigInt(655957), den: BigInt(1000) },
};

export type RateRow = { base: string; quote: string; rate: unknown; source: string; fetchedAt: Date };

export type ResolvedRate = {
  rate: FxRate;
  /** « BCEAO_FIXED », « ECB », « manual », « identity », ou composition « ECB+BCEAO_FIXED ». */
  source: string;
  /** Date de la jambe la plus ancienne ; null = parité fixe (jamais périmée). */
  fetchedAt: Date | null;
};

/** 1 EUR = x `currency` : parité fixe, sinon ligne plateforme EUR → currency. */
function eurTo(currency: string, rows: readonly RateRow[]): ResolvedRate | null {
  if (currency === "EUR") return { rate: ONE, source: "identity", fetchedAt: null };
  const fixed = FIXED_EUR_PARITIES[currency];
  if (fixed) return { rate: fixed, source: "BCEAO_FIXED", fetchedAt: null };
  const row = rows.find((r) => r.base === "EUR" && r.quote === currency);
  const rate = row ? parseRate(row.rate) : null;
  return row && rate ? { rate, source: row.source, fetchedAt: row.fetchedAt } : null;
}

const older = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));

/**
 * Taux plateforme `base → quote` (1 unité majeure de base = x unités majeures de quote). Ordre :
 *  1. identité ; 2. parités fixes BCEAO composées exactement (XOF ↔ EUR ↔ XAF) ;
 *  3. ligne directe `base → quote` (taux saisi par l'administrateur) ;
 *  4. pivot EUR (taux BCE) : (1 / EUR→base) × EUR→quote.
 * Retourne null si une jambe manque. La fraîcheur est vérifiée par `isFresh`.
 */
export function resolvePlatformRate(base: string, quote: string, rows: readonly RateRow[]): ResolvedRate | null {
  if (base === quote) return { rate: ONE, source: "identity", fetchedAt: null };
  const fixedBase = base === "EUR" || !!FIXED_EUR_PARITIES[base];
  const fixedQuote = quote === "EUR" || !!FIXED_EUR_PARITIES[quote];
  if (!(fixedBase && fixedQuote)) {
    const direct = rows.find((r) => r.base === base && r.quote === quote);
    const rate = direct ? parseRate(direct.rate) : null;
    if (direct && rate) return { rate, source: direct.source, fetchedAt: direct.fetchedAt };
  }
  const a = eurTo(base, rows);
  const b = eurTo(quote, rows);
  if (!a || !b) return null;
  const sources = [...new Set([a.source, b.source].filter((s) => s !== "identity"))];
  return { rate: mul(invert(a.rate), b.rate), source: sources.join("+") || "identity", fetchedAt: older(a.fetchedAt, b.fetchedAt) };
}

export function isFresh(r: Pick<ResolvedRate, "fetchedAt">, now: Date, maxAgeMs = FX_MAX_AGE_MS): boolean {
  return r.fetchedAt == null || now.getTime() - r.fetchedAt.getTime() <= maxAgeMs;
}

/* ───────────────────────── Contexte de conversion ───────────────────────── */

/** Contexte de conversion d'une boutique vers une devise d'affichage (taux effectif, marge comprise). */
export type FxContext = {
  base: string;
  quote: string;
  /** Taux effectif (marge comprise) : 1 unité majeure de base = rate unités majeures de quote. */
  rate: FxRate;
  markupBps: number;
  rounding: RoundingRuleId;
  baseDecimals: number;
  quoteDecimals: number;
  source: string;
};

export function makeFx(p: { base: string; quote: string; rate: FxRate; markupBps?: number; rounding: RoundingRuleId; source?: string; rateIncludesMarkup?: boolean }): FxContext {
  const markupBps = Math.min(MAX_MARKUP_BPS, Math.max(0, Math.trunc(p.markupBps ?? 0)));
  return {
    base: p.base,
    quote: p.quote,
    rate: p.rateIncludesMarkup ? reduce(p.rate) : withMarkup(p.rate, markupBps),
    markupBps,
    rounding: p.rounding,
    baseDecimals: currencyDecimals(p.base),
    quoteDecimals: currencyDecimals(p.quote),
    source: p.source ?? "manual",
  };
}

/** Valeur exacte (fraction d'unités mineures de la devise cible) d'un montant en unités mineures de la base. */
export function exactMinor(amountMinor: number, fx: Pick<FxContext, "rate" | "baseDecimals" | "quoteDecimals">): { num: bigint; den: bigint } {
  if (!Number.isInteger(amountMinor)) throw new Error("Conversion : montant entier attendu");
  const up = fx.quoteDecimals - fx.baseDecimals;
  return {
    num: BigInt(amountMinor) * fx.rate.num * (up > 0 ? pow10(up) : B1),
    den: fx.rate.den * (up < 0 ? pow10(-up) : B1),
  };
}

/** Prix catalogue ou livraison : conversion puis règle d'arrondi de la devise. */
export function convertPrice(amountMinor: number, fx: FxContext): number {
  const e = exactMinor(amountMinor, fx);
  return applyRounding(e.num, e.den, fx.rounding, fx.quoteDecimals);
}

/** Remise, avoir, montant informatif : conversion au plus proche (« Math.round »), jamais de règle commerciale. */
export function convertPlain(amountMinor: number, fx: Pick<FxContext, "rate" | "baseDecimals" | "quoteDecimals">): number {
  const e = exactMinor(amountMinor, fx);
  return Number(roundHalfUp(e.num, e.den));
}

/* ───────────────────────── Cotation (Cart.fxQuote) ───────────────────────── */

export type FxQuote = {
  currency: string;
  /** Taux effectif à 10 décimales (lisible). */
  rate: string;
  /** Fraction exacte du taux effectif (chaînes : BigInt non sérialisable en JSON). */
  num: string;
  den: string;
  markupBps: number;
  rounding: RoundingRuleId;
  source: string;
  expiresAt: string;
};

export function quoteFromFx(fx: FxContext, now: Date, ttlMs = FX_QUOTE_TTL_MS): FxQuote {
  return {
    currency: fx.quote,
    rate: formatRate(fx.rate),
    num: fx.rate.num.toString(),
    den: fx.rate.den.toString(),
    markupBps: fx.markupBps,
    rounding: fx.rounding,
    source: fx.source,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

/** Lecture tolérante d'une cotation stockée : null si absente, illisible, d'une autre devise ou expirée. */
export function readQuote(raw: unknown, base: string, currency: string, now: Date): FxContext | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Partial<FxQuote>;
  if (q.currency !== currency || typeof q.num !== "string" || typeof q.den !== "string" || typeof q.expiresAt !== "string") return null;
  const exp = Date.parse(q.expiresAt);
  if (!Number.isFinite(exp) || exp <= now.getTime()) return null;
  if (!/^\d{1,40}$/.test(q.num) || !/^\d{1,40}$/.test(q.den)) return null;
  const num = BigInt(q.num);
  const den = BigInt(q.den);
  if (num <= B0 || den <= B0) return null;
  const rounding: RoundingRuleId = isRoundingRule(q.rounding) ? q.rounding : "NONE";
  return makeFx({ base, quote: currency, rate: { num, den }, markupBps: q.markupBps ?? 0, rounding, source: q.source ?? "quote", rateIncludesMarkup: true });
}
