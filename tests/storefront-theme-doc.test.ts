/* eslint-disable @typescript-eslint/no-explicit-any -- documents bruts volontairement non typés */
import { describe, it, expect } from "vitest";
import { defaultThemeDocument, migrateLegacyTheme, SECTORS } from "@/lib/theme-engine/defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { safeImageUrl, safeLink, sanitizeThemeDocument, schemeVars, themeCssVars, TEMPLATE_IDS } from "@/lib/storefront/theme-doc";

describe("defaultThemeDocument", () => {
  it.each(SECTORS)("secteur %s : document complet, sections connues, sections obligatoires présentes", (sector) => {
    const doc = defaultThemeDocument(sector, { name: "Chez Aïcha", tagline: "Pâtisserie maison", description: "Depuis 2015." });
    expect(doc.version).toBe(2);
    for (const t of TEMPLATE_IDS) {
      const tpl = doc.templates[t];
      expect(tpl.order.length).toBeGreaterThan(0);
      for (const id of tpl.order) expect(SECTION_SCHEMAS[tpl.sections[id].type]).toBeDefined();
    }
    expect(Object.values(doc.templates.product.sections).some((s) => s.type === "main-product")).toBe(true);
    expect(Object.values(doc.templates.catalog.sections).some((s) => s.type === "main-collection")).toBe(true);
    // Le document par défaut passe la validation stricte de l'éditeur.
    const v = validateThemeDocument(doc);
    expect(v.ok, JSON.stringify(!v.ok && v.errors.slice(0, 3))).toBe(true);
  });

  it("sections adaptées au secteur", () => {
    const types = (s: string) => Object.values(defaultThemeDocument(s).templates.home.sections).map((x) => x.type);
    expect(types("restaurant")).toEqual(expect.arrayContaining(["hero-banner", "product-grid", "opening-hours", "whatsapp-cta"]));
    expect(types("mode")).toEqual(expect.arrayContaining(["slideshow", "collection-list", "reviews"]));
    expect(types("salon")).toEqual(expect.arrayContaining(["opening-hours", "whatsapp-cta"]));
    expect(defaultThemeDocument("inconnu").preset).toBe("general");
  });
});

describe("migrateLegacyTheme (v1 → v2)", () => {
  const legacy = {
    sector: "general",
    themeId: "restaurant",
    themeConfig: {
      primary: "#123456",
      accent: "#ABCDEF",
      font: "serif",
      radius: "sharp",
      layout: "list",
      heroStyle: "split",
      sections: ["hero", "products", "faq", "testimonials", "hours"],
      announcement: "Livraison offerte ce week-end",
      faq: [{ q: "Livrez-vous ?", a: "Oui, partout à Cotonou." }],
      testimonials: [{ name: "Awa", text: "Excellent !" }],
    },
    bannerUrl: "https://images.unsplash.com/photo-1",
    logoUrl: "https://images.unsplash.com/photo-2",
    name: "Maquis",
    tagline: "Cuisine béninoise",
    whatsappNumber: "22997000000",
  };

  it("reprend couleurs, police, arrondis, annonce et logo", () => {
    const doc = migrateLegacyTheme(legacy);
    expect(doc.preset).toBe("restaurant");
    expect(doc.settings.colors.primary).toBe("#123456");
    expect(doc.settings.colors.accent).toBe("#ABCDEF");
    expect(doc.settings.typography.heading).toBe("fraunces");
    expect(doc.settings.buttons.radius).toBe(6);
    expect(doc.settings.header.announcement).toMatchObject({ enabled: true, text: "Livraison offerte ce week-end" });
    expect(doc.settings.header.logo?.url).toBe("https://images.unsplash.com/photo-2");
  });

  it("respecte l'ordre des sections v1 et leur contenu", () => {
    const home = migrateLegacyTheme(legacy).templates.home;
    const types = home.order.map((id) => home.sections[id].type);
    expect(types).toEqual(["hero-banner", "product-grid", "reviews", "faq", "testimonials", "opening-hours", "whatsapp-cta"]);
    const hero = home.sections[home.order[0]];
    expect(hero.settings).toMatchObject({ layout: "split", image: { url: "https://images.unsplash.com/photo-1" } });
    expect(home.sections[home.order[1]].settings.layout).toBe("list");
    const faq = Object.values(home.sections).find((s) => s.type === "faq")!;
    expect(faq.blocks[0].settings).toMatchObject({ question: "Livrez-vous ?", answer: "Oui, partout à Cotonou." });
  });

  it("config v1 absente ou corrompue : modèle du secteur", () => {
    const doc = migrateLegacyTheme({ sector: "mode", themeId: "nimporte", themeConfig: "corrompu" });
    expect(doc.preset).toBe("mode");
    expect(validateThemeDocument(doc).ok).toBe(true);
  });
});

