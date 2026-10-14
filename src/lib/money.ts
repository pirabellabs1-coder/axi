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

/**
 * Saisie des montants (formulaires marchands). Le stockage est TOUJOURS en unités mineures (centimes pour EUR/USD,
 * francs pour XOF) ; le commerçant saisit en unités MAJEURES (« 12,50 » €, « 15000 » FCFA).
 */
export const MAX_MONEY_MINOR = 1_000_000_000;

/** Montant stocké → valeur de champ (« 1250 » EUR → « 12.50 » ; « 15000 » XOF → « 15000 »). Vide si null. */
export function minorToInput(amount: number | null | undefined, currency = "XOF"): string {
  if (amount == null) return "";
  const decimals = currencyDecimals(currency);
  if (decimals === 0) return String(amount);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  return minor === 0 ? `${sign}${major}` : `${sign}${major}.${String(minor).padStart(2, "0")}`;
}

/** Filtre de frappe : chiffres seuls pour une devise sans décimales ; sinon un séparateur et 2 décimales max. */
export function sanitizeMoneyInput(input: string, currency = "XOF"): string {
  if (currencyDecimals(currency) === 0) return input.replace(/[^\d]/g, "");
  const s = input.replace(/[^\d.,]/g, "").replace(",", ".");
  const i = s.indexOf(".");
  if (i === -1) return s;
  return `${s.slice(0, i)}.${s.slice(i + 1).replace(/\./g, "").slice(0, 2)}`;
}

/** Pas de saisie d'un `<input type="number">` (« 1 » ou « 0.01 »). */
export function moneyStep(currency = "XOF"): string {
  return currencyDecimals(currency) === 0 ? "1" : "0.01";
}

/**
 * Lecture serveur d'un champ montant saisi en unités majeures. `empty` : valeur si le champ est vide
 * (`null` = facultatif). Retourne `{ ok: false }` si la saisie est invalide ou hors bornes.
 */
export function readMoneyField(raw: unknown, currency: string, empty: number | null): { ok: true; value: number | null } | { ok: false } {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return { ok: true, value: empty };
  if (currencyDecimals(currency) === 0 ? !/^[\d\s ]+([.,]0*)?$/.test(s) : !/^[\d\s ]+([.,]\d{0,2})?$/.test(s)) return { ok: false };
  const v = parseMoneyInput(s, currency);
  if (v == null || v > MAX_MONEY_MINOR) return { ok: false };
  return { ok: true, value: v };
}

/** Clavier mobile adapté (`inputMode`) : numérique sans décimales, décimal sinon. */
export function moneyInputMode(currency = "XOF"): "numeric" | "decimal" {
  return currencyDecimals(currency) === 0 ? "numeric" : "decimal";
}
