/**
 * En-tête transparent sur la bannière : `headerOverlaysHero` est une fonction PURE (réglages + modèle → booléen).
 * On vérifie : OFF (défaut) → jamais transparent ; ON + 1re section bannière éligible → transparent ;
 * ON + 1re section non éligible → faux ; ainsi que le défaut `false` du nouveau champ dans `validate`.
 */
import { describe, expect, it } from "vitest";
import { buildSection, defaultGlobalSettings } from "@/lib/theme-engine/defaults";
import { firstBodySection, headerOverlaysHero, isDarkScheme, isOverlayEligibleBanner } from "@/lib/theme-engine/header-overlay";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import type { GlobalSettings, Template } from "@/lib/theme-engine/types";

const IMG = { url: "https://cdn.example.com/banner.jpg", alt: "" };

function settings(on: boolean): GlobalSettings {
  const s = defaultGlobalSettings("general");
  s.header.transparentOverHero = on;
  return s;
}

function tpl(...sections: ReturnType<typeof buildSection>[]): Template {
  return { order: sections.map((x) => x.id), sections: Object.fromEntries(sections.map((x) => [x.id, x])) };
}

describe("headerOverlaysHero", () => {
  const heroImage = buildSection("hero", "hero-banner", { image: IMG, layout: "overlay" });
  const richText = buildSection("rt", "rich-text", {});

  it("OFF par défaut : jamais transparent, même avec une bannière éligible en tête", () => {
    expect(headerOverlaysHero(settings(false), tpl(heroImage))).toBe(false);
  });

  it("ON + 1re section bannière image plein cadre → transparent", () => {
    expect(headerOverlaysHero(settings(true), tpl(heroImage))).toBe(true);
  });

  it("ON + 1re section non bannière (texte) → faux", () => {
    expect(headerOverlaysHero(settings(true), tpl(richText, heroImage))).toBe(false);
  });

  it("ON mais hero sans image ni schéma sombre → faux", () => {
    const heroPlain = buildSection("hero", "hero-banner", { image: null, scheme: "default", layout: "overlay" });
    expect(headerOverlaysHero(settings(true), tpl(heroPlain))).toBe(false);
  });

  it("ON + hero schéma sombre (inverse) sans image → transparent", () => {
    const heroDark = buildSection("hero", "hero-banner", { image: null, scheme: "inverse", layout: "split" });
    expect(headerOverlaysHero(settings(true), tpl(heroDark))).toBe(true);
  });

  it("ON + hero image mais disposition « split » sans schéma sombre → faux (média sur une moitié)", () => {
    const heroSplit = buildSection("hero", "hero-banner", { image: IMG, layout: "split", scheme: "default" });
    expect(headerOverlaysHero(settings(true), tpl(heroSplit))).toBe(false);
  });

  it("ON + diaporama avec image → transparent ; sans image → faux", () => {
    const slideImg = buildSection("sl", "slideshow", {}, [{ type: "slide", settings: { image: IMG } }]);
    const slideNoImg = buildSection("sl", "slideshow", {}, [{ type: "slide", settings: { image: null } }]);
    expect(headerOverlaysHero(settings(true), tpl(slideImg))).toBe(true);
    expect(headerOverlaysHero(settings(true), tpl(slideNoImg))).toBe(false);
  });

  it("1re section désactivée ignorée : on regarde la 1re section rendue", () => {
    const disabled = { ...heroImage, disabled: true };
    expect(headerOverlaysHero(settings(true), tpl(disabled, richText))).toBe(false);
  });

  it("isDarkScheme : inverse/brand sombres ou non selon la palette, default/surface jamais sombres", () => {
    const s = settings(true);
    expect(isDarkScheme(s, "default")).toBe(false);
    expect(isDarkScheme(s, "surface")).toBe(false);
    expect(isDarkScheme(s, "inverse")).toBe(true); // fond = couleur du texte (sombre) sur « general »
  });

  it("firstBodySection : null si modèle absent", () => {
    expect(firstBodySection(null)).toBeNull();
    expect(firstBodySection(tpl(heroImage))?.id).toBe("hero");
  });

  it("isOverlayEligibleBanner : type non bannière → faux", () => {
    expect(isOverlayEligibleBanner(richText, settings(true))).toBe(false);
  });
});

describe("validate : header.transparentOverHero", () => {
  it("absent d'un document antérieur → complété à false (rendu inchangé)", () => {
    const doc = defaultThemeDocument("general");
    delete (doc.settings.header as Partial<GlobalSettings["header"]>).transparentOverHero;
    const res = validateThemeDocument(doc);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.doc.settings.header.transparentOverHero).toBe(false);
  });

  it("valeur true conservée", () => {
    const doc = defaultThemeDocument("general");
    doc.settings.header.transparentOverHero = true;
    const res = validateThemeDocument(doc);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.doc.settings.header.transparentOverHero).toBe(true);
  });
});
