import { allocateProRata } from "@/lib/commerce/allocation";
import { roundHalfUp } from "@/lib/currency/rounding";
import { computeTaxes, formatRateBps, type TaxLine, type TaxSettingsInput } from "./compute";
import { exemptionMentionFor, type TaxRegistration } from "./registration";

/**
 * Instantané IMMUABLE d'une facture ou d'un avoir (OrderInvoice.snapshot). Fonctions PURES.
 * Les pages imprimables lisent exclusivement cet instantané : modifier la boutique, le produit ou la
 * commande après émission ne change jamais un document émis.
 */

export const INVOICE_SNAPSHOT_VERSION = 1;

export type InvoiceKindName = "INVOICE" | "CREDIT_NOTE";

export type InvoiceParty = {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  rccm?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type InvoiceLineSnapshot = {
  name: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  /** Montant brut de la ligne, tel qu'affiché à la vente (TTC ou HT selon `pricesIncludeTax`). */
  lineTotal: number;
  discount: number;
  /** Net après remises allouées (même base que le calcul de taxe). */
  net: number;
  taxRateBps: number | null;
  taxAmount: number;
  totalExclTax: number;
  totalInclTax: number;
};

export type InvoiceSnapshot = {
  version: number;
  kind: InvoiceKindName;
  number: string;
  issuedAt: string;
  currency: string;
  pricesIncludeTax: boolean;
  /** order = taxes figées par le pipeline ; computed = ventilation TTC calculée à l'émission (commande antérieure) ; none = pas de taxe. */
  taxSource: "order" | "computed" | "none";
  order: { id: string; reference: string; createdAt: string };
  seller: InvoiceParty & { regime: string };
  buyer: InvoiceParty & { company?: string | null };
  lines: InvoiceLineSnapshot[];
  shipping: { label: string; amount: number; taxRateBps: number | null; taxAmount: number; totalExclTax: number; totalInclTax: number } | null;
  totals: { discount: number; exclTax: number; tax: number; inclTax: number };
  taxLines: TaxLine[];
  payment: { status: string; methodLabel: string | null; reference: string | null; giftCardAmount: number; storeCreditAmount: number };
  mentions: string[];
  creditNote?: { invoiceNumber: string; invoiceId: string; refundId: string | null; reason: string | null };
};

export function invoiceNumberPrefix(kind: InvoiceKindName): "F" | "A" {
  return kind === "INVOICE" ? "F" : "A";
}

/** F-2026-000001 / A-2026-000001. Le compteur est continu par boutique et par type (jamais remis à zéro). */
export function formatInvoiceNumber(kind: InvoiceKindName, year: number, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error("Numéro de facture invalide");
  return `${invoiceNumberPrefix(kind)}-${year}-${String(n).padStart(6, "0")}`;
}

/** Année civile de la date dans le fuseau de la boutique (repli UTC si fuseau inconnu). */
export function yearInTimeZone(d: Date, timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(d));
  } catch {
    return d.getUTCFullYear();
  }
}

export type SnapshotOrderInput = {
  id: string;
  reference: string;
  createdAt: Date;
  currency: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  fulfillmentType: string;
  deliveryZoneName: string | null;
  deliveryAddress: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  buyerCompany: string | null;
  buyerTaxId: string | null;
  paymentStatus: string;
  paymentMethodLabel: string | null;
  paymentReference: string | null;
  giftCardAmount: number;
  storeCreditAmount: number;
  taxTotal: number;
  taxesIncluded: boolean;
  taxLines: unknown;
  items: {
    name: string;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    discountAllocated: number;
    isGiftCard: boolean;
    taxAmount: number;
    taxRateBps: number | null;
    product?: { taxable: boolean; taxCategory: string } | null;
  }[];
};

export type SnapshotStoreInput = { name: string; address: string | null; city: string | null; contactPhone: string | null; contactEmail: string | null; taxesEnabled: boolean };

function isTaxLineArray(v: unknown): v is TaxLine[] {
  return Array.isArray(v) && v.every((t) => t && typeof t === "object" && typeof (t as TaxLine).rateBps === "number" && typeof (t as TaxLine).amount === "number");
}

/** Nets par ligne ; les remises non allouées (commandes antérieures au lot 1) sont réparties au prorata. */
export function lineNets(order: Pick<SnapshotOrderInput, "discount" | "items">): number[] {
  const nets = order.items.map((i) => Math.max(0, i.lineTotal - i.discountAllocated));
  const allocated = order.items.reduce((s, i) => s + i.discountAllocated, 0);
  const rest = Math.min(order.discount - allocated, nets.reduce((s, n) => s + n, 0));
  if (rest > 0 && nets.length) {
    const extra = allocateProRata(rest, nets);
    return nets.map((n, i) => n - extra[i]);
  }
  return nets;
}

