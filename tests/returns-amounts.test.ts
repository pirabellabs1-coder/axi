import { describe, it, expect } from "vitest";
import { computeReturnAmounts, exchangeBalance, lineNet, loyaltyPointsToRevoke, returnLineValue, storeCreditWithBonus, unitValues } from "@/lib/returns/amounts";

const item = (id: string, quantity: number, lineTotal: number, discountAllocated = 0, isGiftCard = false) => ({ id, quantity, lineTotal, discountAllocated, isGiftCard });

describe("valeur des articles retournés", () => {
  it("prorata du net (lineTotal − discountAllocated)", () => {
    const it1 = item("a", 2, 10_000, 1_000);
    expect(lineNet(it1)).toBe(9_000);
    expect(returnLineValue(it1, 1)).toBe(4_500);
  });

  it("plus fort reste : les retours successifs d'une ligne somment exactement son net", () => {
    const it1 = item("a", 3, 10_000); // 3333,33…
    expect(unitValues(10_000, 3)).toEqual([3334, 3333, 3333]);
    const first = returnLineValue(it1, 1, 0);
    const second = returnLineValue(it1, 1, 1);
    const third = returnLineValue(it1, 1, 2);
    expect(first + second + third).toBe(10_000);
    expect(returnLineValue(it1, 3, 0)).toBe(10_000);
    // Jamais au-delà des unités commandées.
    expect(returnLineValue(it1, 5, 2)).toBe(third);
  });

  it("article d'un lot : la remise allouée est déduite, jamais de net négatif", () => {
    expect(lineNet(item("a", 1, 5_000, 7_000))).toBe(0);
    expect(returnLineValue(item("a", 1, 5_000, 1_250), 1)).toBe(3_750);
  });
});

describe("computeReturnAmounts", () => {
  const order = { total: 26_000, deliveryFee: 1_000, items: [item("a", 2, 10_000, 0), item("b", 1, 15_000, 0), item("gc", 1, 5_000, 0, true)] };

  it("frais de remise en stock arrondis (Math.round), annulables", () => {
    const r = computeReturnAmounts({ order, lines: [{ orderItemId: "b", quantity: 1 }], restockingFeePercent: 15, refundShipping: false, alreadyRefunded: 0 });
    expect(r.merchandise).toBe(15_000);
    expect(r.restockingFee).toBe(2_250);
    expect(r.amount).toBe(12_750);
    const odd = computeReturnAmounts({ order: { ...order, items: [item("x", 1, 1_001)] }, lines: [{ orderItemId: "x", quantity: 1 }], restockingFeePercent: 15, refundShipping: false, alreadyRefunded: 0 });
    expect(odd.restockingFee).toBe(150); // 150,15 → 150
    const waived = computeReturnAmounts({ order, lines: [{ orderItemId: "b", quantity: 1 }], restockingFeePercent: 15, waiveRestockingFee: true, refundShipping: false, alreadyRefunded: 0 });
    expect(waived.restockingFee).toBe(0);
  });

  it("livraison uniquement si retour total (cartes cadeaux ignorées) et une seule fois", () => {
    const partial = computeReturnAmounts({ order, lines: [{ orderItemId: "a", quantity: 2 }], restockingFeePercent: 0, refundShipping: true, alreadyRefunded: 0 });
    expect(partial.fullReturn).toBe(false);
    expect(partial.shipping).toBe(0);
    const total = computeReturnAmounts({ order, lines: [{ orderItemId: "a", quantity: 2 }, { orderItemId: "b", quantity: 1 }], restockingFeePercent: 0, refundShipping: true, alreadyRefunded: 0 });
    expect(total.fullReturn).toBe(true);
    expect(total.shipping).toBe(1_000);
    expect(total.amount).toBe(26_000);
    const again = computeReturnAmounts({ order, lines: [{ orderItemId: "b", quantity: 1 }], restockingFeePercent: 0, refundShipping: true, otherReturnedQty: { a: 2 }, shippingAlreadyRefunded: true, alreadyRefunded: 0 });
    expect(again.fullReturn).toBe(true);
    expect(again.shipping).toBe(0);
  });

  it("retours multiples : cumul détecté via les autres retours", () => {
    const second = computeReturnAmounts({
      order, lines: [{ orderItemId: "a", quantity: 1, priorQuantity: 1 }, { orderItemId: "b", quantity: 1 }],
      restockingFeePercent: 0, refundShipping: true, otherReturnedQty: { a: 1 }, alreadyRefunded: 5_000,
    });
    expect(second.fullReturn).toBe(true);
    expect(second.merchandise).toBe(20_000);
    expect(second.shipping).toBe(1_000);
    expect(second.amount).toBe(21_000);
  });

  it("plafond cumulé : total payé − déjà remboursé, jamais négatif", () => {
    const r = computeReturnAmounts({ order, lines: [{ orderItemId: "b", quantity: 1 }], restockingFeePercent: 0, refundShipping: false, alreadyRefunded: 20_000 });
    expect(r.cap).toBe(6_000);
    expect(r.amount).toBe(6_000);
    expect(r.capped).toBe(true);
    const over = computeReturnAmounts({ order, lines: [{ orderItemId: "b", quantity: 1 }], restockingFeePercent: 0, refundShipping: false, alreadyRefunded: 99_000 });
    expect(over.cap).toBe(0);
    expect(over.amount).toBe(0);
  });

  it("lignes inconnues ou quantités nulles ignorées", () => {
    const r = computeReturnAmounts({ order, lines: [{ orderItemId: "zz", quantity: 1 }, { orderItemId: "a", quantity: 0 }], restockingFeePercent: 0, refundShipping: false, alreadyRefunded: 0 });
    expect(r.lines).toEqual([]);
    expect(r.amount).toBe(0);
  });
});

describe("avoir, échange, fidélité", () => {
  it("avoir avec bonus arrondi", () => {
    expect(storeCreditWithBonus(10_000, 10)).toBe(11_000);
    expect(storeCreditWithBonus(1_005, 10)).toBe(1_106); // 100,5 → 101
    expect(storeCreditWithBonus(0, 10)).toBe(0);
  });

  it("échange : différence due ou excédent", () => {
    expect(exchangeBalance(10_000, 12_500)).toEqual({ applied: 10_000, due: 2_500, surplus: 0 });
    expect(exchangeBalance(10_000, 8_000)).toEqual({ applied: 8_000, due: 0, surplus: 2_000 });
  });

  it("points retirés : arrondi à l'inférieur, borné", () => {
    expect(loyaltyPointsToRevoke(25, 10_000, 30_000)).toBe(8); // 8,33
    expect(loyaltyPointsToRevoke(25, 30_000, 30_000)).toBe(25);
    expect(loyaltyPointsToRevoke(25, 99_000, 30_000)).toBe(25);
    expect(loyaltyPointsToRevoke(25, 30_000, 30_000, 4)).toBe(4);
    expect(loyaltyPointsToRevoke(0, 10_000, 30_000)).toBe(0);
    expect(loyaltyPointsToRevoke(25, 10_000, 0)).toBe(0);
  });
});
