/**
 * Présentation d'un panier calculé dans une devise d'affichage (spécification lot 2, §1.2, « Ordre »). Module PUR.
 *
 *  1. le pipeline (`priceCart`) a TOUT calculé dans la devise de la boutique (seuils, paliers, `minSubtotal`,
 *     `freeAbove` évalués en devise boutique) : on ne recalcule aucune règle commerciale ici ;
 *  2. prix unitaire converti et arrondi selon la règle (ou prix fixé `ProductPrice`), ligne = unitaire × quantité ;
 *  3. chaque remise convertie au plus proche (`Math.round`) puis répartie au prorata de ses allocations d'origine
 *     (plus fort reste), plafonnée par le reste de chaque ligne ;
 *  4. livraison convertie avec la règle ;
 *  5. taxes recalculées sur les montants convertis (même fonction que le pipeline) ;
 *  6. total = Σ nets + livraison (+ taxes si HT) : somme EXACTE des éléments affichés.
 * Les tenders (avoir) sont convertis au plus proche ; les cartes cadeaux sont refusées en devise étrangère par
 * l'appelant (§1.2, cas limites).
 */
import { allocateProRata } from "@/lib/commerce/allocation";
import { taxesFor, type PricedCart } from "@/lib/commerce/checkout-pipeline";
import type { TaxLine, TaxSettingsInput } from "@/lib/tax/compute";
import { convertPlain, convertPrice, formatRate, type FxContext } from "./convert";

export type PresentedLine = {
  unitPrice: number;
  lineTotal: number;
  discountAllocated: number;
  netTotal: number;
  taxAmount: number;
  taxRateBps: number | null;
  /** Prix fixé par devise (ProductPrice) utilisé pour cette ligne. */
  fixed?: boolean;
};

export type PresentedDiscount = { source: string; id: string | null; label: string; amount: number; freeDelivery?: boolean };

