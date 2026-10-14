import { describe, it, expect } from "vitest";
import {
  PLANS,
  PLAN_ORDER,
  SELF_SERVE_PLANS,
  ADD_ONS,
  COMPARISON,
  CREDIT_LABELS,
  YEARLY_MONTHS_PAID,
  ZONE_CURRENCY,
  getAddOn,
  getPlan,
  planPrice,
  planRank,
  zoneForCurrency,
  AUDIENCE_RULES_BY_PLAN,
  REST_API_ACCESS,
  type PlanFeatures,
  type PlanLimits,
  type PlanId,
} from "@/config/plans";

describe("planPrice", () => {
  it("retourne le prix mensuel par zone (EUR en centimes, FCFA entier)", () => {
    expect(planPrice("BUSINESS", "WORLD")).toEqual({ amount: 2900, currency: "EUR", perMonth: 2900 });
    expect(planPrice("BUSINESS", "AFRICA", "MONTHLY")).toEqual({ amount: 15000, currency: "XOF", perMonth: 15000 });
  });

  it("facture l'annuel 10 mois pour 12 et ramène le prix au mois", () => {
    const y = planPrice("STARTER", "WORLD", "YEARLY");
    expect(y.amount).toBe(900 * YEARLY_MONTHS_PAID);
    expect(y.amount).toBe(9000);
    expect(y.perMonth).toBe(Math.round(9000 / 12));
    expect(planPrice("SCALE", "AFRICA", "YEARLY").amount).toBe(450_000);
  });

  it("l'annuel coûte toujours moins que 12 mensualités pour les plans payants", () => {
    for (const id of PLAN_ORDER.filter((p) => p !== "FREE")) {
      for (const zone of ["WORLD", "AFRICA"] as const) {
        const m = planPrice(id, zone, "MONTHLY").amount!;
        const y = planPrice(id, zone, "YEARLY").amount!;
        expect(y).toBeLessThan(m * 12);
      }
    }
  });

  it("le plan Gratuit est à 0 dans les deux zones et sur les deux périodes", () => {
    for (const zone of ["WORLD", "AFRICA"] as const) {
      expect(planPrice("FREE", zone, "MONTHLY").amount).toBe(0);
      expect(planPrice("FREE", zone, "YEARLY").amount).toBe(0);
    }
  });

  it("Enterprise a un prix « à partir de » et n'est pas vendu en libre-service", () => {
    expect(PLANS.ENTERPRISE.fromPrice).toBe(true);
    expect(planPrice("ENTERPRISE", "WORLD").amount).toBe(19900);
    expect(SELF_SERVE_PLANS).not.toContain("ENTERPRISE");
    expect(SELF_SERVE_PLANS).toEqual(["FREE", "STARTER", "BUSINESS", "SCALE"]);
  });
});

describe("zones tarifaires", () => {
  it("XOF et XAF relèvent de la zone Afrique", () => {
    expect(zoneForCurrency("XOF")).toBe("AFRICA");
    expect(zoneForCurrency("XAF")).toBe("AFRICA");
  });
  it("toute autre devise relève de la zone Monde", () => {
    for (const c of ["EUR", "USD", "GNF", "CDF", ""]) expect(zoneForCurrency(c)).toBe("WORLD");
  });
  it("chaque zone a sa devise de facturation", () => {
    expect(ZONE_CURRENCY).toEqual({ WORLD: "EUR", AFRICA: "XOF" });
  });
});

describe("catalogue des plans", () => {
  it("ordonne les plans du Gratuit à Enterprise et classe les rangs", () => {
    expect(PLAN_ORDER).toEqual(["FREE", "STARTER", "BUSINESS", "SCALE", "ENTERPRISE"]);
    expect(planRank("FREE")).toBeLessThan(planRank("SCALE"));
    expect(getPlan("SCALE").name).toBe("Scale");
  });

  it("les prix croissent avec le plan dans chaque zone", () => {
    for (const zone of ["WORLD", "AFRICA"] as const) {
      const prices = PLAN_ORDER.map((p) => PLANS[p].price[zone] ?? Infinity);
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    }
  });

  it("un plan supérieur garde toutes les fonctions du plan inférieur", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLANS[PLAN_ORDER[i - 1]!].features;
      const upper = PLANS[PLAN_ORDER[i]!].features;
      for (const k of Object.keys(lower) as (keyof PlanFeatures)[]) {
        if (lower[k]) expect(upper[k], `${PLAN_ORDER[i]} doit garder ${k}`).toBe(true);
      }
    }
  });

  it("seul Business est mis en avant", () => {
    expect(PLAN_ORDER.filter((p) => PLANS[p].highlight)).toEqual(["BUSINESS"]);
  });
});

