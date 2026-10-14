import { describe, it, expect, vi } from "vitest";

// service.ts est un module serveur : on neutralise ses dépendances d'infrastructure
// pour tester uniquement les règles pures (prorata, sens d'un changement, fin de période).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/addons/service", () => ({ activateAddOnPurchase: vi.fn() }));

const { prorationCredit, changeDirection, periodEndFor } = await import("@/lib/billing/service");

const start = new Date("2026-10-01T00:00:00Z");
const end = new Date("2026-10-31T00:00:00Z"); // 30 jours
const at = (days: number) => new Date(start.getTime() + days * 86_400_000);

describe("prorationCredit", () => {
  it("crédite la part non consommée de la période", () => {
    expect(prorationCredit(15000, start, end, at(10))).toBe(10000);
    expect(prorationCredit(2900, start, end, at(15))).toBe(1450);
  });

  it("arrondit à l'unité inférieure (en faveur de la plateforme)", () => {
    // 2 900 × 20/30 = 1 933,33… → 1 933
    expect(prorationCredit(2900, start, end, at(10))).toBe(1933);
  });

  it("crédite tout au premier instant et rien à l'échéance ou après", () => {
    expect(prorationCredit(5000, start, end, start)).toBe(5000);
    expect(prorationCredit(5000, start, end, end)).toBe(0);
    expect(prorationCredit(5000, start, end, at(45))).toBe(0);
  });

  it("ne dépasse jamais le montant payé, même avant le début de période", () => {
    expect(prorationCredit(5000, start, end, at(-5))).toBe(5000);
  });

  it("renvoie 0 pour un montant nul ou une période invalide", () => {
    expect(prorationCredit(0, start, end, at(1))).toBe(0);
    expect(prorationCredit(5000, end, start, at(1))).toBe(0);
  });
});

describe("changeDirection", () => {
  it("détecte une montée, une descente ou un statu quo", () => {
    expect(changeDirection({ planId: "STARTER", interval: "MONTHLY" }, { planId: "BUSINESS", interval: "MONTHLY" })).toBeGreaterThan(0);
    expect(changeDirection({ planId: "SCALE", interval: "MONTHLY" }, { planId: "BUSINESS", interval: "YEARLY" })).toBeLessThan(0);
    expect(changeDirection({ planId: "BUSINESS", interval: "MONTHLY" }, { planId: "BUSINESS", interval: "MONTHLY" })).toBe(0);
  });
  it("considère le passage à l'annuel comme une montée", () => {
    expect(changeDirection({ planId: "BUSINESS", interval: "MONTHLY" }, { planId: "BUSINESS", interval: "YEARLY" })).toBe(1);
    expect(changeDirection({ planId: "BUSINESS", interval: "YEARLY" }, { planId: "BUSINESS", interval: "MONTHLY" })).toBe(-1);
  });
});

describe("periodEndFor", () => {
  it("ajoute 1 mois ou 12 mois", () => {
    const s = new Date(2026, 9, 10);
    expect(periodEndFor(s, "MONTHLY")).toEqual(new Date(2026, 10, 10));
    expect(periodEndFor(s, "YEARLY")).toEqual(new Date(2027, 9, 10));
  });
});
