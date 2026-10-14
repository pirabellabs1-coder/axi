/**
 * Régression (recette E2E) : chaque composition de la bibliothèque du seed doit s'insérer et se sauvegarder
 * sans rejet du validateur de document. En particulier, un bloc dont le réglage `url` est vide (`link: ""`)
 * est un cas légitime (bloc sans lien) et NE DOIT PAS invalider la section.
 */
import { describe, expect, it } from "vitest";
import { DEMO_LIBRARY_ITEMS } from "@/lib/section-library/demo-items";
import { validateLibraryPayload } from "@/lib/section-library/rules";
import { validateSectionPayload } from "@/lib/saved-sections/payload";
import { fieldSchema, validateThemeDocument } from "@/lib/theme-engine/validate";
import { insertSavedSection } from "@/lib/theme-engine/operations";
import { fallbackThemeDocument } from "@/lib/theme-engine/editor-defaults";
import { compatibleTemplates } from "@/lib/saved-sections/payload";
import type { SectionType } from "@/lib/theme-engine/types";

describe("bibliothèque de sections — charges du seed valides", () => {
  it("toutes les compositions du seed passent le validateur de bibliothèque", () => {
    for (const item of DEMO_LIBRARY_ITEMS) {
      const r = validateLibraryPayload(item.payload);
      expect(r.ok, `${item.slug} : ${r.ok ? "" : r.errors.join(" / ")}`).toBe(true);
    }
  });

  it("toutes les compositions du seed passent le validateur de document (insertion dans l'éditeur)", () => {
    for (const item of DEMO_LIBRARY_ITEMS) {
      const r = validateSectionPayload(item.payload);
      expect(r.ok, `${item.slug} : ${r.ok ? "" : r.errors.join(" / ")}`).toBe(true);
    }
  });

  it("le « Lookbook en mosaïque » (image-gallery) avec un bloc sans lien (link vide) est accepté", () => {
    const lookbook = DEMO_LIBRARY_ITEMS.find((i) => i.slug === "lookbook-galerie-mosaique");
    expect(lookbook).toBeDefined();
    const blocks = (lookbook!.payload as { blocks: { settings: { link?: string } }[] }).blocks;
    // Le seed contient bien au moins un bloc image avec un lien vide — le cas de fond à couvrir.
    expect(blocks.some((b) => b.settings.link === "")).toBe(true);
    const r = validateSectionPayload(lookbook!.payload);
    expect(r.ok, r.ok ? "" : r.errors.join(" / ")).toBe(true);
  });

  it("le réglage de type `url` accepte une valeur vide, nulle ou un lien valide, et refuse un lien dangereux", () => {
    const s = fieldSchema({ type: "url", id: "link", label: "Lien" });
    expect(s).not.toBeNull();
    expect(s!.safeParse("").success).toBe(true); // lien vide = bloc sans lien (légitime)
    expect(s!.safeParse(null).success).toBe(true); // forme canonique du sanitiseur pour un url vide
    expect(s!.safeParse("/catalogue").success).toBe(true); // chemin interne
    expect(s!.safeParse("https://exemple.africa").success).toBe(true); // https
    expect(s!.safeParse("javascript:alert(1)").success).toBe(false); // jamais toléré
  });

  it("le réglage de type `video` accepte une valeur nulle (forme canonique du sanitiseur)", () => {
    const s = fieldSchema({ type: "video", id: "video", label: "Vidéo" });
    expect(s!.safeParse(null).success).toBe(true);
    expect(s!.safeParse("").success).toBe(true);
  });

  it("insertion réelle (sanitiseur → validateur de document) : chaque composition du seed s'insère et valide", () => {
    for (const item of DEMO_LIBRARY_ITEMS) {
      const type = (item.payload as { type: SectionType }).type;
      const templates = compatibleTemplates(type);
      const template = templates.includes("home") ? "home" : templates[0];
      const doc = fallbackThemeDocument();
      // `insertSavedSection` passe par `sanitizeSection`, qui canonicalise un `url` vide en `null`.
      const r = insertSavedSection(doc, template, item.payload, {});
      const res = validateThemeDocument(r.doc);
      expect(res.ok, `${item.slug} : ${res.ok ? "" : res.errors.map((e) => `${e.path.join(".")}=${e.message}`).join(" / ")}`).toBe(true);
    }
  });
});
