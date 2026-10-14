/**
 * Largeur de section (helper `SECTION_WIDTH`) : `resolveSectionWidth` est une fonction pure (réglages → CSS).
 * On vérifie le repli par défaut (= largeur de page, rendu actuel), les trois largeurs de contenu et la pleine largeur.
 */
import { describe, expect, it } from "vitest";
import { resolveSectionWidth } from "@/lib/storefront/theme-doc";
import type { Settings } from "@/lib/theme-engine/types";

describe("resolveSectionWidth", () => {
  it("repli par défaut (réglages absents) = largeur de page, section non pleine largeur", () => {
    const w = resolveSectionWidth({});
    expect(w.full).toBe(false);
    expect(w.contentMax).toBe("var(--store-page-width)");
    expect(w.vars["--section-max"]).toBe("var(--store-page-width)");
  });

  it("content_width « standard » explicite = largeur de page (identique au défaut)", () => {
    expect(resolveSectionWidth({ section_width: "content", content_width: "standard" } as Settings).contentMax).toBe("var(--store-page-width)");
  });

  it("content_width « narrow » ≈ 720px", () => {
    expect(resolveSectionWidth({ content_width: "narrow" } as Settings).contentMax).toBe("720px");
  });

  it("content_width « wide » = largeur de page + 160px (bornée par la fenêtre côté CSS)", () => {
    expect(resolveSectionWidth({ content_width: "wide" } as Settings).contentMax).toBe("calc(var(--store-page-width) + 160px)");
  });

  it("section « full » : contenu à 100 %, content_width ignoré", () => {
    const w = resolveSectionWidth({ section_width: "full", content_width: "narrow" } as Settings);
    expect(w.full).toBe(true);
    expect(w.contentMax).toBe("100%");
    expect(w.vars["--section-max"]).toBe("100%");
  });

  it("valeur content_width inconnue → repli standard", () => {
    expect(resolveSectionWidth({ content_width: "xxl" } as Settings).contentMax).toBe("var(--store-page-width)");
  });
});
