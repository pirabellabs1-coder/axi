import { describe, expect, it } from "vitest";
import { changeDirection, prorationCredit, periodEndFor } from "@/lib/billing/proration";
import { planPrice } from "@/config/plans";

describe("facturation V4 : prorata", () => {
  const start = new Date("2026-10-01T00:00:00Z");
  const end = new Date("2026-10-31T00:00:00Z"); // 30 jours

  it("crédite la moitié d'une période à mi-parcours (unités entières)", () => {
    expect(prorationCredit(15000, start, end, new Date("2026-10-16T00:00:00Z"))).toBe(7500);
    expect(prorationCredit(2900, start, end, new Date("2026-10-16T00:00:00Z"))).toBe(1450);
  });

  it("arrondit à l'inférieur et ne crédite rien hors période", () => {
    expect(Number.isInteger(prorationCredit(999, start, end, new Date("2026-10-11T07:13:00Z")))).toBe(true);
    expect(prorationCredit(15000, start, end, new Date("2026-11-02T00:00:00Z"))).toBe(0);
    expect(prorationCredit(0, start, end, new Date("2026-10-10T00:00:00Z"))).toBe(0);
  });

  it("ne crédite jamais plus que le montant payé", () => {
    expect(prorationCredit(15000, start, end, new Date("2026-09-01T00:00:00Z"))).toBe(15000);
  });
});

describe("facturation V4 : sens du changement", () => {
  it("plan supérieur = montée, inférieur = descente", () => {
    expect(changeDirection({ planId: "STARTER", interval: "MONTHLY" }, { planId: "BUSINESS", interval: "MONTHLY" })).toBeGreaterThan(0);
    expect(changeDirection({ planId: "SCALE", interval: "YEARLY" }, { planId: "BUSINESS", interval: "YEARLY" })).toBeLessThan(0);
  });
  it("mensuel vers annuel = montée, annuel vers mensuel = descente", () => {
    expect(changeDirection({ planId: "BUSINESS", interval: "MONTHLY" }, { planId: "BUSINESS", interval: "YEARLY" })).toBe(1);
    expect(changeDirection({ planId: "BUSINESS", interval: "YEARLY" }, { planId: "BUSINESS", interval: "MONTHLY" })).toBe(-1);
    expect(changeDirection({ planId: "BUSINESS", interval: "YEARLY" }, { planId: "BUSINESS", interval: "YEARLY" })).toBe(0);
  });
  it("période annuelle = 12 mois, 10 payés", () => {
    expect(periodEndFor(new Date("2026-01-15T00:00:00Z"), "YEARLY").getUTCFullYear()).toBe(2027);
    expect(planPrice("BUSINESS", "AFRICA", "YEARLY").amount).toBe(150000);
    expect(planPrice("BUSINESS", "WORLD", "YEARLY").amount).toBe(29000);
  });
});