export function buildInvoiceSnapshot(p: {
  number: string;
  issuedAt: Date;
  order: SnapshotOrderInput;
  store: SnapshotStoreInput;
  registration: TaxRegistration;
  /** Réglages courants (utilisés seulement si la commande n'a pas de taxes figées). */
  settings: TaxSettingsInput;
}): InvoiceSnapshot {
  const { order, store, registration: reg } = p;
  const nets = lineNets(order);
  const fromOrder = isTaxLineArray(order.taxLines);

  let included: boolean;
  let perLine: { taxAmount: number; taxRateBps: number | null }[];
  let shippingTax: number;
  let shippingRate: number | null;
  let taxLines: TaxLine[];
  let taxSource: InvoiceSnapshot["taxSource"];

  if (fromOrder) {
    included = order.taxesIncluded;
    perLine = order.items.map((i) => ({ taxAmount: i.taxAmount, taxRateBps: i.taxRateBps }));
    shippingTax = Math.max(0, order.taxTotal - perLine.reduce((s, l) => s + l.taxAmount, 0));
    taxLines = (order.taxLines as TaxLine[]).map((t) => ({ name: String(t.name ?? "TVA"), rateBps: t.rateBps, base: Number(t.base) || 0, amount: t.amount }));
    shippingRate = shippingTax > 0 ? (taxLines.length === 1 ? taxLines[0].rateBps : null) : null;
    taxSource = order.taxTotal > 0 ? "order" : "none";
  } else if (p.settings.enabled && p.settings.pricesIncludeTax) {
    // Commande antérieure à l'intégration des taxes : en TTC, la ventilation « dont TVA » ne change pas le total.
    const r = computeTaxes({
      lines: order.items.map((i, idx) => ({
        net: nets[idx],
        taxable: i.isGiftCard ? false : (i.product?.taxable ?? true),
        taxCategory: i.isGiftCard ? "exempt" : (i.product?.taxCategory ?? "standard"),
      })),
      delivery: { amount: order.deliveryFee },
      settings: p.settings,
    });
    included = true;
    perLine = r.perLine;
    shippingTax = r.shippingTax;
    shippingRate = r.shippingTaxRateBps;
    taxLines = r.taxLines;
    taxSource = r.taxTotal > 0 ? "computed" : "none";
  } else {
    // HT sans taxes figées : impossible d'ajouter une taxe après coup (le total payé est fixé).
    included = true;
    perLine = order.items.map(() => ({ taxAmount: 0, taxRateBps: null }));
    shippingTax = 0;
    shippingRate = null;
    taxLines = [];
    taxSource = "none";
  }

  const lines: InvoiceLineSnapshot[] = order.items.map((i, idx) => {
    const net = nets[idx];
    const tax = perLine[idx].taxAmount;
    return {
      name: i.name,
      variantName: i.variantName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      discount: i.lineTotal - net,
      net,
      taxRateBps: perLine[idx].taxRateBps,
      taxAmount: tax,
      totalExclTax: included ? net - tax : net,
      totalInclTax: included ? net : net + tax,
    };
  });

  const shipping =
    order.deliveryFee > 0 || order.fulfillmentType === "DELIVERY"
      ? {
          label: order.deliveryZoneName ? `Livraison (${order.deliveryZoneName})` : "Livraison",
          amount: order.deliveryFee,
          taxRateBps: shippingTax > 0 ? shippingRate : null,
          taxAmount: shippingTax,
          totalExclTax: included ? order.deliveryFee - shippingTax : order.deliveryFee,
          totalInclTax: included ? order.deliveryFee : order.deliveryFee + shippingTax,
        }
      : null;

  const tax = lines.reduce((s, l) => s + l.taxAmount, 0) + (shipping?.taxAmount ?? 0);
  const exclTax = lines.reduce((s, l) => s + l.totalExclTax, 0) + (shipping?.totalExclTax ?? 0);

  const mentions: string[] = [];
  if (tax > 0 && included) mentions.push(`Prix TTC : ${taxLines.map((t) => `${t.name} ${formatRateBps(t.rateBps)}`).join(", ")} incluse.`);
  if (tax > 0 && !included) mentions.push("Prix indiqués hors taxes, taxes ajoutées au total.");
  const exemption = exemptionMentionFor(store.taxesEnabled, reg);
  if (tax === 0 && exemption) mentions.push(exemption);
  else if (tax > 0 && reg.exemptionMention && lines.some((l) => l.taxAmount === 0)) mentions.push(`Articles sans taxe : ${reg.exemptionMention}`);
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED" || order.paymentStatus === "REFUNDED") mentions.push("Facture acquittée.");

  return {
    version: INVOICE_SNAPSHOT_VERSION,
    kind: "INVOICE",
    number: p.number,
    issuedAt: p.issuedAt.toISOString(),
    currency: order.currency,
    pricesIncludeTax: included,
    taxSource,
    order: { id: order.id, reference: order.reference, createdAt: order.createdAt.toISOString() },
    seller: {
      name: store.name,
      legalName: reg.legalName || null,
      taxId: reg.taxId || null,
      rccm: reg.rccm || null,
      address: reg.address || [store.address, store.city].filter(Boolean).join(", ") || null,
      phone: store.contactPhone,
      email: store.contactEmail,
      regime: reg.regime,
    },
    buyer: {
      name: order.customerName,
      company: order.buyerCompany,
      taxId: order.buyerTaxId,
      address: order.fulfillmentType === "DELIVERY" ? order.deliveryAddress : null,
      phone: order.customerPhone,
      email: order.customerEmail,
    },
    lines,
    shipping,
    totals: { discount: order.discount, exclTax, tax, inclTax: exclTax + tax },
    taxLines,
    payment: {
      status: order.paymentStatus,
      methodLabel: order.paymentMethodLabel,
      reference: order.paymentReference,
      giftCardAmount: order.giftCardAmount,
      storeCreditAmount: order.storeCreditAmount,
    },
    mentions,
  };
}

