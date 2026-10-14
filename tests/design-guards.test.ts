/**
 * Lot 4 §9 garde-fous : prix et promesses retirés des textes, sections hors liste blanche refusées,
 * faux témoignages et faux avis impossibles, contraste AA corrigé automatiquement.
 * §10 : liste blanche des opérations de l'assistant et nettoyage de leurs valeurs.
 */
import { describe, expect, it } from "vitest";
import { cleanCopy, colorsAreAccessible, ensureAccessibleColors, filterSections, hasForbiddenClaim } from "@/lib/ai/design/guards";
import { ALLOWED_HOME_SECTIONS, REVIEW_SECTIONS } from "@/lib/ai/design/schema";
import { applyAssistantOperations, ASSISTANT_OPERATIONS, MAX_ASSISTANT_OPERATIONS, parseAssistantResponse, sanitizeAssistantOperations } from "@/lib/ai/design/assistant";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { THEME_OPERATION_NAMES } from "@/lib/theme-engine/operations";
import { validateThemeDocument } from "@/lib/theme-engine/validate";

const section = (type: string) => ({ type, preset: 0, scheme: "default", copy: {}, image: null, collectionIndex: null, productIndexes: [] });

describe("textes : prix, promesses, délais, garanties, promotions", () => {
  it("retire une phrase qui annonce un prix", () => {
    expect(cleanCopy("Nos gâteaux sont faits maison. À partir de 5000 FCFA.", 600)).toBe("Nos gâteaux sont faits maison.");
  });

  it("retire les promesses de livraison et de garantie", () => {
    expect(cleanCopy("Livraison gratuite partout.", 200)).toBe("");
    expect(cleanCopy("Qualité garantie à vie.", 200)).toBe("");
    expect(cleanCopy("Promo -30% ce week-end.", 200)).toBe("");
    expect(cleanCopy("Livré en 24 h.", 200)).toBe("");
  });

  it("garde un texte descriptif, sans emoji ni tiret cadratin", () => {
    expect(cleanCopy("Pâtisserie fine 🎂 — ambiance chaleureuse.", 200)).toBe("Pâtisserie fine, ambiance chaleureuse.");
  });

  it("tronque au maximum du champ sans couper un mot", () => {
    const out = cleanCopy("Une boutique chaleureuse au coeur de Cotonou", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith(" ")).toBe(false);
  });

  it("hasForbiddenClaim repère une affirmation interdite", () => {
    expect(hasForbiddenClaim("Meilleur prix du marché")).toBe(true);
    expect(hasForbiddenClaim("Notre atelier est à Cotonou")).toBe(false);
  });

  it("ignore une valeur non textuelle", () => {
    expect(cleanCopy(42, 100)).toBe("");
    expect(cleanCopy(null, 100)).toBe("");
  });
});

describe("liste blanche des sections", () => {
  it("toutes les sections autorisées passent", () => {
    const r = filterSections(ALLOWED_HOME_SECTIONS.filter((t) => !REVIEW_SECTIONS.includes(t)).map(section), { hasReviews: false, maxSections: 20 });
    expect(r.removed).toHaveLength(0);
    expect(r.sections).toHaveLength(ALLOWED_HOME_SECTIONS.length - REVIEW_SECTIONS.length);
  });

  it("refuse une section inconnue ou interdite", () => {
    const r = filterSections([section("slideshow"), section("video"), section("main-product"), section("hero-banner")], { hasReviews: true });
    expect(r.sections.map((s) => s.type)).toEqual(["hero-banner"]);
    expect(r.removed).toHaveLength(3);
  });

  it("refuse témoignages et avis sans avis réels", () => {
    const r = filterSections([section("testimonials"), section("reviews")], { hasReviews: false });
    expect(r.sections).toHaveLength(0);
    expect(r.removed.every((x) => x.reason.includes("aucun avis réel"))).toBe(true);
  });

  it("autorise une seule section d'avis quand des avis existent", () => {
    const r = filterSections([section("reviews"), section("reviews")], { hasReviews: true });
    expect(r.sections).toHaveLength(1);
  });

  it("plafonne le nombre de sections", () => {
    const r = filterSections(Array.from({ length: 20 }, () => section("rich-text")), { hasReviews: false });
    expect(r.sections).toHaveLength(9);
  });
});

