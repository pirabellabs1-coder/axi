import { describe, it, expect } from "vitest";
import { computeTaxes, taxForAmount, formatRateBps, type TaxRateInput } from "@/lib/tax/compute";
import { allocateProRata } from "@/lib/commerce/allocation";
import { buildInvoiceSnapshot, creditNoteTaxes, formatInvoiceNumber, lineNets, yearInTimeZone, type SnapshotOrderInput } from "@/lib/tax/snapshot";
import { DEFAULT_TAX_REGISTRATION, parseTaxRegistration, exemptionMentionFor } from "@/lib/tax/registration";
import { TAX_PRESETS, taxPresetFor } from "@/config/taxes";

const TVA18: TaxRateInput = { name: "TVA", rateBps: 1800, taxCategory: "standard", appliesToShipping: true };
const REDUCED10: TaxRateInput = { name: "TVA réduite", rateBps: 1000, taxCategory: "reduced", appliesToShipping: false };
const ttc = (rates: TaxRateInput[] = [TVA18]) => ({ enabled: true, pricesIncludeTax: true, rates });
const ht = (rates: TaxRateInput[] = [TVA18]) => ({ enabled: true, pricesIncludeTax: false, rates });
const line = (net: number, taxCategory = "standard", taxable = true) => ({ net, taxable, taxCategory });

describe("computeTaxes : TTC", () => {
  it("extrait la TVA incluse : round(net × bps / (10 000 + bps))", () => {
    const r = computeTaxes({ lines: [line(10_000)], delivery: { amount: 0 }, settings: ttc() });
    expect(r.perLine).toEqual([{ taxAmount: 1525, taxRateBps: 1800 }]); // 1525,42
    expect(r.taxTotal).toBe(1525);
    expect(r.addToTotal).toBe(0);
    expect(r.taxesIncluded).toBe(true);
    expect(r.taxLines).toEqual([{ name: "TVA", rateBps: 1800, base: 8475, amount: 1525 }]);
  });

  it("11 800 TTC à 18 % = 10 000 HT + 1 800", () => {
    const r = computeTaxes({ lines: [line(11_800)], delivery: { amount: 0 }, settings: ttc() });
    expect(r.taxLines[0]).toEqual({ name: "TVA", rateBps: 1800, base: 10_000, amount: 1800 });
  });
});

describe("computeTaxes : HT", () => {
  it("ajoute la taxe : round(net × bps / 10 000), total = net + livraison + taxes", () => {
    const r = computeTaxes({ lines: [line(10_000), line(2_500)], delivery: { amount: 1_000 }, settings: ht() });
    expect(r.perLine.map((l) => l.taxAmount)).toEqual([1800, 450]);
    expect(r.shippingTax).toBe(180);
    expect(r.taxTotal).toBe(2430);
    expect(r.addToTotal).toBe(2430);
    expect(r.taxLines).toEqual([{ name: "TVA", rateBps: 1800, base: 13_500, amount: 2430 }]);
  });

  it("arrondit au plus proche, demi-unité vers le haut", () => {
    expect(taxForAmount(25, 1800, false)).toBe(5); // 4,5
    expect(taxForAmount(24, 1800, false)).toBe(4); // 4,32
    expect(taxForAmount(1, 1925, true)).toBe(0);
  });

  it("aucune dérive flottante sur de grands montants", () => {
    expect(taxForAmount(1_000_000_000_000, 1925, false)).toBe(192_500_000_000);
  });
});

describe("computeTaxes : livraison", () => {
  it("livraison taxée au taux normal si appliesToShipping", () => {
    const r = computeTaxes({ lines: [line(10_000)], delivery: { amount: 1_000 }, settings: ttc() });
    expect(r.shippingTax).toBe(153); // 152,54
    expect(r.shippingTaxRateBps).toBe(1800);
    expect(r.taxTotal).toBe(1525 + 153);
    expect(r.taxLines[0].base).toBe(10_000 + 1_000 - 1525 - 153);
  });

  it("livraison non taxée si appliesToShipping = false", () => {
    const r = computeTaxes({ lines: [line(10_000)], delivery: { amount: 1_000 }, settings: ttc([{ ...TVA18, appliesToShipping: false }]) });
    expect(r.shippingTax).toBe(0);
    expect(r.shippingTaxRateBps).toBeNull();
    expect(r.taxTotal).toBe(1525);
  });

  it("livraison gratuite : aucune taxe de livraison", () => {
    const r = computeTaxes({ lines: [line(10_000)], delivery: { amount: 0 }, settings: ht() });
    expect(r.shippingTax).toBe(0);
  });
});

