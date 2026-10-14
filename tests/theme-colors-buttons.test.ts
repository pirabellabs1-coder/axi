/* eslint-disable @typescript-eslint/no-explicit-any -- documents bruts volontairement non typés */
import { describe, it, expect } from "vitest";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { schemeVars, themeCssVars, sanitizeGlobalSettings } from "@/lib/storefront/theme-doc";
import type { GlobalSettings } from "@/lib/theme-engine/types";

/** Réglages de base avec un schéma personnalisé minimal (sans rôle avancé). */
function baseSettings(scheme: Partial<GlobalSettings["colors"]["schemes"][number]> = {}): GlobalSettings {
  const s = defaultThemeDocument("general").settings;
  s.colors.schemes = [{ id: "marque", name: "Marque", background: "#102030", text: "#ffffff", primary: "#ff5500", primaryText: "#ffffff", ...scheme }];
  return s;
}

describe("schemeVars — rôles avancés", () => {
  it("dérive surface/line/link quand les rôles avancés sont absents", () => {
    const vars = schemeVars(baseSettings(), "marque")!;
    expect(vars["--c-surface"]).toContain("color-mix");
    expect(vars["--c-line"]).toContain("color-mix");
    // lien = couleur du texte par défaut
    expect(vars["--c-link"]).toBe("#ffffff");
    // pas de bouton secondaire → aucune variable de surcharge
    expect(vars["--store-secondary"]).toBeUndefined();
    expect(vars["--store-secondary-ring"]).toBeUndefined();
  });

  it("émet les variables de surcharge quand les rôles avancés sont fournis", () => {
    const vars = schemeVars(
      baseSettings({ surface: "#1b2a3a", border: "#2f4a66", link: "#9ad1ff", secondaryButton: "#ffcc00", secondaryButtonText: "#101010" }),
      "marque",
    )!;
    expect(vars["--c-surface"]).toBe("#1b2a3a");
    expect(vars["--c-line"]).toBe("#2f4a66");
    expect(vars["--c-link"]).toBe("#9ad1ff");
    expect(vars["--store-secondary"]).toBe("#ffcc00");
    expect(vars["--store-secondary-contrast"]).toBe("#101010");
    expect(vars["--store-secondary-ring"]).toBe("none");
  });

  it("schémas intégrés restent inchangés (null pour default)", () => {
    expect(schemeVars(baseSettings(), "default")).toBeNull();
    const surf = schemeVars(baseSettings(), "surface")!;
    expect(surf["--c-link"]).toBeDefined();
    expect(surf["--store-secondary"]).toBeUndefined();
  });
});

describe("themeCssVars — gabarit et contour des boutons", () => {
  it("émet la hauteur/padding selon la taille et l'épaisseur de contour", () => {
    const s = defaultThemeDocument("general").settings;
    s.buttons.size = "large";
    s.buttons.borderWidth = 3;
    const vars = themeCssVars(s) as Record<string, string>;
    expect(vars["--store-btn-h"]).toBe("56px");
    expect(vars["--store-btn-px"]).toBe("32px");
    expect(vars["--store-btn-border"]).toBe("3px");
  });

  it("taille compacte", () => {
    const s = defaultThemeDocument("general").settings;
    s.buttons.size = "compact";
    const vars = themeCssVars(s) as Record<string, string>;
    expect(vars["--store-btn-h"]).toBe("40px");
  });
});

describe("validate — rétro-compatibilité des nouveaux réglages", () => {
  it("accepte un schéma avec rôles avancés", () => {
    const doc: any = defaultThemeDocument("general");
    doc.settings.colors.schemes = [
      { id: "marque", name: "Marque", background: "#102030", text: "#ffffff", primary: "#ff5500", primaryText: "#ffffff", surface: "#1b2a3a", border: "#2f4a66", link: "#9ad1ff", secondaryButton: "#ffcc00", secondaryButtonText: "#101010" },
    ];
    const v = validateThemeDocument(doc);
    expect(v.ok, JSON.stringify(!v.ok && v.errors.slice(0, 3))).toBe(true);
  });

  it("accepte un schéma sans rôle avancé", () => {
    const doc: any = defaultThemeDocument("general");
    doc.settings.colors.schemes = [{ id: "marque", name: "Marque", background: "#102030", text: "#ffffff", primary: "#ff5500", primaryText: "#ffffff" }];
    expect(validateThemeDocument(doc).ok).toBe(true);
  });

  it("valide borderWidth et size, et complète les documents antérieurs", () => {
    const doc: any = defaultThemeDocument("general");
    doc.settings.buttons = { radius: 10, style: "outline", shadow: false, borderWidth: 2, size: "compact" };
    const v = validateThemeDocument(doc);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect((v.doc.settings.buttons as any).borderWidth).toBe(2);
      expect((v.doc.settings.buttons as any).size).toBe("compact");
    }
    // Document antérieur sans borderWidth/size → complété par défaut
    const legacy: any = defaultThemeDocument("general");
    legacy.settings.buttons = { radius: 10, style: "solid", shadow: true };
    const v2 = validateThemeDocument(legacy);
    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect((v2.doc.settings.buttons as any).borderWidth).toBe(1);
      expect((v2.doc.settings.buttons as any).size).toBe("normal");
    }
  });

  it("rejette une épaisseur de contour hors bornes", () => {
    const doc: any = defaultThemeDocument("general");
    doc.settings.buttons = { radius: 10, style: "solid", shadow: false, borderWidth: 9, size: "normal" };
    expect(validateThemeDocument(doc).ok).toBe(false);
  });
});

describe("sanitize — tolère les valeurs invalides des rôles avancés", () => {
  it("ignore un rôle avancé non hexadécimal (→ dérivation)", () => {
    const fb = defaultThemeDocument("general").settings;
    const raw: any = { ...fb, colors: { ...fb.colors, schemes: [{ id: "marque", name: "Marque", background: "#102030", text: "#ffffff", primary: "#ff5500", primaryText: "#ffffff", surface: "pas-une-couleur", link: "#9ad1ff" }] } };
    const out = sanitizeGlobalSettings(raw, fb);
    const scheme = out.colors.schemes[0] as any;
    expect(scheme.surface).toBeUndefined();
    expect(scheme.link).toBe("#9ad1ff");
  });
});
