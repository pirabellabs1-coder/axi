import { describe, it, expect } from "vitest";
import { fallbackThemeDocument } from "@/lib/theme-engine/editor-defaults";
import * as ops from "@/lib/theme-engine/operations";
import { scoreTheme } from "@/lib/theme-engine/quality";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { createHistory, pushHistory, undo } from "@/lib/theme-engine/editor-history";
import type { SectionVisibility, ThemeDocument } from "@/lib/theme-engine/types";
import { canCreateAlternate, checkSuffix, normalizeTarget, parseTargetValue, projectTarget, suffixFromName, targetKey } from "@/components/theme-editor/editor-target";
import { previewDocument, simulateVisibility, toAudienceContext, type SimulatedAudience } from "@/components/theme-editor/preview-doc";
import { actionHref, applyIssueFix, issueDestination, overallScore, scoreBand } from "@/components/theme-editor/quality-fix";
import { disallowedAudienceRules, editorLot4Rules, lot4PlanIssue } from "@/lib/theme/editor-plan";

const base = () => fallbackThemeDocument();
const withLuxe = (d: ThemeDocument = base()) => ops.duplicateAlternate(d, "product", null, "luxe").doc;
const firstNonRequired = (d: ThemeDocument, tid: "home" | "product" = "home") =>
  d.templates[tid].order.map((id) => d.templates[tid].sections[id]).find((s) => !["main-product", "main-collection", "main-page", "main-cart"].includes(s.type))!;

const audience = (patch: Partial<SimulatedAudience> = {}): SimulatedAudience => ({
  customer: "anonymous",
  source: "direct",
  city: "",
  device: "mobile",
  locale: "fr",
  day: 1,
  time: "10:00",
  ...patch,
});

describe("cible d'édition (modèles alternatifs)", () => {
  it("clé de modèle, analyse de la valeur du sélecteur et vue du document", () => {
    const d = withLuxe();
    expect(targetKey({ template: "product", alternate: null })).toBe("product");
    expect(targetKey({ template: "product", alternate: "luxe" })).toBe("product:luxe");
    expect(targetKey({ template: "home", alternate: "luxe" })).toBe("home");
    expect(parseTargetValue("product:luxe")).toEqual({ template: "product", alternate: "luxe" });
    expect(parseTargetValue("home")).toEqual({ template: "home", alternate: null });
    const view = projectTarget(d, { template: "product", alternate: "luxe" });
    expect(view.templates.product).toBe(d.alternates!.product!.luxe);
    expect(view.templates.home).toBe(d.templates.home);
    expect(projectTarget(d, { template: "product", alternate: null })).toBe(d);
  });

  it("retombe sur le modèle par défaut quand l'alternatif a disparu (annuler)", () => {
    const d = base();
    expect(normalizeTarget(d, { template: "product", alternate: "luxe" })).toEqual({ template: "product", alternate: null });
    expect(normalizeTarget(withLuxe(), { template: "product", alternate: "luxe" }).alternate).toBe("luxe");
  });

  it("les opérations par clé modifient l'alternatif sans toucher au défaut", () => {
    const d = withLuxe();
    const sid = d.alternates!.product!.luxe.order.find((id) => d.alternates!.product!.luxe.sections[id].type !== "main-product")!;
    const next = ops.setSectionHidden(d, "product:luxe", sid, true);
    expect(next.alternates!.product!.luxe.sections[sid].disabled).toBe(true);
    expect(next.templates.product).toBe(d.templates.product);
    expect(validateThemeDocument(next).ok).toBe(true);
  });

  it("noms de modèle : normalisation, doublons, limites du plan", () => {
    const d = withLuxe();
    expect(suffixFromName("Luxe Été 2026")).toBe("luxe-ete-2026");
    expect(suffixFromName("!!!")).toBe("");
    expect(checkSuffix(d, "product", "luxe")).toMatch(/déjà/);
    expect(checkSuffix(d, "product", "")).toMatch(/nom/i);
    expect(checkSuffix(d, "product", "soldes")).toBeNull();
    expect(canCreateAlternate(d, "product", { perType: 0 }).ok).toBe(false);
    expect(canCreateAlternate(d, "product", { perType: 1 }).ok).toBe(false);
    expect(canCreateAlternate(d, "product", { perType: 5 }).ok).toBe(true);
    expect(canCreateAlternate(d, "collection", { perType: 1 }).ok).toBe(true);
  });
});

