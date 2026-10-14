/**
 * Préréglages fiscaux INDICATIFS (spécification lot 2, §2). Le commerçant confirme toujours ses taux :
 * Axi ne fournit pas de conseil fiscal. Taux en points de base (1800 = 18 %).
 */

export const TAX_DISCLAIMER = "Axi ne fournit pas de conseil fiscal. Ces taux sont indicatifs : vérifiez-les auprès de votre administration fiscale ou de votre comptable.";

export type TaxPreset = { country: string; countryName: string; name: string; rateBps: number };

export const TAX_PRESETS: readonly TaxPreset[] = [
  { country: "BJ", countryName: "Bénin", name: "TVA", rateBps: 1800 },
  { country: "SN", countryName: "Sénégal", name: "TVA", rateBps: 1800 },
  { country: "CI", countryName: "Côte d'Ivoire", name: "TVA", rateBps: 1800 },
  { country: "TG", countryName: "Togo", name: "TVA", rateBps: 1800 },
  { country: "BF", countryName: "Burkina Faso", name: "TVA", rateBps: 1800 },
  { country: "ML", countryName: "Mali", name: "TVA", rateBps: 1800 },
  { country: "NE", countryName: "Niger", name: "TVA", rateBps: 1900 },
  { country: "CM", countryName: "Cameroun", name: "TVA", rateBps: 1925 },
  { country: "GA", countryName: "Gabon", name: "TVA", rateBps: 1800 },
  { country: "CG", countryName: "Congo", name: "TVA", rateBps: 1890 },
  { country: "GN", countryName: "Guinée", name: "TVA", rateBps: 1800 },
  { country: "FR", countryName: "France", name: "TVA", rateBps: 2000 },
];

export function taxPresetFor(country: string): TaxPreset | null {
  return TAX_PRESETS.find((p) => p.country === country.toUpperCase()) ?? null;
}

export const TAX_REGIMES = ["TVA", "TPS", "AUTRE"] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  TVA: "Assujetti à la TVA",
  TPS: "Taxe professionnelle synthétique (TPS)",
  AUTRE: "Autre régime",
};

export const TAX_CATEGORY_LABELS: Record<string, string> = {
  standard: "Taux normal",
  reduced: "Taux réduit",
  exempt: "Exonéré",
};

/** Mention par défaut d'un commerçant non assujetti (régime TPS ou taxes désactivées). */
export const DEFAULT_EXEMPTION_MENTION = "TVA non applicable";

/** Taux maximal accepté (garde-fou de saisie) : 50 %. */
export const MAX_TAX_RATE_BPS = 5000;
