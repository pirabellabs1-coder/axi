import { describe, it, expect } from "vitest";
import { effectivePrice, computeTotals, checkQuantity, validateCoupon, computeDeliveryFee, type PricedLine, type CouponInput } from "@/lib/commerce/pricing";

const NOW = new Date("2026-10-10T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const lines: PricedLine[] = [
  { productId: "p1", name: "Robe", unitPrice: 18000, quantity: 1 },
  { productId: "p2", name: "Foulard", unitPrice: 4500, quantity: 2 },
]; // sous-total 27 000

const coupon = (over: Partial<CouponInput> = {}): CouponInput => ({ code: "TEST", type: "PERCENT", value: 10, minSubtotal: 0, active: true, usesCount: 0, ...over });

describe("effectivePrice", () => {
  it("retourne le prix normal sans promo", () => {
    expect(effectivePrice({ price: 1000 }, NOW)).toEqual({ price: 1000, isPromo: false });
  });
  it("applique la promo quand elle est en cours", () => {
    expect(effectivePrice({ price: 1000, promoPrice: 800, promoStart: day(-1), promoEnd: day(1) }, NOW)).toEqual({ price: 800, isPromo: true });
  });
  it("applique la promo sans bornes de dates", () => {
    expect(effectivePrice({ price: 1000, promoPrice: 800 }, NOW).isPromo).toBe(true);
  });
  it("ignore une promo pas encore commencée ou terminée", () => {
    expect(effectivePrice({ price: 1000, promoPrice: 800, promoStart: day(1) }, NOW).isPromo).toBe(false);
    expect(effectivePrice({ price: 1000, promoPrice: 800, promoEnd: day(-1) }, NOW).isPromo).toBe(false);
  });
  it("ignore un prix promo supérieur ou égal au prix", () => {
    expect(effectivePrice({ price: 1000, promoPrice: 1000 }, NOW).isPromo).toBe(false);
    expect(effectivePrice({ price: 1000, promoPrice: 1200 }, NOW).price).toBe(1000);
  });
});

