/**
 * Montants en unités monétaires entières (XOF/XAF : pas de centimes ; EUR : centimes).
 * Aucune conversion implicite entre devises.
 */
const ZERO_DECIMAL = new Set(["XOF", "XAF", "CDF", "GNF", "RWF", "UGX", "JPY", "KRW"]);

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

export function formatMoney(amount: number, currency = "XOF", opts: { compact?: boolean } = {}): string {
  const decimals = currencyDecimals(currency);
  const value = decimals === 0 ? amount : amount / 100;
  if (currency === "XOF" || currency === "XAF") {
    const n = new Intl.NumberFormat("fr-FR", {
      maximumFractionDigits: 0,
      notation: opts.compact ? "compact" : "standard",
    }).format(value);
    // Espace insécable entre le nombre et FCFA
    return `${n} FCFA`;
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: decimals,
    notation: opts.compact ? "compact" : "standard",
  }).format(value);
}

/** Convertit une saisie utilisateur ("4 900", "4900", "49,00") en unités entières. */
export function parseMoneyInput(input: string, currency = "XOF"): number | null {
  const cleaned = input.replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  const decimals = currencyDecimals(currency);
  return Math.round(n * (decimals === 0 ? 1 : 100));
}

export function percentOf(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100);
}
