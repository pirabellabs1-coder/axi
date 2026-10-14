/* eslint-disable @typescript-eslint/no-explicit-any -- documents bruts volontairement non typés */
import { describe, expect, it } from "vitest";
import { defaultThemeDocument, SECTORS } from "@/lib/theme-engine/defaults";
import { MAX_DOCUMENT_BYTES, validateThemeDocument } from "@/lib/theme-engine/validate";
import { sanitizeThemeDocument } from "@/lib/storefront/theme-doc";
import { duplicateAlternate } from "@/lib/theme-engine/operations";
import { MAX_ALTERNATE_TEMPLATES, MAX_VISIBILITY_RULES, type ThemeDocument } from "@/lib/theme-engine/types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const heroOf = (doc: any) => Object.values(doc.templates.home.sections).find((s: any) => s.type === "hero-banner") as any;

describe("rétrocompatibilité stricte (documents antérieurs au lot 4)", () => {
  it.each(SECTORS)("secteur %s : sanitize et validate laissent le document identique, sans champ lot 4 ajouté", (sector) => {
    const doc = defaultThemeDocument(sector);
    const raw = clone(doc);
    const s = sanitizeThemeDocument(raw, defaultThemeDocument(sector));
    // Document stocké en JSON (Prisma Json) : égalité stricte de la forme sérialisée.
    expect(clone(s)).toStrictEqual(clone(doc));
    expect("alternates" in s).toBe(false);
    expect("motion" in s.settings).toBe(false);
    for (const t of Object.values(s.templates)) for (const sec of Object.values(t.sections)) {
      expect("visibility" in sec).toBe(false);
      expect("animation" in sec).toBe(false);
    }
    const v = validateThemeDocument(raw);
    expect(v.ok).toBe(true);
    if (v.ok) expect("alternates" in v.doc).toBe(false);
    expect(JSON.stringify(raw)).toBe(JSON.stringify(doc)); // aucune mutation de l'entrée
  });
});

describe("extensions lot 4 acceptées", () => {
  function extended(): any {
    const doc: any = clone(duplicateAlternate(defaultThemeDocument("general"), "product", null, "luxe").doc);
    doc.settings.motion = { preset: "lively", reveal: true, parallax: true, hoverZoom: false };
    const hero = heroOf(doc);
    hero.animation = "zoom-in";
    hero.visibility = { match: "any", mode: "show", rules: [{ type: "customer", values: ["loyal"] }, { type: "schedule", days: [5, 6], from: "18:00", to: "23:00" }] };
    hero.settings.image = { $source: "store.image" };
    return doc;
  }
  it("validate et sanitize conservent alternates, motion, animation, visibility, $source", () => {
    const doc = extended();
    const v = validateThemeDocument(doc);
    expect(v.ok, JSON.stringify(!v.ok && v.errors)).toBe(true);
    const s = sanitizeThemeDocument(clone(doc), defaultThemeDocument("general"));
    expect(s.alternates?.product?.luxe).toEqual(doc.alternates.product.luxe);
    expect(s.settings.motion).toEqual(doc.settings.motion);
    const hero = heroOf(s);
    expect(hero.animation).toBe("zoom-in");
    expect(hero.visibility).toEqual(heroOf(doc).visibility);
    expect(hero.settings.image).toEqual({ $source: "store.image" });
  });
  it("motion partiel complété par les défauts", () => {
    const doc = clone(defaultThemeDocument("general")) as any;
    doc.settings.motion = { preset: "none" };
    const v = validateThemeDocument(doc);
    expect(v.ok && v.doc.settings.motion).toEqual({ preset: "none", reveal: true, parallax: false, hoverZoom: true });
  });
});

describe("extensions lot 4 refusées (validate) ou neutralisées (sanitize)", () => {
  const fb = () => defaultThemeDocument("general");
  const mutate = (fn: (d: any) => void) => {
    const d: any = clone(defaultThemeDocument("general"));
    fn(d);
    return d;
  };

  it.each([
    ["source hors grammaire", (d: any) => (heroOf(d).settings.image = { $source: "customer.email" })],
    ["source sur un champ non connectable", (d: any) => (heroOf(d).settings.overlay_opacity = { $source: "product.price" })],
    ["source avec clé en trop", (d: any) => (heroOf(d).settings.image = { $source: "store.image", x: 1 })],
    ["animation inconnue", (d: any) => (heroOf(d).animation = "spin")],
    ["règle d'audience inconnue", (d: any) => (heroOf(d).visibility = { match: "all", mode: "show", rules: [{ type: "ip", values: ["1.2.3.4"] }] })],
    ["trop de règles", (d: any) => (heroOf(d).visibility = { match: "all", mode: "show", rules: Array.from({ length: MAX_VISIBILITY_RULES + 1 }, () => ({ type: "device", values: ["mobile"] })) })],
    ["horaire invalide", (d: any) => (heroOf(d).visibility = { match: "all", mode: "show", rules: [{ type: "schedule", days: [1], from: "25:00", to: "08:00" }] })],
    ["type d'alternatif interdit", (d: any) => (d.alternates = { home: { x: d.templates.home } })],
    ["suffixe invalide", (d: any) => (d.alternates = { product: { "Pas Bon": d.templates.product } })],
    ["alternatif sans sa section obligatoire", (d: any) => (d.alternates = { product: { vide: { order: [], sections: {} } } })],
    ["motion inconnu", (d: any) => (d.settings.motion = { preset: "crazy" })],
  ])("%s", (_, fn) => {
    const d = mutate(fn);
    expect(validateThemeDocument(d).ok).toBe(false);
    // Le rendu ne casse jamais : sanitize retombe sur une valeur sûre.
    const s = sanitizeThemeDocument(clone(d), fb());
    const hero = heroOf(s);
    expect(hero.settings.overlay_opacity).not.toEqual({ $source: "product.price" });
    expect(JSON.stringify(s)).not.toContain("customer.email");
    expect(hero.animation).not.toBe("spin");
    expect(s.alternates?.product?.["Pas Bon"]).toBeUndefined();
    expect((s.alternates as any)?.home).toBeUndefined();
  });

  it("plafond des modèles alternatifs (validate refuse, sanitize tronque)", () => {
    const d: any = clone(defaultThemeDocument("general"));
    d.alternates = { product: Object.fromEntries(Array.from({ length: MAX_ALTERNATE_TEMPLATES + 2 }, (_, i) => [`m${i}`, clone(d.templates.product)])) };
    expect(validateThemeDocument(d).ok).toBe(false);
    const s = sanitizeThemeDocument(d, defaultThemeDocument("general"));
    expect(Object.keys(s.alternates!.product!)).toHaveLength(MAX_ALTERNATE_TEMPLATES);
  });

  it("alternatif : obligatoire réinjectée au sanitize", () => {
    const d: any = clone(defaultThemeDocument("general"));
    d.alternates = { product: { vide: { order: [], sections: {} } } };
    const s = sanitizeThemeDocument(d, defaultThemeDocument("general"));
    expect(Object.values(s.alternates!.product!.vide.sections).some((x) => x.type === "main-product")).toBe(true);
  });

  it("taille maximale inchangée (3,5 Mo) et un document étendu reste loin du plafond", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(3_500_000);
    let doc: ThemeDocument = defaultThemeDocument("mode");
    for (let i = 0; i < MAX_ALTERNATE_TEMPLATES; i++) doc = duplicateAlternate(doc, "product", null, `m${i}`).doc;
    expect(JSON.stringify(doc).length).toBeLessThan(MAX_DOCUMENT_BYTES);
  });
});