describe("computeTaxes : exonérations", () => {
  it("produit non taxable, catégorie exempt, catégorie sans taux : taxe 0 et taux null", () => {
    const r = computeTaxes({ lines: [line(5_000, "standard", false), line(5_000, "exempt"), line(5_000, "reduced"), line(5_000)], delivery: { amount: 0 }, settings: ttc() });
    expect(r.perLine).toEqual([
      { taxAmount: 0, taxRateBps: null },
      { taxAmount: 0, taxRateBps: null },
      { taxAmount: 0, taxRateBps: null },
      { taxAmount: 763, taxRateBps: 1800 },
    ]);
    expect(r.taxLines).toEqual([{ name: "TVA", rateBps: 1800, base: 4237, amount: 763 }]);
  });

  it("taux réduit : regroupement par taux, Σ taxLines.amount = taxTotal", () => {
    const r = computeTaxes({ lines: [line(10_000), line(10_000, "reduced")], delivery: { amount: 2_000 }, settings: ht([TVA18, REDUCED10]) });
    expect(r.taxLines).toEqual([
      { name: "TVA", rateBps: 1800, base: 12_000, amount: 2160 },
      { name: "TVA réduite", rateBps: 1000, base: 10_000, amount: 1000 },
    ]);
    expect(r.taxLines.reduce((s, t) => s + t.amount, 0)).toBe(r.taxTotal);
  });

  it("taxes désactivées ou aucun taux : tout à zéro", () => {
    for (const settings of [{ enabled: false, pricesIncludeTax: true, rates: [TVA18] }, { enabled: true, pricesIncludeTax: false, rates: [] }]) {
      const r = computeTaxes({ lines: [line(10_000)], delivery: { amount: 500 }, settings });
      expect(r.taxTotal).toBe(0);
      expect(r.addToTotal).toBe(0);
      expect(r.taxLines).toEqual([]);
      expect(r.perLine).toEqual([{ taxAmount: 0, taxRateBps: null }]);
    }
  });

  it("refuse les montants non entiers", () => {
    expect(() => computeTaxes({ lines: [line(10.5)], delivery: { amount: 0 }, settings: ttc() })).toThrow();
  });
});

describe("computeTaxes : arrondi par ligne et remises allouées", () => {
  it("arrondi par ligne : écart ≤ 1 unité par ligne avec le calcul global", () => {
    const r = computeTaxes({ lines: [line(999), line(999), line(999)], delivery: { amount: 0 }, settings: ttc() });
    expect(r.perLine.map((l) => l.taxAmount)).toEqual([152, 152, 152]);
    const global = taxForAmount(2997, 1800, true); // 457
    expect(Math.abs(global - r.taxTotal)).toBeLessThanOrEqual(3);
    expect(r.taxTotal).toBe(456);
  });

  it("taxe calculée sur le net après remises allouées (plus fort reste)", () => {
    const gross = [10_000, 5_000];
    const alloc = allocateProRata(3_000, gross); // coupon de 3 000
    const nets = gross.map((g, i) => g - alloc[i]);
    expect(nets).toEqual([8_000, 4_000]);
    const r = computeTaxes({ lines: nets.map((n) => line(n)), delivery: { amount: 0 }, settings: ttc() });
    expect(r.perLine.map((l) => l.taxAmount)).toEqual([1220, 610]);
    expect(r.taxLines[0]).toEqual({ name: "TVA", rateBps: 1800, base: 12_000 - 1830, amount: 1830 });
  });

  it("ligne entièrement remisée : taxe 0", () => {
    const r = computeTaxes({ lines: [line(0), line(1_180)], delivery: { amount: 0 }, settings: ttc() });
    expect(r.perLine).toEqual([{ taxAmount: 0, taxRateBps: 1800 }, { taxAmount: 180, taxRateBps: 1800 }]);
  });
});

describe("libellés et préréglages", () => {
  it("formatRateBps", () => {
    expect(formatRateBps(1800)).toBe("18 %");
    expect(formatRateBps(1925)).toBe("19,25 %");
    expect(formatRateBps(1890)).toBe("18,9 %");
    expect(formatRateBps(2000)).toBe("20 %");
  });

  it("préréglages indicatifs du §2", () => {
    expect(taxPresetFor("bj")?.rateBps).toBe(1800);
    expect(taxPresetFor("CM")?.rateBps).toBe(1925);
    expect(taxPresetFor("CG")?.rateBps).toBe(1890);
    expect(taxPresetFor("NE")?.rateBps).toBe(1900);
    expect(taxPresetFor("FR")?.rateBps).toBe(2000);
    expect(TAX_PRESETS).toHaveLength(12);
    expect(taxPresetFor("US")).toBeNull();
  });

  it("identité fiscale : lecture tolérante et mention d'exonération", () => {
    expect(parseTaxRegistration(null)).toEqual(DEFAULT_TAX_REGISTRATION);
    expect(parseTaxRegistration({ regime: "XYZ", taxId: " 320 ", autoIssueInvoices: false })).toMatchObject({ regime: "TVA", taxId: "320", autoIssueInvoices: false });
    expect(exemptionMentionFor(true, { regime: "TPS", exemptionMention: "" })).toBe("TVA non applicable");
    expect(exemptionMentionFor(false, { regime: "TVA", exemptionMention: "Exonéré, art. 12" })).toBe("Exonéré, art. 12");
    expect(exemptionMentionFor(true, { regime: "TVA", exemptionMention: "" })).toBeNull();
  });
});

