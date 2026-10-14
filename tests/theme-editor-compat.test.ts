import { describe, it, expect } from "vitest";
import { defaultThemeDocument, migrateLegacyTheme, SECTORS } from "@/lib/theme-engine/defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";

describe("compatibilité éditeur ↔ documents du moteur de rendu", () => {
  it.each(SECTORS)("le document par défaut « %s » passe la validation de l'éditeur", (sector) => {
    const v = validateThemeDocument(defaultThemeDocument(sector, { name: "Chez Aïcha", tagline: "Saveurs du Bénin" }));
    if (!v.ok) console.log(sector, v.errors.slice(0, 5));
    expect(v.ok).toBe(true);
  });
  it("la migration de l'ancien thème passe la validation", () => {
    const v = validateThemeDocument(migrateLegacyTheme({ sector: "restaurant", themeId: "restaurant", themeConfig: { announcement: "Promo", faq: [{ q: "Q ?", a: "R" }], testimonials: [{ name: "Awa", text: "Top" }] }, name: "Chez Aïcha" }));
    if (!v.ok) console.log(v.errors.slice(0, 5));
    expect(v.ok).toBe(true);
  });
});