describe("règles de plan lot 4 (serveur)", () => {
  it("dérive les droits du plan", () => {
    expect(editorLot4Rules("FREE").alternatesPerType).toBe(0);
    expect(editorLot4Rules("BUSINESS").alternatesPerType).toBe(5);
    expect(editorLot4Rules("BUSINESS").audienceRules).toEqual(["customer"]);
    expect(editorLot4Rules("SCALE").audienceRules.length).toBe(6);
    expect(editorLot4Rules("STARTER").savedSections).toBe(20);
    expect(editorLot4Rules("FREE").qualityScores).toBe(true);
  });

  it("refuse un modèle alternatif au-delà du plan, mais conserve l'existant après rétrogradation", () => {
    const d = withLuxe();
    expect(lot4PlanIssue("FREE", d, [base()])).toMatch(/Business/);
    expect(lot4PlanIssue("BUSINESS", d, [base()])).toBeNull();
    // Plan rétrogradé : le document enregistré contenait déjà « luxe ».
    expect(lot4PlanIssue("FREE", d, [d])).toBeNull();
    const two = ops.duplicateAlternate(d, "product", null, "promo").doc;
    expect(lot4PlanIssue("FREE", two, [d])).toMatch(/Business/);
  });

  it("refuse une règle d'audience non incluse dans le plan", () => {
    const d = base();
    const s = firstNonRequired(d);
    const vis: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "city", values: ["Cotonou"] }] };
    const next = ops.setSectionVisibility(d, "home", s.id, vis);
    expect(disallowedAudienceRules(next, ["customer"])).toBe(1);
    expect(lot4PlanIssue("BUSINESS", next, [d])).toMatch(/audience/);
    expect(lot4PlanIssue("SCALE", next, [d])).toBeNull();
    const customer = ops.setSectionVisibility(d, "home", s.id, { match: "all", mode: "show", rules: [{ type: "customer", values: ["loyal"] }] });
    expect(lot4PlanIssue("BUSINESS", customer, [d])).toBeNull();
    expect(lot4PlanIssue("STARTER", customer, [d])).toMatch(/audience/);
  });
});

describe("aperçu : audience simulée et animations réduites", () => {
  const loyalOnly: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "customer", values: ["loyal"] }] };

  it("évalue les règles avec le moteur (audience.ts)", () => {
    expect(simulateVisibility(undefined, audience())).toBe(true);
    expect(simulateVisibility(loyalOnly, audience())).toBe(false);
    expect(simulateVisibility(loyalOnly, audience({ customer: "loyal" }))).toBe(true);
    const city: SectionVisibility = { match: "any", mode: "hide", rules: [{ type: "city", values: ["Porto-Novo"] }] };
    expect(simulateVisibility(city, audience({ city: "porto novo" }))).toBe(false);
    expect(simulateVisibility(city, audience({ city: "Cotonou" }))).toBe(true);
    const evening: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "schedule", days: [5], from: "18:00", to: "23:00" }] };
    expect(simulateVisibility(evening, audience({ day: 5, time: "19:30" }))).toBe(true);
    expect(simulateVisibility(evening, audience({ day: 5, time: "09:00" }))).toBe(false);
    expect(simulateVisibility(evening, audience({ day: 4, time: "19:30" }))).toBe(false);
  });

  it("un client fidèle est aussi un client ayant déjà commandé", () => {
    expect(toAudienceContext(audience({ customer: "loyal" })).customer).toEqual(["returning", "loyal"]);
    expect(toAudienceContext(audience()).customer).toEqual(["anonymous"]);
  });

  it("masque les sections hors audience et retire les règles du document d'aperçu", () => {
    const d = base();
    const s = firstNonRequired(d);
    const doc = ops.setSectionVisibility(d, "home", s.id, loyalOnly);
    const none = previewDocument(doc, { reduceMotion: false, audience: null });
    expect(none.templates.home.sections[s.id].disabled).toBeUndefined();
    expect(none.templates.home.sections[s.id].visibility).toBeUndefined();
    const anon = previewDocument(doc, { reduceMotion: false, audience: audience() });
    expect(anon.templates.home.sections[s.id].disabled).toBe(true);
    const loyal = previewDocument(doc, { reduceMotion: false, audience: audience({ customer: "loyal" }) });
    expect(loyal.templates.home.sections[s.id].disabled).toBeUndefined();
    // Le document édité n'est jamais modifié.
    expect(doc.templates.home.sections[s.id].visibility).toEqual(loyalOnly);
  });

  it("« Réduire les animations » coupe toutes les animations de l'aperçu", () => {
    const d = ops.setSectionAnimation(base(), "home", firstNonRequired(base()).id, "zoom-in");
    const out = previewDocument(d, { reduceMotion: true, audience: null });
    expect(out.settings.motion).toEqual({ preset: "none", reveal: false, parallax: false, hoverZoom: false });
    expect(Object.values(out.templates.home.sections).every((s) => s.animation === "none")).toBe(true);
    expect(previewDocument(base(), { reduceMotion: false, audience: null })).toEqual(base());
  });
});