describe("numéro de facture", () => {
  it("F-AAAA-000001 / A-AAAA-000001", () => {
    expect(formatInvoiceNumber("INVOICE", 2026, 1)).toBe("F-2026-000001");
    expect(formatInvoiceNumber("CREDIT_NOTE", 2026, 42)).toBe("A-2026-000042");
    expect(formatInvoiceNumber("INVOICE", 2027, 1_234_567)).toBe("F-2027-1234567");
    expect(() => formatInvoiceNumber("INVOICE", 2026, 0)).toThrow();
  });

  it("année dans le fuseau de la boutique", () => {
    const d = new Date("2026-12-31T23:30:00Z");
    expect(yearInTimeZone(d, "Africa/Porto-Novo")).toBe(2027);
    expect(yearInTimeZone(d, "Africa/Dakar")).toBe(2026);
    expect(yearInTimeZone(d, "Pas/UnFuseau")).toBe(2026);
  });
});

function order(o: Partial<SnapshotOrderInput> = {}): SnapshotOrderInput {
  return {
    id: "order_1",
    reference: "AX-TEST01",
    createdAt: new Date("2026-10-11T10:00:00Z"),
    currency: "XOF",
    subtotal: 15_000,
    discount: 3_000,
    deliveryFee: 1_000,
    total: 13_000,
    fulfillmentType: "DELIVERY",
    deliveryZoneName: "Cotonou",
    deliveryAddress: "Akpakpa",
    customerName: "Awa",
    customerPhone: "22997000000",
    customerEmail: null,
    buyerCompany: "Awa SARL",
    buyerTaxId: "IFU-1",
    paymentStatus: "PAID",
    paymentMethodLabel: "MTN MoMo",
    paymentReference: null,
    giftCardAmount: 0,
    storeCreditAmount: 0,
    taxTotal: 0,
    taxesIncluded: true,
    taxLines: null,
    items: [
      { name: "Sac", variantName: null, quantity: 1, unitPrice: 10_000, lineTotal: 10_000, discountAllocated: 2_000, isGiftCard: false, taxAmount: 0, taxRateBps: null, product: { taxable: true, taxCategory: "standard" } },
      { name: "Carte cadeau", variantName: null, quantity: 1, unitPrice: 5_000, lineTotal: 5_000, discountAllocated: 1_000, isGiftCard: true, taxAmount: 0, taxRateBps: null, product: null },
    ],
    ...o,
  };
}
const store = { name: "Boutique", address: "Rue 1", city: "Cotonou", contactPhone: null, contactEmail: null, taxesEnabled: true };
const reg = { ...DEFAULT_TAX_REGISTRATION, legalName: "Boutique SARL", taxId: "IFU 3201", rccm: "RB/COT/1" };

