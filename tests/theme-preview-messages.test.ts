import { describe, it, expect } from "vitest";
import { parseSectionClicked, resolveClickTarget, sectionClickedMessage, PREVIEW_MESSAGES } from "@/lib/theme-engine/preview-messages";

describe("aperçu de l'éditeur : message axi:section-clicked", () => {
  it("construit le message attendu par l'éditeur", () => {
    expect(sectionClickedMessage({ id: "hero_1", template: "home" })).toEqual({ type: "axi:section-clicked", id: "hero_1", template: "home" });
    expect(sectionClickedMessage({ group: "footer" })).toEqual({ type: "axi:section-clicked", group: "footer" });
    expect(PREVIEW_MESSAGES.sectionClicked).toBe("axi:section-clicked");
  });

  it("aller-retour : ce que l'aperçu envoie, l'éditeur le lit", () => {
    expect(parseSectionClicked(sectionClickedMessage({ id: "main-product", template: "product" }))).toEqual({ kind: "section", id: "main-product", template: "product" });
    expect(parseSectionClicked(sectionClickedMessage({ group: "header" }))).toEqual({ kind: "group", group: "header" });
  });

  it("modèle absent ou inconnu : section conservée, modèle ignoré", () => {
    expect(parseSectionClicked({ type: "axi:section-clicked", id: "faq_2" })).toEqual({ kind: "section", id: "faq_2", template: null });
    expect(parseSectionClicked({ type: "axi:section-clicked", id: "faq_2", template: "admin" })).toEqual({ kind: "section", id: "faq_2", template: null });
  });

  it("rejette les autres messages et les valeurs invalides", () => {
    for (const bad of [
      null,
      "axi:section-clicked",
      { type: "axi:section-click", id: "hero_1" }, // ancien nom
      { type: "axi:select-section", id: "hero_1" },
      { type: "axi:section-clicked" },
      { type: "axi:section-clicked", id: 42 },
      { type: "axi:section-clicked", id: "" },
      { type: "axi:section-clicked", id: "a\"]; body" },
      { type: "axi:section-clicked", id: "x".repeat(65) },
      { type: "axi:section-clicked", group: "settings" },
    ]) {
      expect(parseSectionClicked(bad)).toBeNull();
    }
  });
});

describe("aperçu de l'éditeur : cible d'un clic", () => {
  it("prend la section la plus proche, sinon l'en-tête ou le pied de page", () => {
    expect(resolveClickTarget([{ sectionId: "hero_1" }, { group: "header" }])).toEqual({ id: "hero_1" });
    expect(resolveClickTarget([{ sectionId: null, group: null }, { group: "footer" }])).toEqual({ group: "footer" });
  });

  it("aucune cible hors section (bandeau d'aperçu, panier…) ou valeur invalide", () => {
    expect(resolveClickTarget([])).toBeNull();
    expect(resolveClickTarget([{ sectionId: "bad id!" }, { group: "aside" }])).toBeNull();
  });
});

describe("aperçu : messages officiels du lot 4 (audience, options)", () => {
  it("noms de messages publiés", async () => {
    const { PREVIEW_MESSAGES: M } = await import("@/lib/theme-engine/preview-messages");
    expect(M.audience).toBe("axi:preview-audience");
    expect(M.options).toBe("axi:preview-options");
    // Les constantes locales de l'éditeur et du rendu pointent vers le nom officiel.
    expect((await import("@/components/theme-editor/preview-doc")).PREVIEW_AUDIENCE_MESSAGE).toBe(M.audience);
    expect((await import("@/components/storefront/preview-audience")).PREVIEW_AUDIENCE_MESSAGE).toBe(M.audience);
  });

  it("options : aller-retour, lecture défensive", async () => {
    const { parsePreviewOptions, previewOptionsMessage } = await import("@/lib/theme-engine/preview-messages");
    expect(parsePreviewOptions(previewOptionsMessage({ reduceMotion: true }))).toEqual({ reduceMotion: true });
    expect(parsePreviewOptions(previewOptionsMessage({ allowNavigation: false, reduceMotion: false }))).toEqual({ allowNavigation: false, reduceMotion: false });
    expect(parsePreviewOptions({ type: "axi:preview-options", reduceMotion: "oui", allowNavigation: 1 })).toEqual({});
    expect(parsePreviewOptions({ type: "axi:preview-audience", reduceMotion: true })).toBeNull();
    expect(parsePreviewOptions(null)).toBeNull();
  });
});