describe("contraste AA", () => {
  const doc = defaultThemeDocument("general", { name: "Test" });

  it("corrige une palette illisible et reste idempotente", () => {
    const broken = { ...doc.settings, colors: { ...doc.settings.colors, text: "#FAFAFA", muted: "#F0F0F0", primary: "#FEFEFE", accent: "#FFFFFE", background: "#FFFFFF" } };
    const fixed = ensureAccessibleColors(broken);
    expect(colorsAreAccessible(fixed)).toBe(true);
    expect(ensureAccessibleColors(fixed)).toEqual(fixed);
  });

  it("corrige aussi les schémas de section", () => {
    const broken = { ...doc.settings, colors: { ...doc.settings.colors, schemes: [{ id: "x", name: "X", background: "#FFFFFF", text: "#FFFFFF", primary: "#FFFFFF", primaryText: "#FFFFFF" }] } };
    expect(colorsAreAccessible(ensureAccessibleColors(broken))).toBe(true);
  });

  it("le préréglage livré est déjà conforme", () => {
    expect(colorsAreAccessible(ensureAccessibleColors(doc.settings))).toBe(true);
  });
});

describe("assistant de design : liste blanche et validation", () => {
  const doc = defaultThemeDocument("general", { name: "Test" });
  const firstId = doc.templates.home.order[0];

  it("la liste blanche est un sous-ensemble des opérations du moteur, sans modèle alternatif", () => {
    expect(ASSISTANT_OPERATIONS.every((op) => (THEME_OPERATION_NAMES as readonly string[]).includes(op))).toBe(true);
    expect(ASSISTANT_OPERATIONS).not.toContain("addAlternate");
    expect(ASSISTANT_OPERATIONS).not.toContain("insertSavedSection");
    expect(ASSISTANT_OPERATIONS).not.toContain("bindDynamicSource");
  });

  it("applique une opération valide et revalide le document", () => {
    const r = applyAssistantOperations(doc, [{ op: "updateGlobalSetting", path: "colors.primary", value: "#112233" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.settings.colors.primary).toBe("#112233");
      expect(validateThemeDocument(r.doc).ok).toBe(true);
    }
  });

  it("refuse une opération hors liste blanche (tout ou rien)", () => {
    const r = applyAssistantOperations(doc, [
      { op: "updateGlobalSetting", path: "colors.primary", value: "#112233" },
      { op: "addAlternate", type: "product", suffix: "luxe" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("refuse un chemin global inconnu", () => {
    expect(applyAssistantOperations(doc, [{ op: "updateGlobalSetting", path: "scripts.head", value: "<script>" }]).ok).toBe(false);
  });

  it("nettoie les textes des opérations et supprime celles qui deviennent vides", () => {
    const ops = sanitizeAssistantOperations([
      { op: "updateSectionSetting", template: "home", sectionId: firstId, key: "heading", value: "Promo -30% aujourd'hui" },
      { op: "updateSectionSetting", template: "home", sectionId: firstId, key: "heading", value: "Nos nouveautés 🎉" },
    ]);
    expect(ops).toHaveLength(1);
    expect((ops[0] as { value: string }).value).toBe("Nos nouveautés");
  });

  it("plafonne à 20 opérations", () => {
    const many = Array.from({ length: 40 }, () => ({ op: "moveSection", template: "home", sectionId: firstId, index: 0 }));
    expect(sanitizeAssistantOperations(many)).toHaveLength(MAX_ASSISTANT_OPERATIONS);
  });

  it("lit une réponse du modèle, même entourée de texte", () => {
    const r = parseAssistantResponse('Voici : ```json\n{"explanation":"Titre mis à jour.","operations":[{"op":"moveSection"}]}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.explanation).toBe("Titre mis à jour.");
      expect(r.data.operations).toHaveLength(1);
    }
  });

  it("refuse une réponse illisible ou incomplète", () => {
    expect(parseAssistantResponse("désolé, je ne peux pas").ok).toBe(false);
    expect(parseAssistantResponse('{"operations": "beaucoup"}').ok).toBe(false);
  });

  it("un refus du modèle ne produit aucune opération", () => {
    const r = parseAssistantResponse('{"explanation":"Je ne peux pas ajouter de script.","operations":[]}');
    expect(r.ok && r.data.operations).toHaveLength(0);
  });
});