describe("COMPARISON (page tarifs)", () => {
  it("chaque ligne a une valeur pour chaque plan", () => {
    for (const g of COMPARISON) for (const r of g.rows) expect(Object.keys(r.values).sort()).toEqual([...PLAN_ORDER].sort());
  });

  it("les lignes dérivées des fonctions reflètent PLANS.features", () => {
    const row = (label: string) => COMPARISON.flatMap((g) => g.rows).find((r) => r.label === label)!;
    const checks: [string, keyof PlanFeatures][] = [
      ["Domaine personnalisé", "customDomain"],
      ["Boîte de réception partagée", "inbox"],
      ["Campagnes WhatsApp", "campaigns"],
      ["Relance des paniers abandonnés", "abandonedCart"],
      ["Mobile Money et carte", "onlinePayments"],
    ];
    for (const [label, key] of checks) {
      for (const p of PLAN_ORDER) expect(row(label).values[p], `${label} / ${p}`).toBe(PLANS[p].features[key]);
    }
  });

  it("les limites illimitées s'affichent « Illimité » et les limites nulles comme non incluses", () => {
    const row = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === "Produits")!;
    expect(row.values.FREE).toBe("100");
    expect(row.values.BUSINESS).toBe("Illimité");
    const msgs = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === "Messages inclus par mois")!;
    expect(msgs.values.FREE).toBe(false);
  });

  it("0 % de commission sur tous les plans", () => {
    const row = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === "Commission sur les ventes")!;
    for (const p of PLAN_ORDER) expect(row.values[p]).toBe("0 %");
  });
});

describe("ADD_ONS", () => {
  it("chaque option a un id unique, un prix positif dans les deux zones et au moins un plan éligible", () => {
    expect(new Set(ADD_ONS.map((a) => a.id)).size).toBe(ADD_ONS.length);
    for (const a of ADD_ONS) {
      expect(a.price.WORLD).toBeGreaterThan(0);
      expect(a.price.AFRICA).toBeGreaterThan(0);
      expect(a.plans.length).toBeGreaterThan(0);
      for (const p of a.plans) expect(PLAN_ORDER).toContain(p);
    }
  });

  it("les packs (et seulement eux) créditent le portefeuille", () => {
    for (const a of ADD_ONS) {
      if (a.billing === "PACK") {
        expect(a.credits, a.id).toBeDefined();
        expect(a.credits!.amount).toBeGreaterThan(0);
        expect(Object.keys(CREDIT_LABELS)).toContain(a.credits!.type);
      } else expect(a.credits, a.id).toBeUndefined();
    }
  });

  it("éligibilité : pas de pack WhatsApp ni de membre en plus sur Gratuit ou Starter", () => {
    const eligible = (plan: PlanId) => ADD_ONS.filter((a) => a.plans.includes(plan)).map((a) => a.id);
    expect(eligible("FREE")).toEqual(["SECTOR_TEMPLATE", "DONE_FOR_YOU"]);
    expect(eligible("STARTER")).not.toContain("PACK_WA_UTILITY_500");
    expect(eligible("STARTER")).not.toContain("EXTRA_MEMBER");
    expect(eligible("BUSINESS")).toEqual(expect.arrayContaining(["EXTRA_MEMBER", "PACK_WA_MARKETING_200", "PACK_AI_1000"]));
    // Lot 4 §22 : crédits IA achetables dès Starter (génération de boutique par l'IA)
    expect(eligible("STARTER")).toContain("PACK_AI_1000");
  });

  it("les options de messagerie WhatsApp exigent un plan avec l'API WhatsApp", () => {
    for (const a of ADD_ONS.filter((x) => x.credits?.type === "WA_UTILITY" || x.credits?.type === "WA_MARKETING" || x.id === "EXTRA_WHATSAPP_NUMBER")) {
      for (const p of a.plans) expect(PLANS[p].features.whatsappApi, `${a.id} / ${p}`).toBe(true);
    }
  });

  it("getAddOn retrouve une option et renvoie null sinon", () => {
    expect(getAddOn("PACK_AI_1000")?.credits).toEqual({ type: "AI", amount: 1000 });
    expect(getAddOn("NOPE")).toBeNull();
  });
});

describe("lot 1 bis : plan Gratuit élargi", () => {
  it("50 commandes par mois et 100 produits, sans dépasser le Starter", () => {
    expect(PLANS.FREE.limits.ordersPerMonth).toBe(50);
    expect(PLANS.FREE.limits.products).toBe(100);
    expect(PLANS.FREE.limits.products!).toBeLessThan(PLANS.STARTER.limits.products!);
    expect(PLANS.FREE.bullets[0]).toBe("100 produits, 50 commandes par mois");
  });

  it("aucun prix n'a changé", () => {
    expect(Object.fromEntries(PLAN_ORDER.map((p) => [p, PLANS[p].price]))).toEqual({
      FREE: { WORLD: 0, AFRICA: 0 },
      STARTER: { WORLD: 900, AFRICA: 5000 },
      BUSINESS: { WORLD: 2900, AFRICA: 15000 },
      SCALE: { WORLD: 7900, AFRICA: 45000 },
      ENTERPRISE: { WORLD: 19900, AFRICA: 130000 },
    });
  });
});

