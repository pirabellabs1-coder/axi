import { describe, expect, it } from "vitest";
import {
  billingZone,
  confirmationHasAmount,
  effectivePlanId,
  gatewayStatusOutcome,
  graceEndsAt,
  monthlyCreditsPlan,
  planPaymentDecision,
} from "@/lib/billing/rules";
import { domainExpired } from "@/lib/domains/expiry";

const DAY = 86_400_000;
const now = new Date("2026-10-10T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * DAY);

/** Abonnement Starter payé du 1er au 31 octobre. */
const starterPaid = { planId: "STARTER", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: days(21), cancelAtPeriodEnd: false };

describe("B2 : un plan payant n'est accordé qu'après paiement", () => {
  it("une montée demandée mais non réglée laisse l'ancien plan en place", () => {
    // changePlan n'écrit pas l'abonnement : il reste sur Starter tant que la facture Business est OPEN.
    expect(effectivePlanId(starterPaid, now)).toBe("STARTER");
  });

  it("un plan payant sans période réglée n'est jamais accordé", () => {
    expect(effectivePlanId({ planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null }, now)).toBe("FREE");
    expect(effectivePlanId({ planId: "SCALE", status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: null }, now)).toBe("FREE");
  });

  it("l'essai de 14 jours donne Business sans facture, puis Gratuit", () => {
    expect(effectivePlanId({ planId: "BUSINESS", status: "TRIALING", trialEndsAt: days(3), currentPeriodEnd: days(3) }, now)).toBe("BUSINESS");
    expect(effectivePlanId({ planId: "BUSINESS", status: "TRIALING", trialEndsAt: days(-1), currentPeriodEnd: days(-1) }, now)).toBe("FREE");
  });

  it("le paiement de la facture de montée applique le plan sur une période complète", () => {
    const d = planPaymentDecision({
      sub: starterPaid,
      invoice: { planId: "BUSINESS", periodStart: now, periodEnd: new Date("2026-11-10T12:00:00Z") },
      now,
      isChange: true,
      isLatest: true,
      stillOverdue: false,
    });
    expect(d.data.planId).toBe("BUSINESS");
    expect(d.data.status).toBe("ACTIVE");
    expect(d.data.currentPeriodEnd).toEqual(new Date("2026-11-10T12:00:00Z"));
    expect(d.data.cancelAtPeriodEnd).toBe(false);
  });

  it("une montée réglée en retard démarre au paiement (aucun jour perdu)", () => {
    const issued = days(-5);
    const d = planPaymentDecision({
      sub: starterPaid,
      invoice: { planId: "BUSINESS", periodStart: issued, periodEnd: new Date(issued.getTime() + 31 * DAY) },
      now,
      isChange: true,
      isLatest: true,
      stillOverdue: false,
    });
    expect(d.periodStart).toEqual(now);
    expect(d.data.currentPeriodStart).toEqual(now);
    expect(d.data.currentPeriodEnd!.getTime()).toBeGreaterThan(days(29).getTime());
  });

  it("un renouvellement réglé en avance ne bascule qu'à l'échéance", () => {
    const d = planPaymentDecision({
      sub: { ...starterPaid, planId: "BUSINESS", cancelAtPeriodEnd: true },
      invoice: { planId: "STARTER", periodStart: days(21), periodEnd: days(52) },
      now,
      isChange: false,
      isLatest: true,
      stillOverdue: false,
    });
    expect(d.future).toBe(true);
    expect(d.data.planId).toBeUndefined();
    expect(d.data.currentPeriodEnd).toBeUndefined();
  });

  it("une autre facture échue maintient le statut de retard", () => {
    const d = planPaymentDecision({
      sub: { ...starterPaid, status: "PAST_DUE" },
      invoice: { planId: "STARTER", periodStart: days(-30), periodEnd: days(1) },
      now,
      isChange: false,
      isLatest: false,
      stillOverdue: true,
    });
    expect(d.data.status).toBe("PAST_DUE");
  });
});

describe("B2 : impayé, grâce depuis l'échéance de la facture", () => {
  it("grâce de 7 jours à partir de dueAt", () => {
    expect(graceEndsAt({ dueAt: now })).toEqual(days(7));
  });
  it("au-delà de la grâce : Gratuit, données conservées", () => {
    const sub = { planId: "STARTER", status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: days(-6) };
    expect(effectivePlanId(sub, now)).toBe("STARTER");
    expect(effectivePlanId({ ...sub, currentPeriodEnd: days(-8) }, now)).toBe("FREE");
    expect(effectivePlanId({ ...sub, status: "SUSPENDED" }, now)).toBe("FREE");
  });
});

describe("B2 : crédits mensuels seulement avec une facture payée (hors essai)", () => {
  const businessSub = { planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: days(20) };
  const paidBusiness = { planId: "BUSINESS", periodStart: days(-10), periodEnd: days(20) };

  it("aucun crédit sans facture payée couvrant la période", () => {
    expect(monthlyCreditsPlan(businessSub, null, now)).toBeNull();
    expect(monthlyCreditsPlan(businessSub, { ...paidBusiness, periodStart: days(-40), periodEnd: days(-10) }, now)).toBeNull();
  });
  it("crédits du plan payé", () => {
    expect(monthlyCreditsPlan(businessSub, paidBusiness, now)).toBe("BUSINESS");
  });
  it("jamais plus que le plan réellement payé", () => {
    expect(monthlyCreditsPlan(businessSub, { ...paidBusiness, planId: "STARTER" }, now)).toBe("STARTER");
  });
  it("essai en cours : crédits du plan d'essai sans facture", () => {
    expect(monthlyCreditsPlan({ planId: "BUSINESS", status: "TRIALING", trialEndsAt: days(4), currentPeriodEnd: days(4) }, null, now)).toBe("BUSINESS");
  });
  it("abonnement suspendu : rien, même avec une ancienne facture payée", () => {
    expect(monthlyCreditsPlan({ ...businessSub, status: "SUSPENDED" }, paidBusiness, now)).toBeNull();
  });
});

describe("M1 : la zone de l'abonnement fait foi", () => {
  it("une zone posée par l'admin n'est pas écrasée par la devise de la boutique", () => {
    expect(billingZone({ zone: "WORLD" }, "XOF")).toBe("WORLD");
    expect(billingZone({ zone: "AFRICA" }, "EUR")).toBe("AFRICA");
  });
  it("sans abonnement, la zone est déduite de la devise", () => {
    expect(billingZone(null, "XOF")).toBe("AFRICA");
    expect(billingZone(undefined, "EUR")).toBe("WORLD");
  });
});

describe("M6 : double confirmation passerelle", () => {
  it("un second CONFIRMED avec une autre référence est un paiement en double", () => {
    expect(gatewayStatusOutcome({ status: "CONFIRMED", providerRef: "tx_1" }, "PAID", { status: "CONFIRMED", providerRef: "tx_2" })).toBe("duplicate");
  });
  it("le rejeu du même CONFIRMED est ignoré", () => {
    expect(gatewayStatusOutcome({ status: "CONFIRMED", providerRef: "tx_1" }, "PAID", { status: "CONFIRMED", providerRef: "tx_1" })).toBe("ignore");
  });
  it("une autre tentative confirmée sur une commande déjà payée est un doublon", () => {
    expect(gatewayStatusOutcome({ status: "INITIATED", providerRef: "tx_9" }, "PAID", { status: "CONFIRMED", providerRef: "tx_9" })).toBe("duplicate");
  });
  it("un PENDING tardif ne rétrograde jamais un paiement confirmé", () => {
    expect(gatewayStatusOutcome({ status: "CONFIRMED", providerRef: "tx_1" }, "PAID", { status: "PENDING", providerRef: "tx_1" })).toBe("ignore");
    expect(gatewayStatusOutcome({ status: "INITIATED", providerRef: "tx_1" }, "PENDING", { status: "CONFIRMED", providerRef: "tx_1" })).toBe("apply");
  });
});

describe("m12 : CONFIRMED sans montant ni devise refusé", () => {
  it("exige montant et devise pour un paiement confirmé", () => {
    expect(confirmationHasAmount({ status: "CONFIRMED", amount: 5000, currency: "XOF" })).toBe(true);
    expect(confirmationHasAmount({ status: "CONFIRMED", currency: "XOF" })).toBe(false);
    expect(confirmationHasAmount({ status: "CONFIRMED", amount: 5000 })).toBe(false);
    expect(confirmationHasAmount({ status: "PENDING" })).toBe(true);
  });
});

describe("domaines non vérifiés", () => {
  it("expirent après 7 jours", () => {
    expect(domainExpired({ verified: false, createdAt: days(-8) }, now)).toBe(true);
    expect(domainExpired({ verified: false, createdAt: days(-6) }, now)).toBe(false);
    expect(domainExpired({ verified: true, createdAt: days(-80) }, now)).toBe(false);
  });
});
