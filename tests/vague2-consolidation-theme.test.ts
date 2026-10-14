/**
 * Consolidation vague 2 (thème, éditeur) : réglage `blog_category`, sélecteur de devise de l'en-tête, borne du logo,
 * modèles Blog / Article éditables. Fonctions pures du moteur, sans base.
 */
import { describe, expect, it } from "vitest";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { EDITABLE_TEMPLATES, defaultsFor } from "@/lib/theme-engine/editor-defaults";
import { GLOBAL_GROUPS } from "@/lib/theme-engine/editor-global";
import { applyOperations, GLOBAL_SETTING_PATHS } from "@/lib/theme-engine/operations";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { fieldSchema, validateThemeDocument } from "@/lib/theme-engine/validate";
import { sanitizeFieldValue, sanitizeThemeDocument } from "@/lib/storefront/theme-doc";
import type { SettingField } from "@/lib/theme-engine/types";

const field: SettingField = { type: "blog_category", id: "category", label: "Catégorie", default: "" };
const base = () => defaultThemeDocument("mode", { name: "Test" });

describe("réglage blog_category", () => {
  it("« Derniers articles » utilise le sélecteur dédié, défaut vide (toutes les catégories)", () => {
    const f = SECTION_SCHEMAS["blog-posts"].settings.find((s) => "id" in s && s.id === "category");
    expect(f?.type).toBe("blog_category");
    expect(defaultsFor([field])).toEqual({ category: "" });
  });

  it("validation : vide ou adresse de catégorie", () => {
    const s = fieldSchema(field)!;
    expect(s.safeParse("").success).toBe(true);
    expect(s.safeParse("conseils-mode").success).toBe(true);
    for (const bad of ["Conseils", "a b", "-x", "x".repeat(81), "../x", 3]) expect(s.safeParse(bad).success).toBe(false);
  });

  it("rétrocompatible : une valeur de l'ancien champ texte reste lue (normalisée)", () => {
    expect(sanitizeFieldValue(field, "conseils")).toBe("conseils");
    expect(sanitizeFieldValue(field, "  Conseils ")).toBe("conseils");
    expect(sanitizeFieldValue(field, "")).toBe("");
    expect(sanitizeFieldValue(field, "<script>")).toBeUndefined();
    expect(sanitizeFieldValue(field, 42)).toBeUndefined();
  });

  it("document : section existante avec une catégorie texte → sanitize puis validation acceptée", () => {
    const doc = base();
    const home = doc.templates.home;
    const id = "blog_legacy";
    const raw = JSON.parse(JSON.stringify(doc));
    raw.templates.home.sections[id] = { type: "blog-posts", settings: { category: " Conseils " }, blocks: {}, block_order: [] };
    raw.templates.home.order = [...home.order, id];
    const clean = sanitizeThemeDocument(raw, doc);
    expect(clean.templates.home.sections[id]?.settings.category).toBe("conseils");
    expect(validateThemeDocument(clean).ok).toBe(true);
  });
});

describe("en-tête : sélecteur de devise", () => {
  it("défaut vrai, et complété à vrai pour un document antérieur (rétrocompatible)", () => {
    const doc = base();
    expect(doc.settings.header.showCurrencyPicker).toBe(true);
    const raw = JSON.parse(JSON.stringify(doc));
    delete raw.settings.header.showCurrencyPicker;
    expect(sanitizeThemeDocument(raw, doc).settings.header.showCurrencyPicker).toBe(true);
    const v = validateThemeDocument(raw);
    expect(v.ok && v.doc.settings.header.showCurrencyPicker).toBe(true);
  });

  it("désactivable : conservé par le nettoyage, la validation et les opérations", () => {
    const doc = base();
    const r = applyOperations(doc, [{ op: "updateGlobalSetting", path: "header.showCurrencyPicker", value: false }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.settings.header.showCurrencyPicker).toBe(false);
    expect(sanitizeThemeDocument(JSON.parse(JSON.stringify(r.doc)), doc).settings.header.showCurrencyPicker).toBe(false);
    expect(GLOBAL_SETTING_PATHS).toContain("header.showCurrencyPicker");
  });

  it("exposé dans l'éditeur (Thème > En-tête)", () => {
    const header = GLOBAL_GROUPS.find((g) => g.fields.some((f) => "id" in f && f.id === "header.logoWidth"));
    expect(header?.fields.some((f) => "id" in f && f.id === "header.showCurrencyPicker")).toBe(true);
  });
});

describe("logo : borne commune à 300 px", () => {
  it("nettoyage aligné sur la validation et l'éditeur", () => {
    const doc = base();
    const raw = JSON.parse(JSON.stringify(doc));
    raw.settings.header.logoWidth = 300;
    expect(sanitizeThemeDocument(raw, doc).settings.header.logoWidth).toBe(300);
    raw.settings.header.logoWidth = 999;
    expect(sanitizeThemeDocument(raw, doc).settings.header.logoWidth).toBe(300);
    raw.settings.header.logoWidth = 300;
    expect(validateThemeDocument(raw).ok).toBe(true);
  });
});

describe("éditeur : modèles Blog et Article", () => {
  it("proposés dans le sélecteur de page, après les modèles existants", () => {
    const ids = EDITABLE_TEMPLATES.map((t) => t.id);
    expect(ids.slice(0, 6)).toEqual(["home", "product", "collection", "catalog", "page", "cart"]);
    expect(ids).toContain("blog");
    expect(ids).toContain("article");
  });

  it("modèle alternatif d'article : créable par opération", () => {
    const r = applyOperations(base(), [{ op: "addAlternate", type: "article", suffix: "long" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.alternates?.article?.long).toBeTruthy();
  });
});
