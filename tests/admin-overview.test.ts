import { describe, it, expect } from "vitest";
import { monthStarts, weekStarts, dayStarts, bucketCounts, mrrSeriesFromInvoices, payingStoresAt, churn, arpa, funnel, invoiceMonths } from "@/lib/admin/metrics";
import { matchesAudience, announcementState } from "@/lib/admin/announcements";

const now = new Date("2026-10-10T12:00:00Z");

describe("axes temporels", () => {
  it("mois, semaines (lundi) et jours, du plus ancien au courant", () => {
    const m = monthStarts(12, now);
    expect(m).toHaveLength(12);
    expect(m[0].toISOString()).toBe("2025-11-01T00:00:00.000Z");
    expect(m[11].toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const w = weekStarts(3, now);
    expect(w[2].toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(w[0].getUTCDay()).toBe(1);
    expect(dayStarts(2, now).map((d) => d.toISOString())).toEqual(["2026-10-09T00:00:00.000Z", "2026-10-10T00:00:00.000Z"]);
  });
  it("répartit les dates par intervalle et ignore celles hors fenêtre", () => {
    const starts = dayStarts(3, now);
    const counts = bucketCounts([new Date("2026-10-08T10:00:00Z"), new Date("2026-10-10T01:00:00Z"), new Date("2026-10-10T23:00:00Z"), new Date("2026-10-01"), null], starts);
    expect(counts).toEqual([1, 0, 2]);
  });
});

describe("MRR reconstruit depuis les factures payées", () => {
  const inv = (o: Partial<{ storeId: string; amount: number; currency: string; periodStart: Date; periodEnd: Date }>) => ({ storeId: "s1", amount: 2900, currency: "EUR", periodStart: new Date("2026-09-15"), periodEnd: new Date("2026-10-15"), ...o });

  it("ramène l'annuel au mois et sépare les devises", () => {
    expect(invoiceMonths(new Date("2026-01-01"), new Date("2027-01-01"))).toBe(12);
    const months = monthStarts(2, now); // septembre, octobre
    const s = mrrSeriesFromInvoices([inv({}), inv({ storeId: "s2", amount: 150000, currency: "XOF", periodStart: new Date("2026-03-01"), periodEnd: new Date("2027-03-01") })], months, now);
    expect(s.EUR).toEqual([2900, 2900]);
    expect(s.XOF).toEqual([12500, 12500]);
  });
  it("ne compte un mois que si la période le couvre", () => {
    const months = monthStarts(3, now); // août, septembre, octobre
    const s = mrrSeriesFromInvoices([inv({})], months, now);
    expect(s.EUR).toEqual([0, 2900, 2900]);
  });
  it("churn, ARPA et clients payants", () => {
    const rows = [inv({ storeId: "a", periodStart: new Date("2026-09-20"), periodEnd: new Date("2026-10-05") }), inv({ storeId: "b" }), inv({ storeId: "c", amount: 0 })];
    const start = payingStoresAt(rows, new Date("2026-10-01"));
    const current = payingStoresAt(rows, now);
    expect([...start].sort()).toEqual(["a", "b"]);
    expect(churn(start, current)).toEqual({ base: 2, lost: 1, rate: 50 });
    expect(churn(new Set(), current).rate).toBeNull();
    expect(arpa(5800, 2)).toBe(2900);
    expect(arpa(0, 0)).toBeNull();
  });
});

describe("entonnoir d'activation", () => {
  it("calcule les taux d'étape et depuis l'inscription", () => {
    const f = funnel([
      { key: "signup", label: "Inscrits", count: 200 },
      { key: "store", label: "Boutique créée", count: 120 },
      { key: "published", label: "Publiée", count: 60 },
      { key: "order", label: "1re commande", count: 15 },
    ]);
    expect(f[0].fromPrevious).toBeNull();
    expect(f[1].fromPrevious).toBe(60);
    expect(f[2].fromPrevious).toBe(50);
    expect(f[3].fromFirst).toBe(7.5);
    expect(funnel([{ key: "a", label: "A", count: 0 }, { key: "b", label: "B", count: 0 }])[1].fromPrevious).toBeNull();
  });
});

describe("annonces", () => {
  it("cible l'audience", () => {
    expect(matchesAudience("all", "FREE", "WORLD")).toBe(true);
    expect(matchesAudience("free", "STARTER", "WORLD")).toBe(false);
    expect(matchesAudience("paid", "STARTER", "WORLD")).toBe(true);
    expect(matchesAudience("zone:AFRICA", "BUSINESS", "AFRICA")).toBe(true);
    expect(matchesAudience("zone:AFRICA", "BUSINESS", "WORLD")).toBe(false);
    expect(matchesAudience("plan:SCALE", "SCALE", "WORLD")).toBe(true);
    expect(matchesAudience("inconnue", "SCALE", "WORLD")).toBe(false);
  });
  it("donne l'état selon la période", () => {
    const base = { active: true, startsAt: new Date("2026-10-01"), endsAt: null as Date | null };
    expect(announcementState(base, now)).toBe("live");
    expect(announcementState({ ...base, startsAt: new Date("2026-11-01") }, now)).toBe("scheduled");
    expect(announcementState({ ...base, endsAt: new Date("2026-10-05") }, now)).toBe("ended");
    expect(announcementState({ ...base, active: false }, now)).toBe("paused");
  });
});
