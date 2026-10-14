import { describe, it, expect, vi } from "vitest";
import { PLANS, PLAN_ORDER, type PlanId } from "@/config/plans";

/**
 * Plans et capacités du lot 3 (§5 et §6) : limites de dépôts et d'appareils de caisse, fonctions
 * (tarifs avancés, étiquettes et page livreur, API transporteurs, transferts, caisse) et capacité
 * `pos.sell` par rôle. Le tableau de la spec est la référence.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { roleHas } = await import("@/lib/auth/permissions");

describe("limites de plan", () => {
  it("dépôts : 1 / 1 / 2 / 10 / illimité", () => {
    const expected: Record<PlanId, number | null> = { FREE: 1, STARTER: 1, BUSINESS: 2, SCALE: 10, ENTERPRISE: null };
    for (const id of PLAN_ORDER) expect(PLANS[id].limits.locations).toBe(expected[id]);
  });

  it("appareils de caisse : 0 / 0 / 1 / 5 / illimité", () => {
    const expected: Record<PlanId, number | null> = { FREE: 0, STARTER: 0, BUSINESS: 1, SCALE: 5, ENTERPRISE: null };
    for (const id of PLAN_ORDER) expect(PLANS[id].limits.posDevices).toBe(expected[id]);
  });

  it("les limites croissent avec le plan (aucune régression en montant de gamme)", () => {
    const value = (v: number | null) => (v == null ? Number.POSITIVE_INFINITY : v);
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      expect(value(PLANS[PLAN_ORDER[i]].limits.locations)).toBeGreaterThanOrEqual(value(PLANS[PLAN_ORDER[i - 1]].limits.locations));
      expect(value(PLANS[PLAN_ORDER[i]].limits.posDevices)).toBeGreaterThanOrEqual(value(PLANS[PLAN_ORDER[i - 1]].limits.posDevices));
    }
  });
});

describe("fonctions de plan", () => {
  it("étiquettes internes, page livreur et code de remise à partir de Business (couriers)", () => {
    expect(PLANS.FREE.features.couriers).toBe(false);
    expect(PLANS.STARTER.features.couriers).toBe(false);
    expect(PLANS.BUSINESS.features.couriers).toBe(true);
    expect(PLANS.SCALE.features.couriers).toBe(true);
  });

  it("API transporteurs à partir de Scale (carriers)", () => {
    expect(PLANS.BUSINESS.features.carriers).toBe(false);
    expect(PLANS.SCALE.features.carriers).toBe(true);
    expect(PLANS.ENTERPRISE.features.carriers).toBe(true);
  });

  it("transferts entre dépôts à partir de Business (cohérent avec la limite de 2 dépôts)", () => {
    expect(PLANS.STARTER.features.stockTransfers).toBe(false);
    expect(PLANS.BUSINESS.features.stockTransfers).toBe(true);
    for (const id of PLAN_ORDER) {
      // Une boutique ne peut transférer que si son plan permet au moins deux dépôts.
      if (PLANS[id].features.stockTransfers) {
        const limit = PLANS[id].limits.locations;
        expect(limit == null || limit >= 2).toBe(true);
      }
    }
  });

  it("caisse : la fonction `pos` et la limite d'appareils restent cohérentes", () => {
    for (const id of PLAN_ORDER) {
      const limit = PLANS[id].limits.posDevices;
      if (PLANS[id].features.pos) expect(limit == null || limit > 0).toBe(true);
    }
    // Business a la caisse (1 appareil) sans la fonction « pos » historique (réservée à Scale) :
    // le contrôle serveur s'appuie donc sur la LIMITE, pas sur le drapeau.
    expect(PLANS.BUSINESS.limits.posDevices).toBe(1);
  });
});

describe("capacité pos.sell", () => {
  it("accordée à OWNER, MANAGER et STAFF, refusée à SUPPORT", () => {
    expect(roleHas("OWNER", "pos.sell")).toBe(true);
    expect(roleHas("MANAGER", "pos.sell")).toBe(true);
    expect(roleHas("STAFF", "pos.sell")).toBe(true);
    expect(roleHas("SUPPORT", "pos.sell")).toBe(false);
  });

  it("un STAFF ne gère ni les dépôts ni les transporteurs", () => {
    expect(roleHas("STAFF", "products.manage")).toBe(false);
    expect(roleHas("STAFF", "delivery.manage")).toBe(false);
    expect(roleHas("STAFF", "store.settings")).toBe(false);
  });
});