describe("sanitizeThemeDocument (validation défensive)", () => {
  const fallback = defaultThemeDocument("general");

  it("ignore les valeurs inconnues ou dangereuses et garde les valides", () => {
    const raw = structuredClone(fallback) as unknown as Record<string, any>;
    raw.settings.colors.primary = "#FF0000";
    raw.settings.colors.accent = "red";
    raw.settings.colors.text = "javascript:alert(1)";
    raw.settings.typography.heading = "comic-sans";
    raw.settings.buttons.radius = 5000;
    raw.settings.header.logo = { url: "javascript:alert(1)" };
    raw.settings.header.announcement = { enabled: true, text: "Promo", link: "//evil.example" };
    raw.settings.injected = "<script>";
    const hero = raw.templates.home.sections.hero;
    hero.settings.image = { url: "http://insecure.example/a.jpg" };
    hero.settings.height = "gigantesque";
    hero.settings.overlay_opacity = 999;
    hero.settings.onload = "alert(1)";
    hero.blocks.push({ id: "x", type: "script", settings: {} });
    raw.templates.home.sections.evil = { id: "evil", type: "iframe", settings: {}, blocks: [] };
    raw.templates.home.order.push("evil", "absente");

    const doc = sanitizeThemeDocument(raw, fallback);
    expect(doc.settings.colors.primary).toBe("#FF0000");
    expect(doc.settings.colors.accent).toBe(fallback.settings.colors.accent);
    expect(doc.settings.colors.text).toBe(fallback.settings.colors.text);
    expect(doc.settings.typography.heading).toBe(fallback.settings.typography.heading);
    expect(doc.settings.buttons.radius).toBe(999); // borné comme validate.ts (999 = pilule)
    expect(doc.settings.header.logo).toBeNull();
    expect(doc.settings.header.announcement.link).toBeUndefined();
    expect("injected" in doc.settings).toBe(false);
    const h = doc.templates.home.sections.hero;
    expect(h.settings.image ?? null).toBeNull();
    expect(h.settings.height).toBe("large");
    expect(h.settings.overlay_opacity).toBe(80);
    expect("onload" in h.settings).toBe(false);
    expect(h.blocks.some((b) => b.type === "script")).toBe(false);
    expect(doc.templates.home.order).not.toContain("evil");
    expect(doc.templates.home.order).not.toContain("absente");
  });

  it("réinjecte la section obligatoire d'un modèle et refuse une section hors modèle", () => {
    const raw = structuredClone(fallback) as unknown as Record<string, any>;
    raw.templates.product = { order: ["r"], sections: { r: { id: "r", type: "reviews", settings: {}, blocks: [] } } };
    raw.templates.home.order.push("mp");
    raw.templates.home.sections.mp = { id: "mp", type: "main-product", settings: {}, blocks: [] };
    const doc = sanitizeThemeDocument(raw, fallback);
    expect(doc.templates.product.order.map((id) => doc.templates.product.sections[id].type)).toEqual(["main-product", "reviews"]);
    expect(doc.templates.home.order).not.toContain("mp");
  });

  it("respecte les limites de blocs du schéma", () => {
    const raw = structuredClone(fallback) as unknown as Record<string, any>;
    const main = raw.templates.product.sections.main;
    main.blocks.push({ id: "t2", type: "title", settings: {} }, { id: "t3", type: "title", settings: {} });
    const doc = sanitizeThemeDocument(raw, fallback);
    expect(doc.templates.product.sections.main.blocks.filter((b) => b.type === "title")).toHaveLength(1);
  });

  it("version ou forme invalide : document de repli", () => {
    expect(sanitizeThemeDocument(null, fallback)).toBe(fallback);
    expect(sanitizeThemeDocument({ version: 1 }, fallback)).toBe(fallback);
  });

  it("liens et images : https, internes ou data-URL raster uniquement", () => {
    expect(safeLink("/collections/robes")).toBe("/collections/robes");
    expect(safeLink("https://exemple.bj")).toBe("https://exemple.bj");
    expect(safeLink("//evil.example")).toBeNull();
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("http://x.bj/a.png")).toBeNull();
    expect(safeImageUrl("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(safeImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});

describe("variables CSS", () => {
  it("contraste du texte sur la couleur primaire garanti", () => {
    const doc = defaultThemeDocument("general");
    doc.settings.colors.primary = "#F5F5F5";
    doc.settings.colors.primaryText = "#FFFFFF";
    expect(themeCssVars(doc.settings)["--store-primary-contrast"]).toBe("#111412");
  });
  it("schémas de section : défaut neutre, inversé, personnalisé, inconnu", () => {
    const s = defaultThemeDocument("mode").settings;
    expect(schemeVars(s, "default")).toBeNull();
    expect(schemeVars(s, "inverse")?.backgroundColor).toBe(s.colors.text);
    expect(schemeVars(s, "sombre")?.backgroundColor).toBe(s.colors.schemes[0].background);
    expect(schemeVars(s, "inexistant")).toBeNull();
  });
});