describe("instantané de facture", () => {
  it("commande antérieure en TTC : ventilation calculée, carte cadeau exonérée, total inchangé", () => {
    const s = buildInvoiceSnapshot({ number: "F-2026-000001", issuedAt: new Date(), order: order(), store, registration: reg, settings: ttc() });
    expect(s.taxSource).toBe("computed");
    expect(s.lines.map((l) => [l.net, l.taxAmount, l.taxRateBps])).toEqual([
      [8_000, 1220, 1800],
      [4_000, 0, null],
    ]);
    expect(s.shipping?.taxAmount).toBe(153);
    expect(s.totals.tax).toBe(1220 + 153);
    expect(s.totals.inclTax).toBe(13_000);
    expect(s.totals.exclTax + s.totals.tax).toBe(13_000);
    expect(s.seller).toMatchObject({ legalName: "Boutique SARL", taxId: "IFU 3201", rccm: "RB/COT/1" });
    expect(s.buyer).toMatchObject({ company: "Awa SARL", taxId: "IFU-1" });
    expect(s.mentions.join(" ")).toContain("TVA 18 % incluse");
  });

  it("taxes figées par le pipeline (HT) : reprises telles quelles, total = net + livraison + taxes", () => {
    const o = order({
      total: 12_000 + 1_000 + 2_340,
      taxesIncluded: false,
      taxTotal: 2_340,
      taxLines: [{ name: "TVA", rateBps: 1800, base: 13_000, amount: 2_340 }],
      items: order().items.map((i, idx) => ({ ...i, isGiftCard: false, taxAmount: idx === 0 ? 1440 : 720, taxRateBps: 1800 })),
    });
    const s = buildInvoiceSnapshot({ number: "F-2026-000002", issuedAt: new Date(), order: o, store, registration: reg, settings: ttc() });
    expect(s.taxSource).toBe("order");
    expect(s.pricesIncludeTax).toBe(false);
    expect(s.shipping?.taxAmount).toBe(180);
    expect(s.totals.inclTax).toBe(o.total);
    expect(s.taxLines).toEqual(o.taxLines);
  });

  it("HT sans taxes figées : aucune taxe ajoutée après coup ; régime TPS : mention « TVA non applicable »", () => {
    const s1 = buildInvoiceSnapshot({ number: "F-2026-000003", issuedAt: new Date(), order: order(), store, registration: reg, settings: ht() });
    expect(s1.totals.tax).toBe(0);
    expect(s1.totals.inclTax).toBe(13_000);
    const s2 = buildInvoiceSnapshot({ number: "F-2026-000004", issuedAt: new Date(), order: order(), store, registration: { ...reg, regime: "TPS" }, settings: { enabled: false, pricesIncludeTax: true, rates: [] } });
    expect(s2.taxSource).toBe("none");
    expect(s2.mentions).toContain("TVA non applicable");
  });

  it("remise non allouée (commande ancienne) : répartie au prorata des lignes", () => {
    const o = order({ items: order().items.map((i) => ({ ...i, discountAllocated: 0 })) });
    expect(lineNets(o)).toEqual([8_000, 4_000]);
  });
});

describe("avoirs : TVA au prorata, solde exact", () => {
  const invoiceTaxLines = [{ name: "TVA", rateBps: 1800, base: 10_000, amount: 1_800 }];

  it("remboursement partiel puis solde : Σ TVA des avoirs = TVA de la facture", () => {
    const first = creditNoteTaxes({ invoiceTotal: 11_800, invoiceTaxLines, refundAmount: 5_000, previous: [] });
    expect(first.tax).toBe(763); // 1800 × 5000 / 11800 = 762,7
    const second = creditNoteTaxes({ invoiceTotal: 11_800, invoiceTaxLines, refundAmount: 6_800, previous: [{ amount: 5_000, taxLines: first.taxLines }] });
    expect(first.tax + second.tax).toBe(1_800);
  });

  it("facture sans TVA : avoir sans TVA", () => {
    expect(creditNoteTaxes({ invoiceTotal: 10_000, invoiceTaxLines: [], refundAmount: 10_000, previous: [] })).toEqual({ tax: 0, taxLines: [] });
  });

  // Arithmétique sûre : `invoiceTax × refundAmount` dépasse Number.MAX_SAFE_INTEGER dès quelques centaines de
  // millions de FCFA facturés (gros marchand, facture annuelle). Le prorata est calculé en BigInt.
  it("montants très élevés : prorata exact, jamais de dérive flottante", () => {
    const total = 1_180_000_000; // 1,18 milliard de FCFA TTC
    const lines = [{ name: "TVA", rateBps: 1800, base: 1_000_000_000, amount: 180_000_000 }];
    const half = creditNoteTaxes({ invoiceTotal: total, invoiceTaxLines: lines, refundAmount: 590_000_000, previous: [] });
    expect(half.tax).toBe(90_000_000);
    const rest = creditNoteTaxes({ invoiceTotal: total, invoiceTaxLines: lines, refundAmount: 590_000_000, previous: [{ amount: 590_000_000, taxLines: half.taxLines }] });
    expect(half.tax + rest.tax).toBe(180_000_000);
    // Remboursement d'un tiers : 180 000 000 × 393 333 333 / 1 180 000 000 = 60 000 000 (demi-unité vers le haut).
    const third = creditNoteTaxes({ invoiceTotal: total, invoiceTaxLines: lines, refundAmount: 393_333_333, previous: [] });
    expect(third.tax).toBe(Math.round((180_000_000 * 393_333_333) / total));
    expect(Number.isSafeInteger(third.tax)).toBe(true);
  });

  it("plusieurs taux : ventilation au prorata de la TVA restante par taux", () => {
    const lines = [
      { name: "TVA", rateBps: 1800, base: 10_000, amount: 1_800 },
      { name: "TVA réduite", rateBps: 1000, base: 10_000, amount: 1_000 },
    ];
    const r = creditNoteTaxes({ invoiceTotal: 22_800, invoiceTaxLines: lines, refundAmount: 22_800, previous: [] });
    expect(r.taxLines.map((t) => t.amount)).toEqual([1_800, 1_000]);
  });
});
