import { describe, it, expect } from "vitest";
import { priceCart, NOT_COMBINABLE_MESSAGE, type PipelineAutomaticDiscount, type PipelineCoupon, type PipelineInput, type PipelineLine } from "@/lib/commerce/checkout-pipeline";

const NOW = new Date("2026-10-10T12:00:00Z");
const L = (productId: string, unitPrice: number, quantity: number, over: Partial<PipelineLine> = {}): PipelineLine => ({ productId, name: productId, unitPrice, quantity, collectionIds: [], isGiftCard: false, onSale: false, ...over });
const coupon = (over: Partial<PipelineCoupon> = {}): PipelineCoupon => ({ id: "cp1", code: "TEST", type: "PERCENT", value: 10, minSubtotal: 0, active: true, usesCount: 0, ...over });
const auto = (id: string, kind: PipelineAutomaticDiscount["kind"], config: unknown, over: Partial<PipelineAutomaticDiscount> = {}): PipelineAutomaticDiscount => ({ id, title: id, kind, config, ...over });
const run = (over: Partial<PipelineInput>) => priceCart({ lines: [], delivery: { type: "PICKUP" }, now: NOW, currency: "XOF", ...over });

const pct = (id: string, amount: number, over: Partial<PipelineAutomaticDiscount> = {}) => auto(id, "PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount } }, over);
const tier = auto("tier", "CART_TIER", { tiers: [{ minSubtotal: 20000, value: { type: "PERCENT", amount: 10 } }] });

/** Invariants communs à tout panier calculé. */
function invariants(r: ReturnType<typeof priceCart>) {
  const lineSum = r.lines.reduce((s, l) => s + l.discountAllocated, 0);
  expect(lineSum).toBe(r.discount);
  for (const d of r.discounts) expect(d.allocations.reduce((s, a) => s + a.amount, 0)).toBe(d.amount);
  for (const l of r.lines) {
    expect(l.discountAllocated).toBeGreaterThanOrEqual(0);
    expect(l.discountAllocated).toBeLessThanOrEqual(l.lineTotal);
  }
  expect(r.discount).toBeLessThanOrEqual(r.subtotal);
  expect(r.total).toBeGreaterThanOrEqual(0);
  expect(r.total).toBe(r.subtotal - r.discount + r.deliveryFee + r.taxTotal);
  expect(r.amountDue).toBe(r.total - r.giftCardAmount - r.storeCreditAmount);
  expect(r.amountDue).toBeGreaterThanOrEqual(0);
}

describe("ordre d'application", () => {
  it("ligne, puis panier (sur le net), puis coupon (sur le net), puis fidélité, puis livraison", () => {
    const r = run({
      lines: [L("a", 10000, 3)],
      automaticDiscounts: [pct("p10", 10), tier],
      coupon: coupon({ value: 10 }),
      loyalty: { points: 100, balance: 100, rewardPoints: 100, rewardValue: 1000 },
      delivery: { type: "DELIVERY", fee: 1500 },
    });
    // 30 000 → −3 000 (ligne) = 27 000 → −2 700 (palier) = 24 300 → −2 430 (coupon) = 21 870 → −1 000 (points) = 20 870
    expect(r.discounts.map((d) => [d.source, d.amount])).toEqual([
      ["automatic", 3000],
      ["automatic", 2700],
      ["coupon", 2430],
      ["loyalty", 1000],
    ]);
    expect(r.automaticDiscount).toBe(5700);
    expect(r.couponDiscount).toBe(2430);
    expect(r.loyaltyDiscount).toBe(1000);
    expect(r.loyaltyPointsRedeemed).toBe(100);
    expect(r.total).toBe(20870 + 1500);
    invariants(r);
  });

  it("minSubtotal du coupon comparé au net après remises automatiques", () => {
    const r = run({ lines: [L("a", 10000, 2)], automaticDiscounts: [pct("p20", 20)], coupon: coupon({ minSubtotal: 18000 }) });
    expect(r.couponApplied).toBe(false);
    expect(r.couponError).toMatch(/Minimum/);
    expect(r.discount).toBe(4000);
  });

  it("appliesTo restreint l'assiette du coupon", () => {
    const r = run({ lines: [L("a", 10000, 1, { collectionIds: ["wax"] }), L("b", 10000, 1)], coupon: coupon({ value: 50, appliesTo: { collectionIds: ["wax"] } }) });
    expect(r.couponDiscount).toBe(5000);
    expect(r.lines.map((l) => l.discountAllocated)).toEqual([5000, 0]);
    const none = run({ lines: [L("b", 10000, 1)], coupon: coupon({ appliesTo: { productIds: ["a"] } }) });
    expect(none.couponApplied).toBe(false);
    expect(none.couponError).toMatch(/aucun article/);
  });
});

describe("cumul et non-cumul", () => {
  it("coupon non cumulable : le scénario le plus favorable est retenu, avec message", () => {
    const lines = [L("a", 10000, 2)];
    // Auto −30 % (6 000) vs coupon −10 % (2 000) : les remises automatiques gagnent.
    const autoWins = run({ lines, automaticDiscounts: [pct("p30", 30)], coupon: coupon({ value: 10, combinesWithAutomatic: false }) });
    expect(autoWins.couponApplied).toBe(false);
    expect(autoWins.couponSuperseded).toBe(true);
    expect(autoWins.couponError).toBeUndefined();
    expect(autoWins.discount).toBe(6000);
    expect(autoWins.messages.map((m) => m.text)).toContain(NOT_COMBINABLE_MESSAGE);
    // Coupon −50 % (10 000) : le coupon seul gagne, sans les remises automatiques.
    const couponWins = run({ lines, automaticDiscounts: [pct("p30", 30)], coupon: coupon({ value: 50, combinesWithAutomatic: false }) });
    expect(couponWins.couponApplied).toBe(true);
    expect(couponWins.automaticDiscount).toBe(0);
    expect(couponWins.discount).toBe(10000);
    expect(couponWins.messages.map((m) => m.text)).toContain(NOT_COMBINABLE_MESSAGE);
    invariants(couponWins);
  });

  it("remise automatique non cumulable avec les coupons : même arbitrage ; les autres restent", () => {
    const r = run({ lines: [L("a", 10000, 2)], automaticDiscounts: [pct("solo", 10, { combinesWithCoupons: false }), tier], coupon: coupon({ value: 30 }) });
    // Scénario coupon : palier (cumulable) 2 000 puis coupon 30 % de 18 000 = 5 400 → 7 400 ; scénario auto : 2 000 (le palier n'est plus atteint sur 18 000).
    expect(r.couponApplied).toBe(true);
    expect(r.appliedAutomaticIds).toEqual(["tier"]);
    expect(r.discount).toBe(7400);
  });

  it("tout cumulable : pas de message, le coupon s'ajoute", () => {
    const r = run({ lines: [L("a", 10000, 2)], automaticDiscounts: [pct("p10", 10)], coupon: coupon({ value: 10 }) });
    expect(r.couponApplied).toBe(true);
    expect(r.messages).toEqual([]);
    expect(r.discount).toBe(2000 + 1800);
  });

  it("combinesWithOtherAutomatic = false : la remise seule ou les autres, la meilleure", () => {
    const exclusive = pct("excl", 25, { combinesWithOtherAutomatic: false });
    const r = run({ lines: [L("a", 10000, 2)], automaticDiscounts: [exclusive, tier] });
    // excl seule : 5 000 ; palier seul : 2 000 → exclusive
    expect(r.appliedAutomaticIds).toEqual(["excl"]);
    expect(r.discount).toBe(5000);
  });

  it("remise épuisée (maxUses) ou configuration invalide : ignorée", () => {
    const r = run({ lines: [L("a", 10000, 1)], automaticDiscounts: [pct("used", 50, { maxUses: 2, usesCount: 2 }), auto("bad", "PRODUCT_AMOUNT", { nope: 1 })] });
    expect(r.discount).toBe(0);
  });
});

describe("excludeOnSale", () => {
  it("défaut vrai : une unité en promo datée n'est pas remisée automatiquement ; le coupon s'applique", () => {
    const r = run({ lines: [L("promo", 8000, 1, { onSale: true }), L("plein", 10000, 1)], automaticDiscounts: [pct("p10", 10)] });
    expect(r.lines.map((l) => l.discountAllocated)).toEqual([0, 1000]);
    const r2 = run({ lines: [L("promo", 8000, 1, { onSale: true })], coupon: coupon({ value: 10 }) });
    expect(r2.couponDiscount).toBe(800);
  });
  it("faux : la promo datée est cumulée", () => {
    const r = run({ lines: [L("promo", 8000, 1, { onSale: true })], automaticDiscounts: [auto("x", "PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount: 10 }, excludeOnSale: false })] });
    expect(r.discount).toBe(800);
  });
});

describe("livraison sur le net", () => {
  it("freeAbove comparé au net après remises", () => {
    const lines = [L("a", 13000, 2)]; // 26 000
    expect(run({ lines, delivery: { type: "DELIVERY", fee: 1500, freeAbove: 25000 } }).deliveryFee).toBe(0);
    const r = run({ lines, coupon: coupon({ value: 10 }), delivery: { type: "DELIVERY", fee: 1500, freeAbove: 25000 } });
    expect(r.deliveryFee).toBe(1500); // net 23 400 < 25 000
    invariants(r);
  });
  it("freeAbove évalué AVANT la fidélité : utiliser ses points ne fait pas perdre la livraison offerte", () => {
    const lines = [L("a", 26000, 1)];
    const delivery = { type: "DELIVERY" as const, fee: 1500, freeAbove: 25000 };
    const r = run({ lines, delivery, loyalty: { points: 100, balance: 100, rewardPoints: 100, rewardValue: 5000 } });
    expect(r.loyaltyDiscount).toBe(5000); // net après points : 21 000 < 25 000
    expect(r.deliveryFee).toBe(0); // mais la livraison reste offerte (net avant points : 26 000)
    expect(r.total).toBe(21000);
    invariants(r);
  });
  it("palier « livraison offerte » et coupon FREE_DELIVERY", () => {
    const free = auto("free", "CART_TIER", { tiers: [{ minSubtotal: 10000, value: { type: "FREE_DELIVERY" } }] });
    const r = run({ lines: [L("a", 12000, 1)], automaticDiscounts: [free], delivery: { type: "DELIVERY", fee: 2000 } });
    expect(r.deliveryFee).toBe(0);
    expect(r.freeDelivery).toBe(true);
    expect(r.discount).toBe(0);
    expect(run({ lines: [L("a", 12000, 1)], automaticDiscounts: [free] }).discounts).toEqual([]); // retrait : sans objet
    expect(run({ lines: [L("a", 12000, 1)], coupon: coupon({ type: "FREE_DELIVERY" }), delivery: { type: "DELIVERY", fee: 2000 } }).total).toBe(12000);
  });
});

describe("fidélité plafonnée", () => {
  const cfg = { rewardPoints: 100, rewardValue: 5000 };
  it("paliers entiers, dans la limite du solde", () => {
    const r = run({ lines: [L("a", 50000, 1)], loyalty: { points: 250, balance: 250, ...cfg } });
    expect(r.loyaltyDiscount).toBe(10000);
    expect(r.loyaltyPointsRedeemed).toBe(200);
  });
  it("plafond maxRedeemPercent (défaut 50 %) du net marchandise, message", () => {
    const r = run({ lines: [L("a", 12000, 1)], loyalty: { points: 1000, balance: 1000, ...cfg } });
    expect(r.loyaltyDiscount).toBe(5000); // plafond 6 000 → 1 palier
    expect(r.messages.some((m) => m.code === "loyalty_capped")).toBe(true);
    const r2 = run({ lines: [L("a", 12000, 1)], loyalty: { points: 1000, balance: 1000, maxRedeemPercent: 100, ...cfg } });
    expect(r2.loyaltyDiscount).toBe(10000);
  });
  it("solde insuffisant ou points non demandés : rien", () => {
    expect(run({ lines: [L("a", 50000, 1)], loyalty: { points: 300, balance: 50, ...cfg } }).loyaltyDiscount).toBe(0);
    expect(run({ lines: [L("a", 50000, 1)], loyalty: { points: 0, balance: 500, ...cfg } }).loyaltyDiscount).toBe(0);
  });
  it("hors cartes cadeaux", () => {
    const r = run({ lines: [L("gc", 50000, 1, { isGiftCard: true })], loyalty: { points: 500, balance: 500, ...cfg } });
    expect(r.loyaltyDiscount).toBe(0);
  });
});

describe("tenders et amountDue", () => {
  it("cartes cadeaux : expiration la plus proche, puis plus petit solde, 3 maximum, puis avoir", () => {
    const r = run({
      lines: [L("a", 20000, 1)],
      giftCards: [
        { id: "late", balance: 5000, expiresAt: new Date("2027-12-01") },
        { id: "never", balance: 1000, expiresAt: null },
        { id: "soonBig", balance: 9000, expiresAt: new Date("2026-12-01") },
        { id: "soonSmall", balance: 3000, expiresAt: new Date("2026-12-01") },
      ],
      storeCredit: 50000,
    });
    expect(r.tenders.map((t) => [t.kind, t.id, t.amount])).toEqual([
      ["gift_card", "soonSmall", 3000],
      ["gift_card", "soonBig", 9000],
      ["gift_card", "late", 5000],
      ["store_credit", "store_credit", 3000],
    ]);
    expect(r.amountDue).toBe(0);
    expect(r.total).toBe(20000); // les tenders ne modifient pas le total
    invariants(r);
  });
  it("une carte ou un avoir ne paie jamais une ligne carte cadeau", () => {
    const r = run({ lines: [L("gc", 10000, 1, { isGiftCard: true }), L("a", 4000, 1)], giftCards: [{ id: "c", balance: 50000 }], storeCredit: 50000 });
    expect(r.giftCardAmount).toBe(4000);
    expect(r.storeCreditAmount).toBe(0);
    expect(r.amountDue).toBe(10000);
  });
  it("reste à payer partiel", () => {
    const r = run({ lines: [L("a", 10000, 1)], delivery: { type: "DELIVERY", fee: 1000 }, giftCards: [{ id: "c", balance: 2500, last4: "H3VW" }] });
    expect(r.amountDue).toBe(8500);
    expect(r.tenders[0]).toMatchObject({ last4: "H3VW", remainingAfter: 0 });
  });
});

describe("lignes carte cadeau et bornes", () => {
  it("jamais remisées (automatique, coupon, palier)", () => {
    const r = run({ lines: [L("gc", 30000, 1, { isGiftCard: true }), L("a", 10000, 1)], automaticDiscounts: [pct("p50", 50), tier], coupon: coupon({ value: 50 }) });
    expect(r.lines[0].discountAllocated).toBe(0);
    invariants(r);
  });
  it("total jamais négatif ; Σ remises ≤ sous-total", () => {
    const r = run({ lines: [L("a", 100, 1)], automaticDiscounts: [auto("f", "PRODUCT_AMOUNT", { target: { all: true }, value: { type: "FIXED_AMOUNT", amount: 5000 } })], coupon: coupon({ type: "FIXED", value: 5000 }) });
    expect(r.total).toBe(0);
    expect(r.discount).toBe(100);
    invariants(r);
  });
  it("panier vide", () => {
    const r = run({ lines: [] });
    expect(r).toMatchObject({ subtotal: 0, total: 0, amountDue: 0, discounts: [] });
  });
});

describe("propriété : invariants sur paniers aléatoires", () => {
  it("Σ lignes = remise, tenders cohérents, jamais négatif", () => {
    let s = 7;
    const r = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32);
    const discounts = [pct("p", 15), tier, auto("b", "BUY_X_GET_Y", { buy: { target: { all: true }, quantity: 2 }, get: { target: { all: true }, quantity: 1, value: { type: "PERCENT", amount: 100 } }, maxApplicationsPerOrder: 3 }, { priority: 1 })];
    for (let k = 0; k < 200; k++) {
      const n = 1 + Math.floor(r() * 5);
      const lines = Array.from({ length: n }, (_, i) => L(`p${i}`, 100 + Math.floor(r() * 30000), 1 + Math.floor(r() * 4), { onSale: r() < 0.2, isGiftCard: r() < 0.1 }));
      const out = run({
        lines,
        automaticDiscounts: discounts.filter(() => r() < 0.7),
        coupon: r() < 0.5 ? coupon({ type: r() < 0.5 ? "PERCENT" : "FIXED", value: 1 + Math.floor(r() * 5000), combinesWithAutomatic: r() < 0.5 }) : null,
        loyalty: r() < 0.3 ? { points: 500, balance: 500, rewardPoints: 100, rewardValue: 1000 } : null,
        giftCards: r() < 0.3 ? [{ id: "g", balance: Math.floor(r() * 20000) }] : [],
        storeCredit: r() < 0.3 ? Math.floor(r() * 20000) : 0,
        delivery: r() < 0.5 ? { type: "DELIVERY", fee: 1500, freeAbove: 30000 } : { type: "PICKUP" },
      });
      invariants(out);
    }
  });
});

describe("revue « argent » du lot 1 : correctifs du pipeline", () => {
  it("freeAbove hors lignes carte cadeau : une carte n'ouvre pas la livraison offerte", () => {
    const delivery = { type: "DELIVERY" as const, fee: 1500, freeAbove: 25000 };
    const r = run({ lines: [L("gc", 25000, 1, { isGiftCard: true }), L("a", 5000, 1)], delivery });
    expect(r.deliveryFee).toBe(1500);
    expect(run({ lines: [L("a", 25000, 1)], delivery }).deliveryFee).toBe(0);
  });

  it("coupon cumulable sous son minimum avec les offres en cours : message dédié, jamais « non cumulable »", () => {
    const exclusive = pct("excl", 5, { combinesWithOtherAutomatic: false });
    const r = run({ lines: [L("a", 10000, 2)], automaticDiscounts: [pct("p20", 20), exclusive], coupon: coupon({ value: 10, minSubtotal: 18000 }) });
    // Offres retenues : −20 % (4 000) → net 16 000 < 18 000.
    expect(r.couponApplied).toBe(false);
    expect(r.couponError).toBe("Minimum de commande non atteint avec les offres en cours.");
    expect(r.messages.map((m) => m.code)).not.toContain("coupon_not_combinable");
    expect(r.discount).toBe(4000);
    // Sans remise automatique, le message habituel.
    expect(run({ lines: [L("a", 5000, 1)], coupon: coupon({ minSubtotal: 18000 }) }).couponError).toMatch(/^Minimum de commande non atteint pour ce code/);
  });

  it("lot générique + variante précise : l'article à variante est servi d'abord", () => {
    const lot = auto("lot", "BUNDLE", { items: [{ productId: "a", quantity: 1 }, { productId: "a", variantId: "va", quantity: 1 }], price: { type: "FIXED_PRICE", amount: 1500 } });
    // Panier : a/vb puis a/va. Si l'article générique prenait a/va, le lot échouerait.
    const r = run({ lines: [L("a", 1000, 1, { variantId: "va" }), L("a", 1000, 1, { variantId: "vb" })], automaticDiscounts: [lot] });
    expect(r.discount).toBe(500);
    invariants(r);
  });
});
