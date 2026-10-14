import { describe, it, expect } from "vitest";
import { mrrBreakdown, addOnMonthlyAmount, addOnMrrEur, sumByCurrency, conversionRate, walletBalance, barWidth, normalizeZone, type SubLike } from "@/lib/admin/metrics";

const sub = (over: Partial<SubLike>): SubLike => ({ planId: "BUSINESS", interval: "MONTHLY", zone: "WORLD", status: "ACTIVE", ...over });

describe("mrrBreakdown", () => {
  it("valorise tous les abonnements au tarif Monde et sépare les montants facturés par zone", () => {
    const m = mrrBreakdown([sub({}), sub({ zone: "AFRICA" }), sub({ planId: "STARTER", zone: "AFRICA" })]);
    expect(m.consolidatedEur).toBe(2900 + 2900 + 900);
    expect(m.eur).toBe(2900);
    expect(m.xof).toBe(15000 + 5000);
    expect(m.paying).toBe(3);
    expect(m.byPlan.BUSINESS.count).toBe(2);
    expect(m.byPlan.STARTER.consolidatedEur).toBe(900);
  });

  it("ramène l'annuel au mois (10 mois payés sur 12)", () => {
    const m = mrrBreakdown([sub({ interval: "YEARLY" })]);
    expect(m.consolidatedEur).toBe(Math.round(29000 / 12));
  });

  it("ignore Gratuit, essais, impayés et abonnements annulés", () => {
    const m = mrrBreakdown([sub({ planId: "FREE" }), sub({ status: "TRIALING" }), sub({ status: "PAST_DUE" }), sub({ status: "CANCELLED" })]);
    expect(m).toMatchObject({ consolidatedEur: 0, eur: 0, xof: 0, paying: 0 });
  });

  it("traite une zone inconnue comme Monde", () => {
    expect(normalizeZone("???")).toBe("WORLD");
    expect(mrrBreakdown([sub({ zone: "" })]).eur).toBe(2900);
  });
});

describe("options", () => {
  it("normalise les options récurrentes au mois, ignore ponctuel et packs", () => {
    expect(addOnMonthlyAmount("MONTHLY", 500)).toBe(500);
    expect(addOnMonthlyAmount("YEARLY", 1500)).toBe(125);
    expect(addOnMonthlyAmount("ONE_TIME", 9900)).toBe(0);
    expect(addOnMonthlyAmount("PACK", 900)).toBe(0);
  });
  it("calcule le MRR des options au tarif Monde, quantité comprise", () => {
    expect(addOnMrrEur([{ addOnId: "EXTRA_MEMBER", quantity: 2 }, { addOnId: "PACK_AI_1000", quantity: 1 }, { addOnId: "INCONNUE", quantity: 3 }])).toBe(1000);
  });
});

describe("agrégats", () => {
  it("additionne par devise sans conversion", () => {
    expect(sumByCurrency([{ amount: 900, currency: "EUR" }, { amount: 5000, currency: "XOF" }, { amount: 100, currency: "EUR" }])).toEqual({ EUR: 1000, XOF: 5000 });
    expect(sumByCurrency([])).toEqual({});
  });
  it("calcule un taux de conversion borné, null sans base", () => {
    expect(conversionRate(3, 8)).toBe(37.5);
    expect(conversionRate(5, 4)).toBe(100);
    expect(conversionRate(0, 0)).toBeNull();
  });
  it("un solde de portefeuille n'est jamais négatif", () => {
    expect(walletBalance(-20)).toBe(0);
    expect(walletBalance(null)).toBe(0);
    expect(walletBalance(120)).toBe(120);
  });
  it("largeur de barre proportionnelle, minimum visible, 0 sans valeur", () => {
    expect(barWidth(5, 10)).toBe(50);
    expect(barWidth(1, 1000)).toBe(2);
    expect(barWidth(0, 10)).toBe(0);
    expect(barWidth(3, 0)).toBe(0);
  });
});
