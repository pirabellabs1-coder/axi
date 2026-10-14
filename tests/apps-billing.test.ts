import { describe, expect, it } from "vitest";
import {
  initialBillingForInstall,
  nextBillingTransition,
  computeDeveloperEarnings,
  formatBillingStatus,
  type EarningsInstall,
} from "@/lib/apps/billing";
import { APP_PLATFORM_FEE_PCT } from "@/lib/apps/types";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("initialBillingForInstall", () => {
  it("FREE (ou montant nul) → aucune facturation", () => {
    expect(initialBillingForInstall({ pricingType: "FREE", priceAmount: 0, trialDays: 0 })).toEqual({
      priceAmount: 0,
      billingStatus: "none",
      trialEndsAt: null,
    });
    // SUBSCRIPTION mais montant nul → gratuit
    expect(initialBillingForInstall({ pricingType: "SUBSCRIPTION", priceAmount: 0, trialDays: 14 }).billingStatus).toBe("none");
  });

  it("SUBSCRIPTION avec essai → trialing + trialEndsAt = now + trialDays", () => {
    const r = initialBillingForInstall({ pricingType: "SUBSCRIPTION", priceAmount: 5000, priceInterval: "month", trialDays: 7 }, NOW);
    expect(r.billingStatus).toBe("trialing");
    expect(r.priceAmount).toBe(5000);
    expect(r.trialEndsAt?.getTime()).toBe(NOW.getTime() + 7 * DAY_MS);
  });

  it("SUBSCRIPTION sans essai → active", () => {
    const r = initialBillingForInstall({ pricingType: "SUBSCRIPTION", priceAmount: 5000, priceInterval: "month", trialDays: 0 }, NOW);
    expect(r).toEqual({ priceAmount: 5000, billingStatus: "active", trialEndsAt: null });
  });

  it("ONE_TIME → active, pas d'essai", () => {
    const r = initialBillingForInstall({ pricingType: "ONE_TIME", priceAmount: 2000, trialDays: 7 }, NOW);
    expect(r).toEqual({ priceAmount: 2000, billingStatus: "active", trialEndsAt: null });
  });
});

describe("nextBillingTransition", () => {
  it("essai échu → active", () => {
    expect(nextBillingTransition({ billingStatus: "trialing", trialEndsAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("active");
    expect(nextBillingTransition({ billingStatus: "trialing", trialEndsAt: NOW }, NOW)).toBe("active");
  });

  it("essai non échu → inchangé (null)", () => {
    expect(nextBillingTransition({ billingStatus: "trialing", trialEndsAt: new Date(NOW.getTime() + DAY_MS) }, NOW)).toBeNull();
  });

  it("aucune transition automatique pour active / cancelled / none (pas de past_due sans provider)", () => {
    expect(nextBillingTransition({ billingStatus: "active", trialEndsAt: null }, NOW)).toBeNull();
    expect(nextBillingTransition({ billingStatus: "cancelled", trialEndsAt: null }, NOW)).toBeNull();
    expect(nextBillingTransition({ billingStatus: null, trialEndsAt: null }, NOW)).toBeNull();
    // trialing sans date : aucune transition tant que trialEndsAt est absent
    expect(nextBillingTransition({ billingStatus: "trialing", trialEndsAt: null }, NOW)).toBeNull();
  });
});

describe("computeDeveloperEarnings", () => {
  const sub = (billingStatus: string, priceAmount: number, priceInterval = "month"): EarningsInstall => ({
    billingStatus,
    priceAmount,
    pricingType: "SUBSCRIPTION",
    priceInterval,
  });

  it("somme uniquement les abonnements actifs payants ; commission et net justes", () => {
    const installs = [
      sub("active", 5000),
      sub("active", 5000),
      sub("trialing", 5000), // essai : pas encore de revenu
      sub("cancelled", 5000), // annulé : exclu
      { billingStatus: "active", priceAmount: 2000, pricingType: "ONE_TIME" as const }, // paiement unique : hors MRR
    ];
    const r = computeDeveloperEarnings(installs, 20);
    expect(r.activePaidInstalls).toBe(2);
    expect(r.grossMonthly).toBe(10000);
    expect(r.feeMonthly).toBe(2000);
    expect(r.netMonthly).toBe(8000);
  });

  it("abonnement annuel normalisé au mois (÷12, arrondi entier)", () => {
    const r = computeDeveloperEarnings([sub("active", 60000, "year")], 20);
    expect(r.grossMonthly).toBe(5000); // 60000 / 12
    expect(r.feeMonthly).toBe(1000);
    expect(r.netMonthly).toBe(4000);
  });

  it("bornes : liste vide = 0 ; feePct borné à [0, 100]", () => {
    expect(computeDeveloperEarnings([], 20)).toEqual({ activePaidInstalls: 0, grossMonthly: 0, feeMonthly: 0, netMonthly: 0 });
    expect(computeDeveloperEarnings([sub("active", 5000)], 0).feeMonthly).toBe(0);
    expect(computeDeveloperEarnings([sub("active", 5000)], 150).feeMonthly).toBe(5000); // borné à 100 %
    expect(computeDeveloperEarnings([sub("active", 5000)], 100).netMonthly).toBe(0);
  });

  it("utilise la constante de commission exportée", () => {
    const r = computeDeveloperEarnings([sub("active", 10000)], APP_PLATFORM_FEE_PCT);
    expect(r.feeMonthly).toBe(Math.round((10000 * APP_PLATFORM_FEE_PCT) / 100));
  });
});

describe("formatBillingStatus", () => {
  it("libellés FR", () => {
    expect(formatBillingStatus("trialing")).toBe("Essai gratuit");
    expect(formatBillingStatus("active")).toBe("Actif");
    expect(formatBillingStatus("past_due")).toBe("Impayé");
    expect(formatBillingStatus("cancelled")).toBe("Annulé");
    expect(formatBillingStatus("none")).toBe("—");
    expect(formatBillingStatus(null)).toBe("—");
    expect(formatBillingStatus(undefined)).toBe("—");
  });
});
