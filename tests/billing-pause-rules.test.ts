/**
 * Suppression du plan Gratuit (18/10/2026) : règles pures de la pause, des rappels de fin d'essai,
 * des boutiques couvertes et du catalogue vendable.
 */
import { describe, expect, it } from "vitest";
import { PLANS, PUBLIC_PLANS, SELF_SERVE_PLANS, TRIAL_DAYS, TRIAL_PLAN, isSellablePlan } from "@/config/plans";
import { coverageMirror, effectivePlanId, pickCoveringSubscription, isLegacyFreeSubscription, pauseReasonOf, planPaymentDecision, shouldPauseStore, trialReminderStage } from "@/lib/billing/rules";
import { decideStoreGoOnline, publishThemeMessage } from "@/lib/theme/publish-rules";

const DAY = 86_400_000;
const now = new Date("2026-10-18T12:00:00Z");
const sub = (o: Partial<{ planId: string; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; coveredBySubscriptionId: string | null }>) => ({
  planId: "BUSINESS",
  status: "TRIALING",
  trialEndsAt: null as Date | null,
  currentPeriodEnd: null as Date | null,
  coveredBySubscriptionId: null as string | null,
  ...o,
});

describe("catalogue : plus de plan Gratuit vendu", () => {
  it("FREE n'est ni public, ni en libre-service, ni vendable", () => {
    expect(PUBLIC_PLANS).toEqual(["STARTER", "BUSINESS", "SCALE", "ENTERPRISE"]);
    expect(SELF_SERVE_PLANS).not.toContain("FREE");
    expect(isSellablePlan("FREE")).toBe(false);
    expect(isSellablePlan("STARTER")).toBe(true);
    expect(PLANS.FREE.sellable).toBe(false);
    for (const p of PUBLIC_PLANS) expect(PLANS[p].price.WORLD ?? 1).toBeGreaterThan(0);
  });

  it("essai : 14 jours du plan Business", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_PLAN).toBe("BUSINESS");
  });
});

describe("shouldPauseStore", () => {
  it("essai en cours : pas de pause ; essai échu : pause", () => {
    expect(shouldPauseStore(sub({ trialEndsAt: new Date(now.getTime() + DAY) }), now)).toBe(false);
    expect(shouldPauseStore(sub({ trialEndsAt: new Date(now.getTime() - 1) }), now)).toBe(true);
  });

  it("abonnement PAUSED, SUSPENDED, CANCELLED ou absent : pause", () => {
    for (const status of ["PAUSED", "SUSPENDED", "CANCELLED"]) expect(shouldPauseStore(sub({ planId: "FREE", status }), now)).toBe(true);
    expect(shouldPauseStore(null, now)).toBe(true);
  });

  it("plan payé en cours, ou en retard dans la grâce : pas de pause ; grâce dépassée : pause", () => {
    expect(shouldPauseStore(sub({ planId: "STARTER", status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() + 10 * DAY) }), now)).toBe(false);
    expect(shouldPauseStore(sub({ planId: "STARTER", status: "PAST_DUE", currentPeriodEnd: new Date(now.getTime() - 3 * DAY) }), now)).toBe(false);
    expect(shouldPauseStore(sub({ planId: "STARTER", status: "PAST_DUE", currentPeriodEnd: new Date(now.getTime() - 8 * DAY) }), now)).toBe(true);
  });

  it("abonnement Gratuit hérité : jamais mis en pause directement (il est d'abord migré vers un essai)", () => {
    const legacy = sub({ planId: "FREE", status: "ACTIVE" });
    expect(isLegacyFreeSubscription(legacy)).toBe(true);
    expect(shouldPauseStore(legacy, now)).toBe(false);
    expect(isLegacyFreeSubscription({ ...legacy, coveredBySubscriptionId: "x" })).toBe(false);
    expect(isLegacyFreeSubscription({ ...legacy, status: "PAUSED" })).toBe(false);
  });

  it("le niveau effectif d'une boutique en pause est le niveau interne FREE (aucune fonction payante)", () => {
    expect(effectivePlanId(sub({ planId: "BUSINESS", status: "PAUSED", trialEndsAt: new Date(now.getTime() - DAY) }), now)).toBe("FREE");
  });
});

describe("pauseReasonOf", () => {
  it("motifs", () => {
    expect(pauseReasonOf(sub({ planId: "FREE", status: "PAUSED", trialEndsAt: new Date(now.getTime() - DAY) }))).toBe("trial_ended");
    expect(pauseReasonOf(sub({ planId: "FREE", status: "PAUSED" }))).toBe("cancelled");
    expect(pauseReasonOf(sub({ planId: "STARTER", status: "SUSPENDED" }))).toBe("unpaid");
    expect(pauseReasonOf(null)).toBe("no_plan");
  });
});

