import { describe, it, expect } from "vitest";
import { evaluateConditions, capAllows, capWindowStart, dedupeKey, subjectKey, matchesSegment, type EvalContext } from "@/lib/automations/rules";
import { decodeConfig, encodeConfig, checkConfigForTrigger, isPromotional, configSchema, PRESETS, defaultConditions, triggerParam, type AutomationConfig } from "@/lib/automations/config";
import { renderTemplate, delayLabel, actionsFor, TRIGGERS, TRIGGER_META } from "@/lib/automations/templates";
import { activeAutomationLimit, triggerAllowed } from "@/lib/automations/limits";

const now = new Date("2026-10-10T10:00:00Z");
const DAY = 86_400_000;

function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    order: { total: 15000, fulfillmentType: "DELIVERY", currency: "XOF" },
    customer: { ordersCount: 1, createdAt: new Date(now.getTime() - 100 * DAY), lastOrderAt: new Date(now.getTime() - 2 * DAY), tags: ["VIP"] },
    marketingConsent: null,
    hasPhone: true,
    now,
    ...over,
  };
}

function cfg(over: Partial<AutomationConfig> = {}): AutomationConfig {
  return { v: 2, name: "Test", params: {}, conditions: defaultConditions(), actions: [{ type: "whatsapp", purpose: "transactional", message: "Bonjour {prenom}" }], cap: null, ...over };
}

