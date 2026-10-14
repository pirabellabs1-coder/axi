import { describe, it, expect } from "vitest";
import { resolveOverride, priceForInterval, couponDiscount, couponEligibility, couponStillApplies, normalizeCouponCode, COUPON_CODE_RE, defaultPlanMonthly, defaultAddOnPrice, type CouponLike, type OverrideRow } from "@/lib/pricing/rules";
import { planPrice } from "@/config/plans";

const row = (o: Partial<OverrideRow>): OverrideRow => ({ itemType: "plan", itemId: "BUSINESS", zone: "AFRICA", amount: 12000, active: true, createdAt: new Date("2026-09-01"), ...o });

describe("résolution des prix surchargés", () => {
  it("prend la dernière surcharge active de l'article et de la zone", () => {
    const rows = [row({ amount: 12000, createdAt: new Date("2026-09-01") }), row({ amount: 13000, createdAt: new Date("2026-10-01") }), row({ amount: 99, active: false, createdAt: new Date("2026-10-05") })];
    expect(resolveOverride(rows, "plan", "BUSINESS", "AFRICA")).toBe(13000);
  });
  it("ignore les autres zones, articles et types, et renvoie null sans surcharge", () => {
    const rows = [row({ zone: "WORLD", amount: 3500 }), row({ itemId: "STARTER" }), row({ itemType: "addon" })];
    expect(resolveOverride(rows, "plan", "BUSINESS", "AFRICA")).toBeNull();
    expect(resolveOverride(rows, "plan", "BUSINESS", "WORLD")).toBe(3500);
    expect(resolveOverride([], "addon", "PACK_AI_1000", "WORLD")).toBeNull();
  });
  it("retombe sur le catalogue statique", () => {
    expect(defaultPlanMonthly("BUSINESS", "AFRICA")).toBe(15000);
    expect(defaultAddOnPrice("PACK_AI_1000", "WORLD")).toBe(900);
    expect(defaultAddOnPrice("INCONNU", "WORLD")).toBeNull();
  });
  it("applique la règle annuelle (10 mois pour 12) comme planPrice", () => {
    expect(priceForInterval(2900, "WORLD", "YEARLY")).toEqual(planPrice("BUSINESS", "WORLD", "YEARLY"));
    expect(priceForInterval(15000, "AFRICA", "MONTHLY")).toEqual(planPrice("BUSINESS", "AFRICA", "MONTHLY"));
    expect(priceForInterval(13000, "AFRICA", "YEARLY")).toEqual({ amount: 130000, currency: "XOF", perMonth: 10833 });
    expect(priceForInterval(null, "WORLD", "MONTHLY").amount).toBeNull();
  });
});

const coupon = (o: Partial<CouponLike> = {}): CouponLike => ({ id: "c1", code: "LANCEMENT20", percentOff: 20, amountOff: null, zone: null, plans: [], durationMonths: 3, maxRedemptions: null, redemptions: 0, expiresAt: null, active: true, ...o });

describe("remise des codes promo", () => {
  it("pourcentage arrondi à l'unité inférieure", () => {
    expect(couponDiscount(coupon({ percentOff: 20 }), 2900)).toBe(580);
    expect(couponDiscount(coupon({ percentOff: 15 }), 15000)).toBe(2250);
    expect(couponDiscount(coupon({ percentOff: 33 }), 1001)).toBe(330);
  });
  it("100 % ou montant supérieur au brut : jamais plus que le brut", () => {
    expect(couponDiscount(coupon({ percentOff: 100 }), 4500)).toBe(4500);
    expect(couponDiscount(coupon({ percentOff: null, amountOff: 10000 }), 5000)).toBe(5000);
    expect(couponDiscount(coupon({ percentOff: null, amountOff: 500 }), 2900)).toBe(500);
  });
  it("rien sur un montant nul ou sans valeur", () => {
    expect(couponDiscount(coupon(), 0)).toBe(0);
    expect(couponDiscount(coupon({ percentOff: null, amountOff: null }), 2900)).toBe(0);
  });
  it("durée exprimée en nombre de factures", () => {
    expect(couponStillApplies(3, 2)).toBe(true);
    expect(couponStillApplies(3, 3)).toBe(false);
    expect(couponStillApplies(0, 0)).toBe(true);
  });
});

describe("éligibilité d'un code promo", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const ok = { zone: "AFRICA" as const, planId: "BUSINESS" as const, now };

  it("accepte un code valide", () => {
    expect(couponEligibility(coupon(), ok)).toEqual({ ok: true });
  });
  it("refuse inactif, expiré, épuisé, déjà utilisé", () => {
    expect(couponEligibility(coupon({ active: false }), ok).ok).toBe(false);
    expect(couponEligibility(coupon({ expiresAt: new Date("2026-10-10T11:00:00Z") }), ok).ok).toBe(false);
    expect(couponEligibility(coupon({ maxRedemptions: 5, redemptions: 5 }), ok).ok).toBe(false);
    expect(couponEligibility(coupon({ maxRedemptions: 5, redemptions: 5 }), { ...ok, countRedemption: false }).ok).toBe(true);
    expect(couponEligibility(coupon(), { ...ok, alreadyRedeemed: true }).ok).toBe(false);
  });
  it("respecte la zone et les plans ciblés, jamais le plan Gratuit", () => {
    expect(couponEligibility(coupon({ zone: "WORLD" }), ok).ok).toBe(false);
    expect(couponEligibility(coupon({ plans: ["STARTER"] }), ok).ok).toBe(false);
    expect(couponEligibility(coupon({ plans: ["BUSINESS", "SCALE"] }), ok).ok).toBe(true);
    expect(couponEligibility(coupon(), { ...ok, planId: "FREE" }).ok).toBe(false);
  });
  it("normalise et valide le format du code", () => {
    expect(normalizeCouponCode("  lancement 20 ")).toBe("LANCEMENT20");
    expect(COUPON_CODE_RE.test("LANCEMENT20")).toBe(true);
    expect(COUPON_CODE_RE.test("AB")).toBe(false);
    expect(COUPON_CODE_RE.test("PROMO<script>")).toBe(false);
  });
});
