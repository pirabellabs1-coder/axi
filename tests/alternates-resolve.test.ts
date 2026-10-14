import { describe, expect, it } from "vitest";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import {
  canAddAlternate,
  countAlternates,
  getTemplateByKey,
  listAlternates,
  normalizeSuffix,
  parseTemplateKey,
  resolveTemplate,
  templateKey,
  templateKeysOf,
} from "@/lib/theme-engine/alternates";
import { addAlternate, addSection, duplicateAlternate, removeAlternate, renameAlternate, ThemeOpError } from "@/lib/theme-engine/operations";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { MAX_ALTERNATE_TEMPLATES, type ThemeDocument } from "@/lib/theme-engine/types";

const base = () => defaultThemeDocument("mode");

function withLuxe(): ThemeDocument {
  return duplicateAlternate(base(), "product", null, "luxe").doc;
}

describe("clés de modèle", () => {
  it("analyse et construction", () => {
    expect(parseTemplateKey("product")).toEqual({ base: "product", suffix: null });
    expect(parseTemplateKey("product:luxe")).toEqual({ base: "product", suffix: "luxe" });
    expect(parseTemplateKey("home:luxe")).toBeNull(); // pas d'alternatif pour l'accueil
    expect(parseTemplateKey("product:Luxe")).toBeNull();
    expect(parseTemplateKey("__proto__")).toBeNull();
    expect(templateKey("collection", "ete")).toBe("collection:ete");
    expect(templateKey("home")).toBe("home");
    expect(() => templateKey("home", "x")).toThrow();
  });

  it("suffixe normalisé depuis un nom saisi", () => {
    expect(normalizeSuffix("Luxe Été 2026")).toBe("luxe-ete-2026");
    expect(normalizeSuffix("  ")).toBeNull();
    expect(normalizeSuffix("x".repeat(40))).toHaveLength(24);
  });
});

describe("resolveTemplate : alternates[type][suffix] ?? templates[type]", () => {
  it("suffixe existant → alternatif", () => {
    const doc = withLuxe();
    const r = resolveTemplate(doc, "product", "luxe");
    expect(r.key).toBe("product:luxe");
    expect(r.template).toBe(doc.alternates!.product!.luxe);
  });
  it.each([[null], [undefined], [""], ["inconnu"], ["../x"], ["LUXE"]])("suffixe %s → défaut", (s) => {
    const doc = withLuxe();
    const r = resolveTemplate(doc, "product", s as string | null);
    expect(r.key).toBe("product");
    expect(r.template).toBe(doc.templates.product);
  });
  it("type sans alternatifs (accueil) → défaut", () => {
    const doc = withLuxe();
    expect(resolveTemplate(doc, "home", "luxe").key).toBe("home");
  });
  it("après suppression → défaut", () => {
    const doc = removeAlternate(withLuxe(), "product", "luxe");
    expect(resolveTemplate(doc, "product", "luxe").key).toBe("product");
    expect(doc.alternates).toBeUndefined();
  });
});

describe("opérations sur les alternatifs", () => {
  it("duplication : ids neufs, document valide, sections identiques", () => {
    const doc = withLuxe();
    const alt = doc.alternates!.product!.luxe;
    const def = doc.templates.product;
    expect(alt.order.map((id) => alt.sections[id].type)).toEqual(def.order.map((id) => def.sections[id].type));
    expect(alt.order.some((id) => def.order.includes(id))).toBe(false);
    expect(validateThemeDocument(doc).ok).toBe(true);
    expect(templateKeysOf(doc)).toContain("product:luxe");
    expect(listAlternates(doc)).toEqual([{ type: "product", suffix: "luxe", key: "product:luxe", sections: alt.order.length }]);
  });

  it("création depuis les défauts, puis édition ciblée par clé", () => {
    const { doc } = addAlternate(base(), "page", "contact");
    expect(getTemplateByKey(doc, "page:contact")?.order.length).toBeGreaterThan(0);
    const r = addSection(doc, "page:contact", "faq");
    expect(r.doc.alternates!.page!.contact.sections[r.id].type).toBe("faq");
    expect(r.doc.templates.page).toBe(doc.templates.page); // le modèle par défaut est intact
    expect(validateThemeDocument(r.doc).ok).toBe(true);
  });

  it("règles du modèle de base : section de fiche produit interdite sur une page", () => {
    const { doc } = addAlternate(base(), "page", "x");
    expect(() => addSection(doc, "page:x", "main-product")).toThrow(ThemeOpError);
  });

  it("nom en double, invalide, plafond global de 20, limite du plan", () => {
    const doc = withLuxe();
    expect(() => duplicateAlternate(doc, "product", null, "luxe")).toThrow("déjà");
    expect(() => addAlternate(doc, "product", "Pas Bon")).toThrow(ThemeOpError);
    expect(canAddAlternate(doc, "product", "b", { perTypeLimit: 1 }).ok).toBe(false);
    expect(canAddAlternate(doc, "collection", "b", { perTypeLimit: 1 }).ok).toBe(true);
    expect(canAddAlternate(doc, "product", "b", { perTypeLimit: 0 })).toMatchObject({ ok: false, reason: expect.stringContaining("offre") });
    let d = base();
    for (let i = 0; i < MAX_ALTERNATE_TEMPLATES; i++) d = addAlternate(d, (["product", "collection", "page", "article"] as const)[i % 4], `m${i}`).doc;
    expect(countAlternates(d)).toBe(MAX_ALTERNATE_TEMPLATES);
    expect(() => addAlternate(d, "product", "trop")).toThrow(`${MAX_ALTERNATE_TEMPLATES}`);
    expect(validateThemeDocument(d).ok).toBe(true);
  });

  it("renommage : ordre conservé, cible libre", () => {
    let doc = withLuxe();
    doc = duplicateAlternate(doc, "product", "luxe", "promo").doc;
    doc = renameAlternate(doc, "product", "luxe", "prestige");
    expect(Object.keys(doc.alternates!.product!)).toEqual(["prestige", "promo"]);
    expect(() => renameAlternate(doc, "product", "prestige", "promo")).toThrow("déjà");
  });
});