/**
 * Taxe contenue dans un remboursement (TTC), au prorata de la facture, ventilée par taux.
 * Le cumul des avoirs ne dépasse jamais la taxe de la facture ; le dernier avoir (remboursement intégral) solde exactement.
 */
export function creditNoteTaxes(p: {
  invoiceTotal: number;
  invoiceTaxLines: readonly TaxLine[];
  refundAmount: number;
  previous: readonly { amount: number; taxLines: readonly TaxLine[] }[];
}): { tax: number; taxLines: TaxLine[] } {
  const key = (t: { name: string; rateBps: number }) => `${t.name}\u0000${t.rateBps}`;
  const credited = new Map<string, number>();
  for (const prev of p.previous) for (const t of prev.taxLines) credited.set(key(t), (credited.get(key(t)) ?? 0) + t.amount);
  const remaining = p.invoiceTaxLines.map((t) => Math.max(0, t.amount - (credited.get(key(t)) ?? 0)));
  const remainingTax = remaining.reduce((s, x) => s + x, 0);
  const invoiceTax = p.invoiceTaxLines.reduce((s, t) => s + t.amount, 0);
  if (remainingTax === 0 || p.invoiceTotal <= 0 || p.refundAmount <= 0) return { tax: 0, taxLines: [] };

  const alreadyRefunded = p.previous.reduce((s, x) => s + x.amount, 0);
  // Prorata en BigInt : `invoiceTax × refundAmount` dépasse Number.MAX_SAFE_INTEGER dès quelques centaines de
  // millions de FCFA facturés. Même arrondi (demi-unité vers le haut) que le reste du calcul de taxes.
  const prorata = Number(roundHalfUp(BigInt(invoiceTax) * BigInt(p.refundAmount), BigInt(p.invoiceTotal)));
  const tax = alreadyRefunded + p.refundAmount >= p.invoiceTotal ? remainingTax : Math.min(remainingTax, prorata);
  const split = allocateProRata(tax, remaining);
  const taxLines = p.invoiceTaxLines
    .map((t, i) => ({ name: t.name, rateBps: t.rateBps, base: t.rateBps > 0 ? Math.round((split[i] * 10_000) / t.rateBps) : 0, amount: split[i] }))
    .filter((t) => t.amount > 0);
  return { tax, taxLines };
}

export function buildCreditNoteSnapshot(p: {
  number: string;
  issuedAt: Date;
  invoice: { id: string; number: string; snapshot: InvoiceSnapshot };
  refund: { id: string | null; amount: number; reason: string | null };
  taxes: { tax: number; taxLines: TaxLine[] };
}): InvoiceSnapshot {
  const inv = p.invoice.snapshot;
  const amount = p.refund.amount;
  const exclTax = amount - p.taxes.tax;
  return {
    ...inv,
    version: INVOICE_SNAPSHOT_VERSION,
    kind: "CREDIT_NOTE",
    number: p.number,
    issuedAt: p.issuedAt.toISOString(),
    pricesIncludeTax: true,
    lines: [
      {
        name: `Remboursement sur facture ${p.invoice.number}`,
        variantName: p.refund.reason,
        quantity: 1,
        unitPrice: amount,
        lineTotal: amount,
        discount: 0,
        net: amount,
        taxRateBps: p.taxes.taxLines.length === 1 ? p.taxes.taxLines[0].rateBps : null,
        taxAmount: p.taxes.tax,
        totalExclTax: exclTax,
        totalInclTax: amount,
      },
    ],
    shipping: null,
    totals: { discount: 0, exclTax, tax: p.taxes.tax, inclTax: amount },
    taxLines: p.taxes.taxLines,
    mentions: [`Avoir fiscal annulant partiellement ou totalement la facture ${p.invoice.number}.`, ...inv.mentions.filter((m) => m !== "Facture acquittée.")],
    creditNote: { invoiceNumber: p.invoice.number, invoiceId: p.invoice.id, refundId: p.refund.id, reason: p.refund.reason },
  };
}

export function parseInvoiceSnapshot(raw: unknown): InvoiceSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as InvoiceSnapshot;
  return typeof s.number === "string" && Array.isArray(s.lines) && s.totals ? s : null;
}