describe("rappels de fin d'essai (J-3, J-1)", () => {
  const end = new Date(now.getTime() + 10 * DAY);
  const t = sub({ trialEndsAt: end });
  const at = (msBeforeEnd: number) => new Date(end.getTime() - msBeforeEnd);
  it("aucun rappel avant J-3", () => expect(trialReminderStage(t, at(3 * DAY + 60_000))).toBeNull());
  it("J-3 entre 3 jours et 1 jour", () => {
    expect(trialReminderStage(t, at(3 * DAY))).toBe(3);
    expect(trialReminderStage(t, at(1 * DAY + 60_000))).toBe(3);
  });
  it("J-1 le dernier jour (un cron manqué à J-3 n'envoie que J-1)", () => {
    expect(trialReminderStage(t, at(DAY))).toBe(1);
    expect(trialReminderStage(t, at(60_000))).toBe(1);
  });
  it("aucun rappel une fois l'essai fini, ni hors essai", () => {
    expect(trialReminderStage(t, at(-1))).toBeNull();
    expect(trialReminderStage(sub({ status: "ACTIVE", trialEndsAt: end }), at(DAY))).toBeNull();
  });
});

describe("boutiques supplémentaires couvertes", () => {
  it("recopie plan, statut, essai et période de l'abonnement principal", () => {
    const parent = { planId: "BUSINESS", status: "TRIALING", trialEndsAt: new Date(now.getTime() + 5 * DAY), currentPeriodEnd: new Date(now.getTime() + 5 * DAY), currentPeriodStart: now, interval: "MONTHLY", zone: "WORLD", currency: "EUR", pausedAt: null };
    const m = coverageMirror(parent, now);
    expect(m).toMatchObject({ planId: "BUSINESS", status: "TRIALING", trialEndsAt: parent.trialEndsAt, currentPeriodEnd: parent.currentPeriodEnd, zone: "WORLD", currency: "EUR", cancelAtPeriodEnd: false });
    // Même droit effectif que la boutique principale.
    expect(effectivePlanId({ ...m }, now)).toBe(effectivePlanId(parent, now));
  });
  it("abonnement principal disparu : la boutique couverte passe en pause", () => {
    const m = coverageMirror(null, now);
    expect(m.status).toBe("PAUSED");
    expect(shouldPauseStore({ ...m, coveredBySubscriptionId: "gone" }, now)).toBe(true);
  });
});

describe("paiement après une pause", () => {
  it("la facture de démarrage payée réactive l'abonnement et efface la pause", () => {
    const d = planPaymentDecision({
      sub: { planId: "FREE", status: "PAUSED", currentPeriodEnd: null, cancelAtPeriodEnd: false },
      invoice: { planId: "STARTER", periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY) },
      now,
      isChange: true,
      isLatest: true,
      stillOverdue: false,
    });
    expect(d.data).toMatchObject({ status: "ACTIVE", planId: "STARTER", pausedAt: null, trialEndsAt: null });
  });
});

describe("publication du thème d'une boutique en pause", () => {
  it("ne remet jamais la boutique en ligne", () => {
    const d = decideStoreGoOnline({ status: "PAUSED", hasWhatsapp: true, activeProducts: 3, activePaymentMethods: 1 });
    expect(d.bringOnline).toBe(false);
    expect(publishThemeMessage({ ...d, paused: true })).toMatch(/en pause/);
  });
});

describe("migration : choix de l'abonnement couvrant", () => {
  const c = (id: string, planId: string, status: string, ageDays: number, end: number | null) => ({
    id, planId, status, trialEndsAt: status === "TRIALING" && end != null ? new Date(now.getTime() + end * DAY) : null,
    currentPeriodEnd: end == null ? null : new Date(now.getTime() + end * DAY), store: { createdAt: new Date(now.getTime() - ageDays * DAY) },
  });
  it("meilleur plan ouvrant droit, puis la plus ancienne ; jamais un abonnement sans droit", () => {
    expect(pickCoveringSubscription([c("a", "STARTER", "ACTIVE", 50, 10), c("b", "SCALE", "ACTIVE", 5, 10), c("p", "FREE", "PAUSED", 90, null)], now)?.id).toBe("b");
    expect(pickCoveringSubscription([c("a", "BUSINESS", "ACTIVE", 5, 10), c("b", "BUSINESS", "TRIALING", 50, 3)], now)?.id).toBe("b");
    expect(pickCoveringSubscription([c("p", "FREE", "PAUSED", 90, null), c("x", "STARTER", "SUSPENDED", 9, -30)], now)).toBeNull();
  });
});