describe("panneau Qualité", () => {
  it("bandes de score et score global", () => {
    expect(scoreBand(95).label).toBe("Bon");
    expect(scoreBand(70).tone).toBe("medium");
    expect(scoreBand(10).tone).toBe("low");
    expect(overallScore({ accessibility: 100, performance: 80, seo: 60, conversion: 41 })).toBe(70);
  });

  it("une correction en un clic est une seule entrée d'historique, annulable, et fait disparaître le problème", () => {
    const d = base();
    const bad: ThemeDocument = { ...d, settings: { ...d.settings, colors: { ...d.settings.colors, text: "#cfcfcf", background: "#ffffff" } } };
    const report = scoreTheme(bad, {});
    const issue = report.issues.find((i) => Array.isArray(i.fix) && i.category === "accessibility");
    expect(issue).toBeDefined();
    const r = applyIssueFix(bad, issue!);
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    const after = scoreTheme(r.doc, {});
    expect(after.issues.some((i) => i.id === issue!.id)).toBe(false);
    expect(after.scores.accessibility).toBeGreaterThan(report.scores.accessibility);
    let h = createHistory(bad);
    h = pushHistory(h, r.doc);
    expect(h.past.length).toBe(1);
    expect(undo(h).present).toBe(bad);
  });

  it("destination d'un problème et liens des corrections hors document", () => {
    expect(issueDestination({ id: "x", rule: "r", category: "seo", severity: "tip", message: "m", target: { template: "product:luxe", sectionId: "s1" } })).toEqual({
      template: "product",
      alternate: "luxe",
      selection: { kind: "section", id: "s1" },
    });
    expect(issueDestination({ id: "x", rule: "r", category: "seo", severity: "tip", message: "m", target: { global: "header.announcement.text" } })?.selection).toEqual({ kind: "global", group: "header" });
    expect(issueDestination({ id: "x", rule: "r", category: "seo", severity: "tip", message: "m" })).toBeNull();
    expect(actionHref({ id: "x", rule: "r", category: "seo", severity: "tip", message: "m", fix: { action: "open_product", productId: "p1" } }, "st")).toBe("/app/st/produits/p1");
    expect(actionHref({ id: "x", rule: "r", category: "seo", severity: "tip", message: "m", fix: { action: "ai_seo", target: "store_description" } }, "st")).toBe("/app/st/parametres");
    expect(actionHref({ id: "x", rule: "r", category: "seo", severity: "tip", message: "m", fix: { action: "compress_image", url: "https://x" } }, "st")).toBeNull();
  });
});
