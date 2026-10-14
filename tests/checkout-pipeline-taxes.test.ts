import { describe, it, expect } from "vitest";
import { priceCart, type PipelineInput, type PipelineLine } from "@/lib/commerce/checkout-pipeline";
import type { TaxSettingsInput } from "@/lib/tax/compute";

const NOW = new Date("2026-10-11T12:00:00Z");
const L = (productId: string, unitPrice: number, quantity: number, over: Partial<PipelineLine> = {}): PipelineLine => ({ productId, name: productId, unitPrice, quantity, collectionIds: [], isGiftCard: false, onSale: false, ...over });
const run = (over: Partial<PipelineInput>) => priceCart({ lines: [], delivery: { type: "PICKUP" }, now: NOW, currency: "XOF", ...over });
const settings = (pricesIncludeTax: boolean, appliesToShipping = true): TaxSettingsInput => ({
  enabled: true,
  pricesIncludeTax,
  rates: [
    { name: "TVA", rateBps: 1800, taxCategory: "standard", appliesToShipping },
    { name: "TVA réduite", rateBps: 1000, taxCategory: "reduced", appliesToShipping: false },
  ],
});

function invariants(r: ReturnType<typeof priceCart>) {
  expect(r.lines.reduce((s, l) => s + l.taxAmount, 0) + r.shippingTax).toBe(r.taxTotal);
  expect(r.taxLines.reduce((s, t) => s + t.amount, 0)).toBe(r.taxTotal);
  expect(r.total).toBe(r.subtotal - r.discount + r.deliveryFee + (r.taxesIncluded ? 0 : r.taxTotal));
  expect(r.amountDue).toBe(r.total - r.giftCardAmount - r.storeCreditAmount);
}

describe("taxes dans le pipeline", () => {
  it("sans réglages : aucune taxe, prix réputés TTC, total inchangé (non-régression lot 1)", () => {
    const r = run({ lines: [L("a", 10000, 2)] });
    expect(r.taxTotal).toBe(0);
    expect(r.taxesIncluded).toBe(true);
    expect(r.total).toBe(20000);
    expect(r.lines[0].taxRateBps).toBeNull();
    invariants(r);
  });

  it("TTC 18 % : « dont TVA », total inchangé", () => {
    const r = run({ lines: [L("a", 11800, 1)], tax: settings(true) });
    expect(r.taxTotal).toBe(1800);
    expect(r.total).toBe(11800);
    expect(r.taxLines).toEqual([{ name: "TVA", rateBps: 1800, base: 10000, amount: 1800 }]);
    expect(r.lines[0]).toMatchObject({ taxAmount: 1800, taxRateBps: 1800 });
    invariants(r);
  });

  it("HT 18 % : taxes ajoutées au total", () => {
    const r = run({ lines: [L("a", 10000, 1)], tax: settings(false) });
    expect(r.taxTotal).toBe(1800);
    expect(r.taxesIncluded).toBe(false);
    expect(r.total).toBe(11800);
    expect(r.amountDue).toBe(11800);
    invariants(r);
  });

  it("taxes calculées sur les nets APRÈS remises allouées (coupon et fidélité), arrondi par ligne", () => {
    const r = run({
      lines: [L("a", 5000, 1), L("b", 3333, 3)],
      coupon: { id: "c", code: "DIX", type: "PERCENT", value: 10, minSubtotal: 0, active: true, usesCount: 0 },
      loyalty: { points: 100, balance: 100, rewardPoints: 100, rewardValue: 1000 },
      tax: settings(true),
    });
    for (const l of r.lines) expect(l.taxAmount).toBe(Math.floor((2 * l.netTotal * 1800 + 11800) / (2 * 11800)));
    expect(r.lines.reduce((s, l) => s + l.discountAllocated, 0)).toBe(r.discount);
    invariants(r);
  });

  it("livraison taxée si le taux standard s'y applique ; sinon non", () => {
    const withShip = run({ lines: [L("a", 11800, 1)], delivery: { type: "DELIVERY", fee: 1000 }, tax: settings(true, true) });
    expect(withShip.shippingTax).toBe(153); // round(1000 × 1800 / 11800) = round(152,54)
    expect(withShip.taxTotal).toBe(1800 + 153);
    expect(withShip.total).toBe(12800);
    invariants(withShip);
    const noShip = run({ lines: [L("a", 11800, 1)], delivery: { type: "DELIVERY", fee: 1000 }, tax: settings(true, false) });
    expect(noShip.shippingTax).toBe(0);
    expect(noShip.taxTotal).toBe(1800);
    invariants(noShip);
  });

  it("HT avec livraison : total = net + livraison + taxes", () => {
    const r = run({ lines: [L("a", 10000, 1)], delivery: { type: "DELIVERY", fee: 1000 }, tax: settings(false) });
    expect(r.taxTotal).toBe(1800 + 180);
    expect(r.total).toBe(10000 + 1000 + 1980);
    invariants(r);
  });

  it("exonérés : carte cadeau (imposé), produit non taxable, catégorie exempt ; taux réduit", () => {
    const r = run({
      lines: [L("gc", 10000, 1, { isGiftCard: true, taxCategory: "standard" }), L("n", 10000, 1, { taxable: false }), L("e", 10000, 1, { taxCategory: "exempt" }), L("r", 11000, 1, { taxCategory: "reduced" })],
      tax: settings(true),
    });
    expect(r.lines.map((l) => l.taxAmount)).toEqual([0, 0, 0, 1000]);
    expect(r.lines.map((l) => l.taxRateBps)).toEqual([null, null, null, 1000]);
    expect(r.taxLines).toEqual([{ name: "TVA réduite", rateBps: 1000, base: 10000, amount: 1000 }]);
    invariants(r);
  });

  it("HT : les tenders couvrent les taxes, jamais les lignes carte cadeau", () => {
    const r = run({ lines: [L("a", 10000, 1), L("gc", 5000, 1, { isGiftCard: true })], tax: settings(false), storeCredit: 100_000 });
    expect(r.total).toBe(10000 + 1800 + 5000);
    expect(r.storeCreditAmount).toBe(11800);
    expect(r.amountDue).toBe(5000);
    invariants(r);
  });

  it("taxes désactivées (enabled false) : aucune taxe même avec des taux", () => {
    const r = run({ lines: [L("a", 10000, 1)], tax: { ...settings(false), enabled: false } });
    expect(r.taxTotal).toBe(0);
    expect(r.total).toBe(10000);
  });
});
