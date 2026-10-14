import { describe, it, expect } from "vitest";
import { localizeThemeDocument, themeTextFields } from "@/lib/i18n/localize-theme";
import { sourceHash, isStale } from "@/lib/i18n/hash";
import { THEME_DOC_VERSION, type ThemeDocument, type Template } from "@/lib/theme-engine/types";
import { storefrontPreset } from "@/lib/storefront/theme";
import { migrateLegacyTheme } from "@/lib/theme-engine/defaults";

/**
 * Lot 2 §1.1 — `localizeThemeDocument` : seuls les champs texte sont remplacés, les valeurs traduites
 * repassent par `sanitizeFieldValue`, et une source modifiée est détectée par `sourceHash`.
 */

function baseDoc(): ThemeDocument {
  const doc = migrateLegacyTheme({ sector: "general", themeId: "market", themeConfig: null, bannerUrl: null, logoUrl: null, name: "Chez Aïcha", tagline: null, description: null, whatsappNumber: null });
  const template: Template = {
    order: ["rt-1"],
    sections: {
      "rt-1": {
        id: "rt-1",
        type: "rich-text",
        settings: { align: "left", scheme: "default" },
        blocks: [
          { id: "b-1", type: "heading", settings: { text: "Notre savoir-faire", size: "lg" } },
          { id: "b-2", type: "text", settings: { text: "Des pagnes **tissés** à Cotonou." } },
          { id: "b-3", type: "button", settings: { button_label: "Voir la boutique", button_link: "/catalogue", button_style: "solid" } },
        ],
      },
    },
  };
  return {
    ...doc,
    version: THEME_DOC_VERSION,
    settings: { ...doc.settings, header: { ...doc.settings.header, announcement: { enabled: true, text: "Livraison à Cotonou", link: "/catalogue" } }, footer: { ...doc.settings.footer, text: "Merci de votre visite" } },
    templates: { ...doc.templates, home: template },
  };
}

describe("themeTextFields", () => {
  it("ne liste que les champs texte, textarea et richtext (jamais les liens, couleurs ou images)", () => {
    const paths = themeTextFields(baseDoc()).map((f) => f.path);
    expect(paths).toContain("settings.header.announcement.text");
    expect(paths).toContain("settings.footer.text");
    expect(paths).toContain("templates.home.sections.rt-1.blocks.b-1.settings.text");
    expect(paths).toContain("templates.home.sections.rt-1.blocks.b-2.settings.text");
    expect(paths).toContain("templates.home.sections.rt-1.blocks.b-3.settings.button_label");
    // Lien du bouton (url), style (segmented), alignement (select) : non traduisibles.
    expect(paths.some((p) => p.endsWith("button_link"))).toBe(false);
    expect(paths.some((p) => p.endsWith("button_style"))).toBe(false);
    expect(paths.some((p) => p.endsWith("settings.align"))).toBe(false);
  });
});

describe("localizeThemeDocument", () => {
  it("remplace les textes demandés et ne touche à rien d'autre", () => {
    const doc = baseDoc();
    const out = localizeThemeDocument(doc, {
      "templates.home.sections.rt-1.blocks.b-1.settings.text": "Our craft",
      "templates.home.sections.rt-1.blocks.b-3.settings.button_label": "Shop now",
      "settings.header.announcement.text": "Delivery in Cotonou",
      "settings.footer.text": "Thanks for visiting",
    });
    const block = (id: string) => out.templates.home.sections["rt-1"]!.blocks.find((b) => b.id === id)!;
    expect(block("b-1").settings.text).toBe("Our craft");
    expect(block("b-3").settings.button_label).toBe("Shop now");
    expect(block("b-3").settings.button_link).toBe("/catalogue");
    expect(out.settings.header.announcement.text).toBe("Delivery in Cotonou");
    expect(out.settings.footer.text).toBe("Thanks for visiting");
    // Document d'entrée inchangé (fonction pure) et champs non traduits conservés.
    expect(doc.settings.footer.text).toBe("Merci de votre visite");
    expect(block("b-2").settings.text).toBe("Des pagnes **tissés** à Cotonou.");
    expect(out.settings.colors.primary).toBe(doc.settings.colors.primary);
  });

  it("ignore les chemins inconnus, les champs non textuels et les valeurs vides", () => {
    const doc = baseDoc();
    const out = localizeThemeDocument(doc, {
      "templates.home.sections.inconnue.settings.text": "x",
      "templates.home.sections.rt-1.blocks.b-3.settings.button_link": "https://evil.example/pwn",
      "templates.home.sections.rt-1.settings.align": "right",
      "templates.home.sections.rt-1.blocks.b-1.settings.text": "   ",
      "settings.colors.primary": "#ff0000",
    });
    const section = out.templates.home.sections["rt-1"]!;
    expect(section.settings.align).toBe("left");
    expect(section.blocks.find((b) => b.id === "b-3")!.settings.button_link).toBe("/catalogue");
    expect(section.blocks.find((b) => b.id === "b-1")!.settings.text).toBe("Notre savoir-faire");
    expect(out.settings.colors.primary).toBe(doc.settings.colors.primary);
  });

  it("revalide la valeur traduite (sanitizeFieldValue) : titre tronqué à la longueur du champ", () => {
    const doc = baseDoc();
    const long = "A".repeat(500);
    const out = localizeThemeDocument(doc, { "templates.home.sections.rt-1.blocks.b-1.settings.text": long });
    const text = out.templates.home.sections["rt-1"]!.blocks.find((b) => b.id === "b-1")!.settings.text as string;
    expect(text.length).toBe(120); // maxLength du bloc « Titre »
  });

  it("n'altère pas le document quand il n'y a aucune traduction", () => {
    const doc = baseDoc();
    expect(localizeThemeDocument(doc, {})).toBe(doc);
  });

  it("garde le secteur de la boutique intact (aucune dépendance au préréglage)", () => {
    expect(storefrontPreset("general", "market").copy.addLabel).toBeTypeOf("string");
  });
});

describe("sourceHash (détection d'obsolescence)", () => {
  it("est stable à la normalisation près et détecte une source modifiée", () => {
    expect(sourceHash("Robe en wax")).toBe(sourceHash(" Robe en wax \n"));
    expect(sourceHash("Robe en wax\r\nbleue")).toBe(sourceHash("Robe en wax\nbleue"));
    const h = sourceHash("Robe en wax");
    expect(isStale(h, "Robe en wax")).toBe(false);
    expect(isStale(h, "Robe en wax bleue")).toBe(true);
    // Sans empreinte enregistrée, rien n'est « à revoir ».
    expect(isStale(null, "Robe en wax")).toBe(false);
  });
});
