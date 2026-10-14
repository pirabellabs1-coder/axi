/* eslint-disable @typescript-eslint/no-explicit-any -- documents bruts volontairement non typés */
import { describe, it, expect } from "vitest";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { themeCssVars, sanitizeGlobalSettings } from "@/lib/storefront/theme-doc";

describe("themeCssVars — typographie approfondie", () => {
  it("émet les variables par défaut (rendu inchangé)", () => {
    const vars = themeCssVars(defaultThemeDocument("general").settings);
    expect(vars["--store-heading-tracking"]).toBe("0em");
    expect(vars["--store-heading-transform"]).toBe("none");
    expect(vars["--store-heading-variant"]).toBe("normal");
    expect(vars["--store-heading-leading"]).toBe("1.05");
    expect(vars["--store-body-leading"]).toBe("1.6");
    expect(vars["--store-body-scale"]).toBe("1");
  });

  it("reflète les réglages fins (interlettrage, casse, interlignes, échelle de corps)", () => {
    const s = defaultThemeDocument("general").settings;
    s.typography.headingTracking = 0.04;
    s.typography.headingTransform = "small-caps";
    s.typography.headingLineHeight = "normal";
    s.typography.bodyLeading = "relaxed";
    s.typography.bodyScale = 1.1;
    const vars = themeCssVars(s);
    expect(vars["--store-heading-tracking"]).toBe("0.04em");
    expect(vars["--store-heading-transform"]).toBe("none");
    expect(vars["--store-heading-variant"]).toBe("small-caps");
    expect(vars["--store-heading-leading"]).toBe("1.15");
    expect(vars["--store-body-leading"]).toBe("1.8");
    expect(vars["--store-body-scale"]).toBe("1.1");
  });

  it("MAJUSCULES : interlettrage automatique quand le réglage est nul", () => {
    const s = defaultThemeDocument("general").settings;
    s.typography.headingTransform = "uppercase";
    s.typography.headingTracking = 0;
    const vars = themeCssVars(s);
    expect(vars["--store-heading-transform"]).toBe("uppercase");
    expect(vars["--store-heading-tracking"]).toBe("0.02em");
  });

  it("MAJUSCULES : respecte un interlettrage explicite", () => {
    const s = defaultThemeDocument("general").settings;
    s.typography.headingTransform = "uppercase";
    s.typography.headingTracking = 0.05;
    expect(themeCssVars(s)["--store-heading-tracking"]).toBe("0.05em");
  });
});

describe("validation — typographie rétro-compatible", () => {
  it("accepte un typography complet", () => {
    const doc: any = defaultThemeDocument("general");
    doc.settings.typography = {
      heading: "geist",
      body: "geist",
      headingWeight: 600,
      scale: 1.1,
      uppercaseButtons: false,
      headingTracking: 0.03,
      headingTransform: "uppercase",
      bodyScale: 1.05,
      bodyLeading: "relaxed",
      headingLineHeight: "normal",
    };
    const res = validateThemeDocument(doc);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.doc.settings.typography.headingTracking).toBe(0.03);
      expect(res.doc.settings.typography.bodyScale).toBe(1.05);
      expect(res.doc.settings.typography.bodyLeading).toBe("relaxed");
    }
  });

  it("complète un document antérieur sans les nouveaux champs (bodyScale reprend scale)", () => {
    const doc: any = defaultThemeDocument("general");
    doc.settings.typography = { heading: "geist", body: "geist", headingWeight: 700, scale: 1.15, uppercaseButtons: false };
    const res = validateThemeDocument(doc);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const t = res.doc.settings.typography;
      expect(t.headingTracking).toBe(0);
      expect(t.headingTransform).toBe("none");
      expect(t.bodyLeading).toBe("normal");
      expect(t.headingLineHeight).toBe("tight");
      // bodyScale absent → reprend scale borné à 0.9–1.2
      expect(t.bodyScale).toBe(1.15);
    }
  });

  it("sanitize : document antérieur sans bodyScale → bodyScale = scale (borné)", () => {
    const fb = defaultThemeDocument("general").settings;
    const raw: any = { ...fb, typography: { heading: "geist", body: "geist", headingWeight: 700, scale: 1.25, uppercaseButtons: false } };
    const out = sanitizeGlobalSettings(raw, fb);
    expect(out.typography.bodyScale).toBe(1.2); // scale 1.25 borné à 1.2
    expect(out.typography.headingTransform).toBe("none");
    expect(out.typography.bodyLeading).toBe("normal");
  });

  it("sanitize : valeurs hors bornes ramenées dans l'intervalle", () => {
    const fb = defaultThemeDocument("general").settings;
    const raw: any = { ...fb, typography: { ...fb.typography, headingTracking: 5, bodyScale: 0.1, headingTransform: "bogus" } };
    const out = sanitizeGlobalSettings(raw, fb);
    expect(out.typography.headingTracking).toBe(0.1);
    expect(out.typography.bodyScale).toBe(0.9);
    expect(out.typography.headingTransform).toBe("none");
  });
});