describe("conditions", () => {
  it("passe sans condition pour un message transactionnel", () => {
    expect(evaluateConditions("order.created", cfg(), ctx())).toEqual({ ok: true });
  });

  it("montant minimum", () => {
    const c = cfg({ conditions: { ...defaultConditions(), minTotal: 20000 } });
    expect(evaluateConditions("order.created", c, ctx()).ok).toBe(false);
    expect(evaluateConditions("order.created", c, ctx({ order: { total: 20000, fulfillmentType: "DELIVERY", currency: "XOF" } })).ok).toBe(true);
    expect(evaluateConditions("order.created", c, ctx({ order: null })).ok).toBe(false);
  });

  it("mode de livraison, avec une raison lisible", () => {
    const c = cfg({ conditions: { ...defaultConditions(), fulfillment: "PICKUP" } });
    const r = evaluateConditions("order.ready", c, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Livraison");
  });

  it("segments", () => {
    expect(matchesSegment("loyal", null, ctx().customer, now)).toBe(false);
    expect(matchesSegment("loyal", null, { ...ctx().customer!, ordersCount: 3 }, now)).toBe(true);
    expect(matchesSegment("new", null, { ...ctx().customer!, createdAt: new Date(now.getTime() - 5 * DAY) }, now)).toBe(true);
    expect(matchesSegment("inactive", null, { ...ctx().customer!, lastOrderAt: new Date(now.getTime() - 61 * DAY) }, now)).toBe(true);
    expect(matchesSegment("tag", "vip", ctx().customer, now)).toBe(true);
    expect(matchesSegment("tag", "grossiste", ctx().customer, now)).toBe(false);
    expect(matchesSegment("loyal", null, null, now)).toBe(false);
  });

  it("consentement marketing obligatoire pour les déclencheurs promotionnels", () => {
    expect(evaluateConditions("cart.abandoned", cfg(), ctx()).ok).toBe(false);
    expect(evaluateConditions("cart.abandoned", cfg(), ctx({ marketingConsent: false })).ok).toBe(false);
    expect(evaluateConditions("cart.abandoned", cfg(), ctx({ marketingConsent: true })).ok).toBe(true);
    const withdrawn = evaluateConditions("customer.inactive", cfg(), ctx({ marketingConsent: false }));
    expect(withdrawn.ok === false && withdrawn.reason.includes("retiré")).toBe(true);
  });

  it("un coupon ou un message marqué promotionnel exige aussi le consentement", () => {
    const coupon = cfg({ actions: [{ type: "coupon", couponType: "PERCENT", value: 10, validDays: 7 }] });
    expect(isPromotional("order.delivered", coupon)).toBe(true);
    expect(evaluateConditions("order.delivered", coupon, ctx()).ok).toBe(false);
    const promo = cfg({ actions: [{ type: "whatsapp", purpose: "marketing", message: "Promo !" }] });
    expect(evaluateConditions("order.delivered", promo, ctx({ marketingConsent: true })).ok).toBe(true);
  });

  it("les alertes internes (stock bas) ne dépendent pas du client", () => {
    expect(evaluateConditions("product.low_stock", cfg({ conditions: { ...defaultConditions(), minTotal: 999999 } }), ctx({ order: null, customer: null })).ok).toBe(true);
  });
});

describe("plafond de fréquence", () => {
  it("sans plafond : toujours autorisé", () => {
    expect(capAllows(50, null)).toBe(true);
  });
  it("autorise jusqu'au maximum exclus", () => {
    const cap = { max: 2, days: 7 };
    expect(capAllows(0, cap)).toBe(true);
    expect(capAllows(1, cap)).toBe(true);
    expect(capAllows(2, cap)).toBe(false);
  });
  it("fenêtre glissante en jours", () => {
    expect(capWindowStart({ max: 1, days: 30 }, now).getTime()).toBe(now.getTime() - 30 * DAY);
  });
});

describe("anti-doublon", () => {
  it("une fois par commande et par déclencheur", () => {
    expect(dedupeKey("order.created", { orderId: "o1" })).toBe(dedupeKey("order.created", { orderId: "o1", customerId: "c9" }));
    expect(dedupeKey("order.created", { orderId: "o1" })).not.toBe(dedupeKey("order.ready", { orderId: "o1" }));
    expect(dedupeKey("order.created", { orderId: "o1" })).not.toBe(dedupeKey("order.created", { orderId: "o2" }));
  });
  it("une seule relance par panier", () => {
    expect(dedupeKey("cart.abandoned", { cartId: "k1", customerId: "a" })).toBe(dedupeKey("cart.abandoned", { cartId: "k1", customerId: "b" }));
  });
  it("une fois par période d'inactivité : une nouvelle commande ouvre une nouvelle période", () => {
    const a = dedupeKey("customer.inactive", { customerId: "c1", lastOrderAt: new Date("2026-07-01T00:00:00Z") });
    const b = dedupeKey("customer.inactive", { customerId: "c1", lastOrderAt: new Date("2026-07-01T00:00:00Z").toISOString() });
    const c = dedupeKey("customer.inactive", { customerId: "c1", lastOrderAt: new Date("2026-08-15T00:00:00Z") });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("stock bas : une alerte par produit (et variante) et par jour", () => {
    const d1 = dedupeKey("product.low_stock", { productId: "p1", now: new Date("2026-10-10T08:00:00Z") });
    const d1b = dedupeKey("product.low_stock", { productId: "p1", now: new Date("2026-10-10T20:00:00Z") });
    const d2 = dedupeKey("product.low_stock", { productId: "p1", now: new Date("2026-10-11T08:00:00Z") });
    expect(d1).toBe(d1b);
    expect(d1).not.toBe(d2);
    expect(dedupeKey("product.low_stock", { productId: "p1", variantId: "v1", now })).not.toBe(dedupeKey("product.low_stock", { productId: "p1", variantId: "v2", now }));
  });
  it("sujet du plafond : le téléphone du client, ou le produit", () => {
    expect(subjectKey("order.created", { phone: "22997000001" })).toBe("phone:22997000001");
    expect(subjectKey("product.low_stock", { productId: "p1", phone: "x" })).toBe("product:p1");
  });
});

describe("configuration", () => {
  it("relit une ancienne automatisation (texte brut) comme une action unique", () => {
    const c = decodeConfig("Bonjour {client}, merci !", { trigger: "order.created", channel: "whatsapp" });
    expect(c.actions).toEqual([{ type: "whatsapp", purpose: "transactional", message: "Bonjour {client}, merci !" }]);
    const e = decodeConfig("Votre commande {reference} est prête.", { trigger: "order.ready", channel: "email" });
    expect(e.actions[0].type).toBe("email");
  });
  it("aller-retour JSON", () => {
    const c = cfg({ cap: { max: 1, days: 7 } });
    expect(decodeConfig(encodeConfig(c), { trigger: "order.created", channel: "whatsapp" })).toEqual(c);
  });
  it("refuse les actions client sur un déclencheur interne", () => {
    expect(checkConfigForTrigger("product.low_stock", cfg())).toMatch(/notification interne/);
    expect(checkConfigForTrigger("product.low_stock", cfg({ actions: [{ type: "notify", message: "Stock bas {produit}" }] }))).toBeNull();
    expect(actionsFor("product.low_stock")).toEqual(["notify", "email"]);
  });
  it("valide les coupons", () => {
    expect(checkConfigForTrigger("customer.inactive", cfg({ actions: [{ type: "coupon", couponType: "PERCENT", value: 95, validDays: 7 }] }))).toMatch(/90 %/);
  });
  it("tous les modèles prêts sont valides pour leur déclencheur", () => {
    for (const p of PRESETS) {
      expect(configSchema.safeParse(p.config).success, p.key).toBe(true);
      expect(checkConfigForTrigger(p.trigger, p.config), p.key).toBeNull();
    }
  });
  it("paramètre du déclencheur borné, avec valeur par défaut", () => {
    expect(triggerParam("customer.inactive", { params: {} })).toBe(60);
    expect(triggerParam("customer.inactive", { params: { days: 5 } })).toBe(14);
    expect(triggerParam("order.created", { params: {} })).toBeNull();
  });
});

describe("gabarits et plans", () => {
  it("remplace les variables connues, vide les absentes", () => {
    expect(renderTemplate("Bonjour {Prenom}, code {coupon} {inconnu}", { prenom: "Aïcha" })).toBe("Bonjour Aïcha, code {inconnu}");
  });
  it("libellés de délai", () => {
    expect(delayLabel(0)).toBe("Immédiat");
    expect(delayLabel(60)).toBe("1 h après");
    expect(delayLabel(2880)).toBe("2 j après");
    expect(delayLabel(45)).toBe("45 min après");
  });
  it("limites du plan : 3 en Business, illimité en Scale, panier abandonné réservé à Scale", () => {
    expect(activeAutomationLimit("FREE")).toBe(0);
    expect(activeAutomationLimit("BUSINESS")).toBe(3);
    expect(activeAutomationLimit("SCALE")).toBeNull();
    expect(triggerAllowed("BUSINESS", "cart.abandoned")).toBe(false);
    expect(triggerAllowed("SCALE", "cart.abandoned")).toBe(true);
    expect(triggerAllowed("BUSINESS", "customer.inactive")).toBe(true);
  });
  it("chaque déclencheur a des métadonnées complètes", () => {
    for (const t of TRIGGERS) expect(TRIGGER_META[t].label.length).toBeGreaterThan(3);
  });
});
