import { describe, it, expect } from "vitest";
import { resolveTheme, contrastText, themeCssVars, getPreset, presetForSector, storefrontPreset, THEME_PRESETS, SECTOR_PRESETS, ALL_SECTIONS } from "@/lib/storefront/theme";

describe("resolveTheme", () => {
  it("retourne le preset quand la config est vide", () => {
    expect(resolveTheme("restaurant", null)).toEqual(getPreset("restaurant").config);
    expect(resolveTheme("restaurant", "nope")).toEqual(getPreset("restaurant").config);
  });
  it("retombe sur le premier preset pour un id inconnu", () => {
    expect(resolveTheme("inconnu", null)).toEqual(THEME_PRESETS[0].config);
  });
  it("accepte une couleur hex valide et ignore une invalide", () => {
    const base = getPreset("market").config;
    expect(resolveTheme("market", { primary: "#123456" }).primary).toBe("#123456");
    expect(resolveTheme("market", { primary: "#ABCDEF" }).primary).toBe("#ABCDEF");
    expect(resolveTheme("market", { primary: "red" }).primary).toBe(base.primary);
    expect(resolveTheme("market", { primary: "#12345" }).primary).toBe(base.primary);
    expect(resolveTheme("market", { primary: "#1234567" }).primary).toBe(base.primary);
    expect(resolveTheme("market", { accent: "javascript:alert(1)" }).accent).toBe(base.accent);
    expect(resolveTheme("market", { accent: 42 }).accent).toBe(base.accent);
  });
  it("filtre les sections inconnues, garde l'ordre, retombe sur le preset si vide", () => {
    const base = getPreset("market").config;
    expect(resolveTheme("market", { sections: ["contact", "hero", "evil"] }).sections).toEqual(["contact", "hero"]);
    expect(resolveTheme("market", { sections: [] }).sections).toEqual(base.sections);
    expect(resolveTheme("market", { sections: "hero" }).sections).toEqual(base.sections);
  });
  it("conserve les autres champs surchargés", () => {
    const t = resolveTheme("fashion", { layout: "list", announcement: "Soldes" });
    expect(t.layout).toBe("list");
    expect(t.announcement).toBe("Soldes");
    expect(t.font).toBe("serif");
  });
  it("ALL_SECTIONS couvre toutes les sections des presets", () => {
    for (const p of THEME_PRESETS) for (const s of p.config.sections) expect(ALL_SECTIONS).toContain(s);
  });
});

describe("contrastText", () => {
  it("texte blanc sur fonds sombres", () => {
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#0F6E56")).toBe("#ffffff");
    expect(contrastText("#9A3412")).toBe("#ffffff");
  });
  it("texte noir sur fonds clairs", () => {
    expect(contrastText("#ffffff")).toBe("#14201b");
    expect(contrastText("#F5B82E")).toBe("#14201b");
    expect(contrastText("#e3f2eb")).toBe("#14201b");
  });
});

describe("themeCssVars", () => {
  it("produit les variables CSS attendues", () => {
    const vars = themeCssVars(getPreset("restaurant").config);
    expect(vars["--store-primary"]).toBe("#9A3412");
    expect(vars["--store-primary-contrast"]).toBe("#ffffff");
    // V4 : le modèle restaurant a des angles « soft »
    expect(vars["--store-radius"]).toBe("14px");
    expect(vars["--store-primary-soft"]).toMatch(/^rgba\(154, 52, 18, 0\.08\)$/);
  });
  it("traduit chaque rayon en valeur CSS", () => {
    const base = getPreset("general").config;
    expect(themeCssVars({ ...base, radius: "sharp" })["--store-radius"]).toBe("6px");
    expect(themeCssVars({ ...base, radius: "soft" })["--store-radius"]).toBe("14px");
    expect(themeCssVars({ ...base, radius: "round" })["--store-radius"]).toBe("999px");
  });
});

describe("modèles par secteur (V4)", () => {
  it("expose un modèle par secteur, avec l'id du secteur comme id de preset", () => {
    expect(SECTOR_PRESETS.map((p) => p.id).sort()).toEqual(["beaute", "clinique", "general", "mode", "patisserie", "restaurant", "salon"]);
    for (const p of SECTOR_PRESETS) expect(p.sector).toBe(p.id);
  });
  it("résout un secteur, ses synonymes et retombe sur general", () => {
    expect(presetForSector("patisserie").id).toBe("patisserie");
    expect(presetForSector("fashion").id).toBe("mode");
    expect(presetForSector("santé").id).toBe("clinique");
    expect(presetForSector("inconnu").id).toBe("general");
    expect(presetForSector(null).id).toBe("general");
  });
  it("une boutique general hérite du secteur de son thème", () => {
    expect(storefrontPreset("general", "restaurant").sector).toBe("restaurant");
    expect(storefrontPreset("salon", "restaurant").sector).toBe("salon");
  });
});