describe("computeTotals", () => {
  it("calcule le sous-total sans coupon ni livraison", () => {
    const t = computeTotals(lines, { type: "PICKUP" }, null, NOW);
    expect(t).toMatchObject({ subtotal: 27000, discount: 0, deliveryFee: 0, total: 27000, couponApplied: false });
  });
  it("coupon en pourcentage", () => {
    const t = computeTotals(lines, { type: "PICKUP" }, coupon({ type: "PERCENT", value: 10 }), NOW);
    expect(t.discount).toBe(2700);
    expect(t.total).toBe(24300);
    expect(t.couponApplied).toBe(true);
  });
  it("coupon pourcentage borné à 100 %", () => {
    const t = computeTotals(lines, { type: "PICKUP" }, coupon({ type: "PERCENT", value: 250 }), NOW);
    expect(t.discount).toBe(27000);
    expect(t.total).toBe(0);
  });
  it("coupon fixe plafonné au sous-total", () => {
    const t = computeTotals(lines, { type: "PICKUP" }, coupon({ type: "FIXED", value: 50000 }), NOW);
    expect(t.discount).toBe(27000);
    expect(t.total).toBe(0);
    const t2 = computeTotals(lines, { type: "PICKUP" }, coupon({ type: "FIXED", value: 1500 }), NOW);
    expect(t2.discount).toBe(1500);
    expect(t2.total).toBe(25500);
  });
  it("frais de livraison ajoutés et gratuits dès le seuil", () => {
    expect(computeTotals(lines, { type: "DELIVERY", fee: 1500 }, null, NOW).total).toBe(28500);
    expect(computeTotals(lines, { type: "DELIVERY", fee: 1500, freeAbove: 25000 }, null, NOW).deliveryFee).toBe(0);
    expect(computeTotals(lines, { type: "DELIVERY", fee: 1500, freeAbove: 30000 }, null, NOW).deliveryFee).toBe(1500);
    expect(computeDeliveryFee({ type: "DELIVERY", fee: -5 }, 100)).toBe(0);
  });
  it("freeAbove est comparé au net APRÈS remise (décision du 11/10/2026)", () => {
    // 27 000 − 10 % = 24 300 < 25 000 : la livraison reste payante (avant le lot 1, elle était offerte).
    const t = computeTotals(lines, { type: "DELIVERY", fee: 1500, freeAbove: 25000 }, coupon({ type: "PERCENT", value: 10 }), NOW);
    expect(t).toMatchObject({ discount: 2700, deliveryFee: 1500, total: 25800 });
    const t2 = computeTotals(lines, { type: "DELIVERY", fee: 1500, freeAbove: 24000 }, coupon({ type: "PERCENT", value: 10 }), NOW);
    expect(t2.deliveryFee).toBe(0);
  });
  it("coupon FREE_DELIVERY annule les frais sans toucher au sous-total", () => {
    const t = computeTotals(lines, { type: "DELIVERY", fee: 2000 }, coupon({ type: "FREE_DELIVERY" }), NOW);
    expect(t).toMatchObject({ discount: 0, deliveryFee: 0, total: 27000, couponApplied: true });
  });
  it("coupon expiré, inactif, pas encore valable ou minimum non atteint → erreur, pas de remise", () => {
    const expired = computeTotals(lines, { type: "PICKUP" }, coupon({ endsAt: day(-1) }), NOW);
    expect(expired.couponApplied).toBe(false);
    expect(expired.couponError).toMatch(/expiré/);
    expect(expired.total).toBe(27000);

    const inactive = computeTotals(lines, { type: "PICKUP" }, coupon({ active: false }), NOW);
    expect(inactive.couponError).toMatch(/plus actif/);

    const future = computeTotals(lines, { type: "PICKUP" }, coupon({ startsAt: day(2) }), NOW);
    expect(future.couponError).toMatch(/pas encore/);

    const min = computeTotals(lines, { type: "PICKUP" }, coupon({ minSubtotal: 30000 }), NOW);
    expect(min.couponError).toMatch(/Minimum/);
    expect(min.discount).toBe(0);
  });
  it("coupon à quota d'utilisation atteint", () => {
    expect(validateCoupon(coupon({ maxUses: 3, usesCount: 3 }), 27000, NOW)).toMatchObject({ ok: false });
    expect(validateCoupon(coupon({ maxUses: 3, usesCount: 2 }), 27000, NOW)).toEqual({ ok: true });
    expect(validateCoupon(null, 27000, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/introuvable/) });
  });
  it("le total n'est jamais négatif", () => {
    const t = computeTotals([{ productId: "x", name: "x", unitPrice: 100, quantity: 1 }], { type: "PICKUP" }, coupon({ type: "FIXED", value: 1000 }), NOW);
    expect(t.total).toBe(0);
  });
});

describe("checkQuantity", () => {
  const item = { name: "Robe", minQty: 1, maxQty: 5, trackStock: true, stock: 3 };
  it("accepte une quantité valide", () => {
    expect(checkQuantity(item, 2)).toBeNull();
  });
  it("refuse 0, négatif ou non entier", () => {
    expect(checkQuantity(item, 0)).toMatch(/invalide/);
    expect(checkQuantity(item, -1)).toMatch(/invalide/);
    expect(checkQuantity(item, 1.5)).toMatch(/invalide/);
  });
  it("respecte le minimum et le maximum", () => {
    expect(checkQuantity({ ...item, minQty: 2 }, 1)).toMatch(/Minimum 2/);
    expect(checkQuantity(item, 6)).toMatch(/Maximum 5/);
    expect(checkQuantity({ ...item, maxQty: null, stock: 100 }, 50)).toBeNull();
  });
  it("respecte le stock suivi, ignore le stock non suivi", () => {
    expect(checkQuantity(item, 4)).toMatch(/ne reste que 3/);
    expect(checkQuantity({ ...item, stock: 0 }, 1)).toMatch(/épuisé/);
    expect(checkQuantity({ ...item, trackStock: false, stock: 0 }, 5)).toBeNull();
  });
});