/** Instantané `Order.presentmentAmounts` et montants affichés au checkout. */
export type PresentedCart = {
  currency: string;
  /** Taux effectif (marge comprise) à 10 décimales : 1 unité de la devise boutique = rate unités affichées. */
  rate: string;
  markupBps: number;
  rounding: string;
  lines: PresentedLine[];
  discounts: PresentedDiscount[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  taxTotal: number;
  taxLines: TaxLine[];
  taxesIncluded: boolean;
  total: number;
  storeCreditAmount: number;
  giftCardAmount: number;
  amountDue: number;
};

export type PresentOptions = {
  /**
   * Prix fixés (ProductPrice.price) par index de ligne, en unités mineures de la devise d'affichage, HORS
   * suppléments d'options ; null = conversion. Ignoré pour une ligne en promo datée (la promo prime).
   */
  fixedUnitPrices?: readonly (number | null | undefined)[];
  /** Mêmes réglages de taxes que le pipeline. */
  tax?: TaxSettingsInput | null;
};

export function presentCart(priced: PricedCart, fx: FxContext, opts: PresentOptions = {}): PresentedCart {
  const n = priced.lines.length;

  // 2. Prix unitaires et lignes.
  const lines: PresentedLine[] = priced.lines.map((l, i) => {
    const fixed = opts.fixedUnitPrices?.[i];
    const deltas = (l.options ?? []).reduce((s, o) => s + o.priceDelta, 0);
    const useFixed = fixed != null && Number.isInteger(fixed) && fixed >= 0 && !l.onSale && !l.isGiftCard;
    // Prix fixé : le montant choisi par le commerçant est EXACT ; les suppléments d'options sont convertis au
    // plus proche (`convertPlain`) et non par la règle commerciale, sinon un supplément de 2 € deviendrait
    // 2,99 € (règle « terminaison ,99 ») et le prix fixé perdrait sa valeur ronde.
    const unitPrice = useFixed ? fixed + (deltas !== 0 ? convertPlain(deltas, fx) : 0) : convertPrice(Math.max(0, l.unitPrice), fx);
    const lineTotal = Math.max(0, unitPrice) * Math.max(0, l.quantity);
    return { unitPrice, lineTotal, discountAllocated: 0, netTotal: lineTotal, taxAmount: 0, taxRateBps: null, ...(useFixed ? { fixed: true } : {}) };
  });

  // 3. Remises : conversion au plus proche puis répartition selon les allocations d'origine.
  const discounts: PresentedDiscount[] = [];
  for (const d of priced.discounts) {
    const weights = new Array<number>(n).fill(0);
    for (const a of d.allocations) if (a.lineIndex >= 0 && a.lineIndex < n) weights[a.lineIndex] += Math.max(0, a.amount);
    const wanted = d.amount > 0 && weights.some((w) => w > 0) ? convertPlain(d.amount, fx) : 0;
    const per = wanted > 0 ? allocateProRata(wanted, weights) : weights.map(() => 0);
    let amount = 0;
    per.forEach((x, i) => {
      const room = lines[i].lineTotal - lines[i].discountAllocated;
      const take = Math.max(0, Math.min(x, room));
      lines[i].discountAllocated += take;
      amount += take;
    });
    discounts.push({ source: d.source, id: d.id, label: d.label, amount, ...(d.freeDelivery ? { freeDelivery: true } : {}) });
  }
  for (const l of lines) l.netTotal = l.lineTotal - l.discountAllocated;

  // 4. Livraison.
  const deliveryFee = priced.deliveryFee > 0 ? convertPrice(priced.deliveryFee, fx) : 0;

  // 5. Taxes sur les montants convertis.
  const taxes = taxesFor(priced.lines, lines.map((l) => l.netTotal), deliveryFee, opts.tax);
  lines.forEach((l, i) => {
    l.taxAmount = taxes.perLine[i].taxAmount;
    l.taxRateBps = taxes.perLine[i].taxRateBps;
  });

  // 6. Totaux exacts.
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const discount = lines.reduce((s, l) => s + l.discountAllocated, 0);
  const net = subtotal - discount;
  const total = Math.max(0, net + deliveryFee + taxes.addToTotal);

  // Tenders : avoir au plus proche ; cartes cadeaux (refusées par l'appelant) au plus proche par robustesse.
  const giftLines = lines.reduce((s, l, i) => s + (priced.lines[i].isGiftCard ? l.netTotal : 0), 0);
  let payable = Math.max(0, total - giftLines);
  const giftCardAmount = Math.min(payable, priced.giftCardAmount > 0 ? convertPlain(priced.giftCardAmount, fx) : 0);
  payable -= giftCardAmount;
  const storeCreditAmount = Math.min(payable, priced.storeCreditAmount > 0 ? convertPlain(priced.storeCreditAmount, fx) : 0);
  // Reste à payer nul en devise boutique ⇒ nul à l'affichage (pas de centime résiduel dû à l'arrondi).
  const amountDue = priced.amountDue === 0 ? 0 : Math.max(0, total - giftCardAmount - storeCreditAmount);

  return {
    currency: fx.quote,
    rate: formatRate(fx.rate),
    markupBps: fx.markupBps,
    rounding: fx.rounding,
    lines,
    discounts,
    subtotal,
    discount,
    deliveryFee,
    taxTotal: taxes.taxTotal,
    taxLines: taxes.taxLines,
    taxesIncluded: taxes.taxesIncluded,
    total,
    storeCreditAmount,
    giftCardAmount,
    amountDue,
  };
}

/** Prix catalogue affiché (fiche produit, carte produit) : prix fixé s'il existe, sinon conversion arrondie. */
export function presentPrice(amountMinor: number, fx: FxContext, fixed?: number | null): number {
  return fixed != null && Number.isInteger(fixed) && fixed >= 0 ? fixed : convertPrice(Math.max(0, amountMinor), fx);
}

/**
 * Prix barré converti avec la MÊME règle que le prix (§1.2, cas limites : un arrondi supérieur ne doit pas faire
 * dépasser le prix barré). Si l'arrondi rend le prix ≥ au prix barré converti, le prix barré n'est pas affiché (null).
 */
export function presentCompareAt(compareAtMinor: number | null | undefined, presentedPrice: number, fx: FxContext, fixedCompareAt?: number | null): number | null {
  if (compareAtMinor == null && fixedCompareAt == null) return null;
  const c = fixedCompareAt != null ? fixedCompareAt : convertPrice(Math.max(0, compareAtMinor ?? 0), fx);
  return c > presentedPrice ? c : null;
}