describe("lots 2 et 4 : nouvelles clés de plan", () => {
  const LOT_LIMITS: (keyof PlanLimits)[] = ["currencies", "blogPosts", "webhookEndpoints", "metafieldDefinitions", "alternateTemplatesPerType", "savedSections", "scheduledThemes", "concurrentExperiments", "pushPerMonth"];
  const rank = (v: number | null) => (v == null ? Infinity : v);

  it("les limites ne diminuent jamais en montant de plan", () => {
    for (const key of LOT_LIMITS) {
      for (let i = 1; i < PLAN_ORDER.length; i++) {
        const lower = PLANS[PLAN_ORDER[i - 1]!].limits[key];
        const upper = PLANS[PLAN_ORDER[i]!].limits[key];
        expect(rank(upper), `${key} : ${PLAN_ORDER[i]} >= ${PLAN_ORDER[i - 1]}`).toBeGreaterThanOrEqual(rank(lower));
      }
    }
  });

  it("une fonction à limite chiffrée est cohérente avec sa limite (0 = non incluse)", () => {
    const pairs: [keyof PlanFeatures, keyof PlanLimits][] = [
      ["multiCurrency", "currencies"],
      ["blog", "blogPosts"],
      ["webhooks", "webhookEndpoints"],
      ["metafields", "metafieldDefinitions"],
      ["alternateTemplates", "alternateTemplatesPerType"],
      ["savedSections", "savedSections"],
      ["scheduledThemes", "scheduledThemes"],
      ["abTests", "concurrentExperiments"],
      ["webPush", "pushPerMonth"],
    ];
    for (const p of PLAN_ORDER) {
      for (const [feature, limit] of pairs) {
        const v = PLANS[p].limits[limit];
        expect(PLANS[p].features[feature], `${p} / ${feature}`).toBe(v === null || v > 0);
      }
    }
  });

  it("valeurs des specs (lot 2 §7, lot 4 §22)", () => {
    const col = (key: keyof PlanLimits) => PLAN_ORDER.map((p) => PLANS[p].limits[key]);
    expect(col("currencies")).toEqual([0, 1, 3, 10, null]);
    expect(col("blogPosts")).toEqual([0, 20, null, null, null]);
    expect(col("webhookEndpoints")).toEqual([0, 0, 2, 10, null]);
    expect(col("metafieldDefinitions")).toEqual([0, 10, 100, null, null]);
    expect(col("alternateTemplatesPerType")).toEqual([0, 0, 5, 20, 20]);
    expect(col("savedSections")).toEqual([0, 20, null, null, null]);
    expect(col("scheduledThemes")).toEqual([0, 0, 3, null, null]);
    expect(col("concurrentExperiments")).toEqual([0, 0, 0, 3, 10]);
    expect(col("pushPerMonth")).toEqual([0, 0, 2000, 20000, null]);
    expect(PLAN_ORDER.map((p) => REST_API_ACCESS[p])).toEqual(["none", "none", "read", "full", "full"]);
    expect(PLAN_ORDER.map((p) => PLANS[p].features.restApi)).toEqual([false, false, true, true, true]);
    expect(AUDIENCE_RULES_BY_PLAN.BUSINESS).toEqual(["customer"]);
    expect(AUDIENCE_RULES_BY_PLAN.STARTER).toEqual([]);
    for (const p of PLAN_ORDER) {
      expect(PLANS[p].features.audiencePersonalization).toBe(AUDIENCE_RULES_BY_PLAN[p].length > 0);
      for (const k of ["aiStoreBuilder", "inlineEditing", "qualityScores", "motionPresets"] as const) expect(PLANS[p].features[k], `${p} / ${k}`).toBe(true);
    }
    expect(PLANS.STARTER.features.pwa).toBe(true);
    expect(PLANS.STARTER.features.webPush).toBe(false);
    expect(PLANS.STARTER.features.aiTranslation).toBe(false);
    expect(PLANS.BUSINESS.features.aiTranslation).toBe(true);
    expect(PLANS.BUSINESS.features.liveShopping).toBe(false);
    expect(PLANS.SCALE.features.liveShopping).toBe(true);
  });

  it("le comparatif présente les nouvelles fonctions", () => {
    const labels = COMPARISON.flatMap((g) => g.rows.map((r) => r.label));
    for (const l of ["Articles de blog", "Devises affichées en plus", "Webhooks sortants", "API REST", "Champs personnalisés", "Thèmes programmés (fêtes, soldes)", "Catalogue WhatsApp synchronisé"]) expect(labels).toContain(l);
    expect(new Set(labels).size).toBe(labels.length);
    const api = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === "API REST")!;
    expect(api.values).toEqual({ FREE: false, STARTER: false, BUSINESS: "Lecture", SCALE: "Complète", ENTERPRISE: "Complète" });
  });
});
