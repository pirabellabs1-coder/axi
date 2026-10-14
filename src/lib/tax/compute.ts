/**
 * Calcul des taxes (spécification lot 2, §2). Fonctions PURES, sans accès base :
 * contrat partagé avec le pipeline de commande (équipe C, `src/lib/commerce/**`).
 *
 * Règles :
 *  - calcul sur le NET de chaque ligne (après remises allouées), arrondi par ligne
 *    (demi-unité vers le haut, arithmétique entière, aucune dérive flottante) ;
 *  - TTC (`pricesIncludeTax`) : taxe = round(net × bps / (10 000 + bps)), le total ne change pas (« dont TVA ») ;
 *  - HT : taxe = round(net × bps / 10 000), total = net + livraison + taxes (`addToTotal`) ;
 *  - ligne non taxable, catégorie `exempt` ou sans taux pour sa catégorie : taxe 0, `taxRateBps` null ;
 *  - livraison taxée au taux de la catégorie `standard` si ce taux a `appliesToShipping` ;
 *  - `taxLines` regroupe par (nom, taux) ; `base` = base HORS TAXE (TTC : net − taxe ; HT : net),
 *    `amount` = somme des taxes arrondies par ligne (donc Σ amount = taxTotal, exactement).
 *  - L'écart d'arrondi par ligne (≤ 1 unité par ligne vs. un calcul global) est assumé et documenté.
 */

export const TAX_CATEGORIES = ["standard", "reduced", "exempt"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export type TaxRateInput = {
  name: string;
  rateBps: number;
  taxCategory: string;
  appliesToShipping: boolean;
};

export type TaxSettingsInput = {
  enabled: boolean;
  pricesIncludeTax: boolean;
  /** Taux ACTIFS du pays de taxation (Store.country au lot 2). */
  rates: readonly TaxRateInput[];
};

export type TaxLineInput = {
  /** Montant net de la ligne (après remises allouées), entier, unité mineure de la devise de la boutique. */
  net: number;
  taxable: boolean;
  taxCategory: string;
};

export type ComputeTaxesInput = {
  lines: readonly TaxLineInput[];
  delivery: { amount: number };
  settings: TaxSettingsInput;
};

export type TaxLine = { name: string; rateBps: number; base: number; amount: number };

export type ComputeTaxesResult = {
  perLine: { taxAmount: number; taxRateBps: number | null }[];
  shippingTax: number;
  shippingTaxRateBps: number | null;
  taxTotal: number;
  taxLines: TaxLine[];
  /** Recopié des réglages : à stocker dans Order.taxesIncluded. */
  taxesIncluded: boolean;
  /** Montant à AJOUTER au total de la commande (taxTotal en HT, 0 en TTC). */
  addToTotal: number;
};

/** round(num / den) demi-unité vers le haut, en entiers (num ≥ 0, den > 0). */
function roundDiv(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

function assertAmount(n: number, label: string): number {
  if (!Number.isInteger(n)) throw new Error(`computeTaxes : ${label} doit être un entier`);
  return Math.max(0, n);
}

/** Taxe contenue dans (TTC) ou ajoutée à (HT) un montant net. */
export function taxForAmount(net: number, rateBps: number, pricesIncludeTax: boolean): number {
  const n = assertAmount(net, "montant");
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new Error("computeTaxes : taux invalide");
  if (n === 0 || rateBps === 0) return 0;
  return pricesIncludeTax ? roundDiv(n * rateBps, 10_000 + rateBps) : roundDiv(n * rateBps, 10_000);
}

/** Taux applicable à une catégorie (le premier trouvé ; l'unicité est garantie en base par pays/catégorie). */
export function findRate(rates: readonly TaxRateInput[], category: string): TaxRateInput | null {
  return rates.find((r) => r.taxCategory === category) ?? null;
}

export function computeTaxes(input: ComputeTaxesInput): ComputeTaxesResult {
  const { settings } = input;
  const included = settings.pricesIncludeTax;
  const zero = (): ComputeTaxesResult => ({
    perLine: input.lines.map(() => ({ taxAmount: 0, taxRateBps: null })),
    shippingTax: 0,
    shippingTaxRateBps: null,
    taxTotal: 0,
    taxLines: [],
    taxesIncluded: included,
    addToTotal: 0,
  });
  if (!settings.enabled || settings.rates.length === 0) return zero();

  const groups = new Map<string, TaxLine>();
  const add = (rate: TaxRateInput, net: number, tax: number) => {
    const key = `${rate.name}\u0000${rate.rateBps}`;
    const base = included ? net - tax : net;
    const g = groups.get(key);
    if (g) {
      g.base += base;
      g.amount += tax;
    } else groups.set(key, { name: rate.name, rateBps: rate.rateBps, base, amount: tax });
  };

  const perLine = input.lines.map((l) => {
    const net = assertAmount(l.net, "net de ligne");
    if (!l.taxable || l.taxCategory === "exempt") return { taxAmount: 0, taxRateBps: null };
    const rate = findRate(settings.rates, l.taxCategory);
    if (!rate || rate.rateBps <= 0) return { taxAmount: 0, taxRateBps: null };
    const tax = taxForAmount(net, rate.rateBps, included);
    if (net > 0) add(rate, net, tax);
    return { taxAmount: tax, taxRateBps: rate.rateBps };
  });

  let shippingTax = 0;
  let shippingTaxRateBps: number | null = null;
  const deliveryAmount = assertAmount(input.delivery.amount, "livraison");
  const shippingRate = findRate(settings.rates, "standard");
  if (deliveryAmount > 0 && shippingRate && shippingRate.appliesToShipping && shippingRate.rateBps > 0) {
    shippingTax = taxForAmount(deliveryAmount, shippingRate.rateBps, included);
    shippingTaxRateBps = shippingRate.rateBps;
    add(shippingRate, deliveryAmount, shippingTax);
  }

  const taxTotal = perLine.reduce((s, l) => s + l.taxAmount, 0) + shippingTax;
  const taxLines = [...groups.values()].sort((a, b) => b.rateBps - a.rateBps || a.name.localeCompare(b.name));
  return { perLine, shippingTax, shippingTaxRateBps, taxTotal, taxLines, taxesIncluded: included, addToTotal: included ? 0 : taxTotal };
}

/** Libellé d'un taux en points de base : 1800 → « 18 % », 1925 → « 19,25 % ». */
export function formatRateBps(bps: number): string {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  return `${s} %`;
}
