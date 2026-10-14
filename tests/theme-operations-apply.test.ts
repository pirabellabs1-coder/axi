import { describe, expect, it } from "vitest";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import {
  applyOperations,
  bindDynamicSource,
  GLOBAL_SETTING_PATHS,
  insertSavedSection,
  setSectionVisibility,
  ThemeOpError,
  unbindDynamicSource,
  uniqueIdFactory,
  type ThemeOperation,
} from "@/lib/theme-engine/operations";
import { editAttrs, parseEditAttr } from "@/lib/theme-engine/edit-attrs";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import type { SectionVisibility, ThemeDocument } from "@/lib/theme-engine/types";

const doc0 = () => defaultThemeDocument("general");
const firstOf = (doc: ThemeDocument, type: string, tpl: keyof ThemeDocument["templates"] = "home") => Object.values(doc.templates[tpl].sections).find((s) => s.type === type)!;
const frozen = (d: ThemeDocument) => JSON.stringify(d);

describe("applyOperations", () => {
  it("applique une suite d'opérations et revalide", () => {
    const doc = doc0();
    const hero = firstOf(doc, "hero-banner");
    const ops: ThemeOperation[] = [
      { op: "addSection", template: "home", type: "trust-badges", index: 1 },
      { op: "updateSectionSetting", template: "home", sectionId: hero.id, key: "overlay_opacity", value: 40 },
      { op: "updateGlobalSetting", path: "colors.primary", value: "#123456" },
      { op: "updateGlobalSetting", path: "motion.preset", value: "lively" },
      { op: "setSectionAnimation", template: "home", sectionId: hero.id, animation: "zoom-in" },
      { op: "duplicateAlternate", type: "product", from: null, suffix: "luxe" },
    ];
    const r = applyOperations(doc, ops);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toHaveLength(2);
    expect(r.created[1]).toBe("product:luxe");
    expect(r.doc.templates.home.order[1]).toBe(r.created[0]);
    expect(r.doc.settings.colors.primary).toBe("#123456");
    expect(r.doc.settings.motion).toEqual({ preset: "lively", reveal: true, parallax: false, hoverZoom: true });
    expect(r.doc.templates.home.sections[hero.id].animation).toBe("zoom-in");
  });

  it("atomique : un échec laisse le document d'origine intact (annulation)", () => {
    const doc = doc0();
    const before = frozen(doc);
    const r = applyOperations(doc, [
      { op: "updateGlobalSetting", path: "colors.primary", value: "#000000" },
      { op: "removeSection", template: "home", sectionId: "inexistante" },
    ]);
    expect(r).toMatchObject({ ok: false, index: 1, error: "Section introuvable." });
    expect(frozen(doc)).toBe(before);
  });

  it("valeur hors schéma rejetée à la revalidation", () => {
    const doc = doc0();
    const r = applyOperations(doc, [{ op: "updateGlobalSetting", path: "colors.primary", value: "red" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues?.[0].path).toEqual(["settings", "colors", "primary"]);
    const hero = firstOf(doc, "hero-banner");
    expect(applyOperations(doc, [{ op: "updateSectionSetting", template: "home", sectionId: hero.id, key: "overlay_opacity", value: 9999 }]).ok).toBe(false);
  });

  it.each([
    [{ op: "eval", code: "x" }, "Opération inconnue."],
    [{ op: "__proto__" }, "Opération inconnue."],
    [null, "Opération inconnue."],
    [{ op: "updateGlobalSetting", path: "__proto__.polluted", value: 1 }, "Réglage global non modifiable."],
    [{ op: "updateGlobalSetting", path: "colors", value: {} }, "Réglage global non modifiable."],
    [{ op: "updateGlobalSetting", path: "colors.inventee", value: "#000000" }, "Réglage global non modifiable."],
    [{ op: "addSection", template: "home", type: "script" }, "Type de section inconnu."],
    [{ op: "addSection", template: "admin", type: "faq" }, "Modèle de page introuvable."],
    [{ op: "updateSectionSetting", template: "home", sectionId: "../x", key: "a", value: 1 }, "Identifiant invalide."],
    [{ op: "moveSection", template: "home", sectionId: "x", index: -1 }, "Position invalide."],
  ])("liste blanche : %j refusé", (op, error) => {
    const r = applyOperations(doc0(), [op]);
    expect(r).toMatchObject({ ok: false, error });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("chemins globaux en liste blanche : tous valides sur un document par défaut", () => {
    const doc = doc0();
    for (const p of GLOBAL_SETTING_PATHS) expect(p).toMatch(/^[a-z]+(\.[A-Za-z]+){1,2}$/);
    expect(GLOBAL_SETTING_PATHS).not.toContain("colors");
    const r = applyOperations(doc, [{ op: "updateGlobalSetting", path: "header.announcement.text", value: "Livraison offerte" }]);
    expect(r.ok && r.doc.settings.header.announcement.text).toBe("Livraison offerte");
  });

  it("plafond et sous-ensemble autorisé", () => {
    const ops = Array.from({ length: 21 }, () => ({ op: "updateGlobalSetting", path: "buttons.shadow", value: true }));
    expect(applyOperations(doc0(), ops, { maxOps: 20 })).toMatchObject({ ok: false, error: "20 opérations maximum." });
    const hero = firstOf(doc0(), "hero-banner");
    expect(applyOperations(doc0(), [{ op: "removeSection", template: "home", sectionId: hero.id }], { allow: ["updateGlobalSetting"] })).toMatchObject({ ok: false, error: "Opération non autorisée ici." });
    expect(applyOperations(doc0(), "pas une liste")).toMatchObject({ ok: false, index: -1 });
  });

  it("limite de plan des modèles alternatifs", () => {
    expect(applyOperations(doc0(), [{ op: "addAlternate", type: "product", suffix: "luxe" }], { alternatesPerType: 0 }).ok).toBe(false);
    expect(applyOperations(doc0(), [{ op: "addAlternate", type: "product", suffix: "luxe" }], { alternatesPerType: 5 }).ok).toBe(true);
  });
});

describe("visibilité par audience", () => {
  const v: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "customer", values: ["loyal"] }] };
  it("pose, retire, valide", () => {
    const doc = doc0();
    const hero = firstOf(doc, "hero-banner");
    const d1 = setSectionVisibility(doc, "home", hero.id, v);
    expect(d1.templates.home.sections[hero.id].visibility).toEqual(v);
    expect(validateThemeDocument(d1).ok).toBe(true);
    const d2 = setSectionVisibility(d1, "home", hero.id, null);
    expect("visibility" in d2.templates.home.sections[hero.id]).toBe(false);
  });
  it("règle invalide ou section obligatoire refusées", () => {
    const doc = doc0();
    const hero = firstOf(doc, "hero-banner");
    expect(() => setSectionVisibility(doc, "home", hero.id, { match: "all", mode: "show", rules: [{ type: "customer", values: ["vip" as "new"] }] })).toThrow(ThemeOpError);
    const main = firstOf(doc, "main-product", "product");
    expect(() => setSectionVisibility(doc, "product", main.id, v)).toThrow("obligatoire");
  });
});

describe("sources dynamiques", () => {
  it("liaison et déliaison", () => {
    const doc = doc0();
    const main = firstOf(doc, "main-product", "product");
    const text = main.blocks.find((b) => b.type === "collapsible_tab") ?? null;
    const target = text ?? main.blocks[0];
    const d1 = bindDynamicSource(doc, "product", main.id, target.id, "title", "product.metafields.custom.matiere");
    const b1 = d1.templates.product.sections[main.id].blocks.find((b) => b.id === target.id)!;
    expect(b1.settings.title).toEqual({ $source: "product.metafields.custom.matiere" });
    expect(validateThemeDocument(d1).ok).toBe(true);
    const d2 = unbindDynamicSource(d1, "product", main.id, target.id, "title");
    expect(d2.templates.product.sections[main.id].blocks.find((b) => b.id === target.id)!.settings.title).toBe("Livraison et retours");
    expect(unbindDynamicSource(d2, "product", main.id, target.id, "title")).toBe(d2);
  });
  it("refus : grammaire, champ non connectable", () => {
    const doc = doc0();
    const hero = firstOf(doc, "hero-banner");
    expect(() => bindDynamicSource(doc, "home", hero.id, null, "image", "customer.email")).toThrow("Source dynamique invalide.");
    expect(() => bindDynamicSource(doc, "home", hero.id, null, "overlay_opacity", "product.price")).toThrow("ne peut pas être connecté");
  });
});

describe("insertSavedSection", () => {
  const payload = {
    type: "featured-collection",
    settings: { heading: "Nouveautés", collection: "col-autre-boutique", limit: 4 },
    blocks: [],
    visibility: { match: "all", mode: "show", rules: [{ type: "device", values: ["mobile"] }] },
  };
  it("ids neufs, sanitize, références étrangères retirées", () => {
    const doc = doc0();
    const r = insertSavedSection(doc, "home", payload, { index: 0, refs: { collectionIds: new Set(["col-1"]), productIds: new Set() } });
    const s = r.doc.templates.home.sections[r.id];
    expect(r.doc.templates.home.order[0]).toBe(r.id);
    expect(s.settings.collection).toBeNull();
    expect(s.settings.heading).toBe("Nouveautés");
    expect(s.visibility?.rules[0]).toEqual({ type: "device", values: ["mobile"] });
    expect(validateThemeDocument(r.doc).ok).toBe(true);
  });
  it("charge illisible ou type non autorisé sur le modèle refusés", () => {
    expect(() => insertSavedSection(doc0(), "home", { type: "<script>" })).toThrow(ThemeOpError);
    expect(() => insertSavedSection(doc0(), "home", { type: "main-product", settings: {}, blocks: [] })).toThrow("pas disponible");
  });
  it("deux insertions : ids distincts", () => {
    const doc = doc0();
    const ids = uniqueIdFactory(doc);
    const a = insertSavedSection(doc, "home", payload, { ids });
    const b = insertSavedSection(a.doc, "home", payload, { ids });
    expect(a.id).not.toBe(b.id);
  });
});

describe("editAttrs", () => {
  it("aperçu seulement", () => {
    const t = { sectionId: "hero-1", blockId: null, settingId: "heading", kind: "text" as const };
    expect(editAttrs({ preview: false }, t)).toEqual({});
    expect(editAttrs(null, t)).toEqual({});
    expect(editAttrs({ preview: true }, t)).toEqual({ "data-edit": "hero-1:-:heading", "data-edit-kind": "text" });
    expect(editAttrs({ preview: true }, { ...t, blockId: "b-2" })["data-edit"]).toBe("hero-1:b-2:heading");
  });
  it("identifiant douteux : rien", () => {
    expect(editAttrs({ preview: true }, { sectionId: 'x" onclick="a', settingId: "h", kind: "text" })).toEqual({});
  });
  it("lecture inverse", () => {
    expect(parseEditAttr("hero-1:-:heading")).toEqual({ sectionId: "hero-1", blockId: null, settingId: "heading" });
    expect(parseEditAttr("a:b:c:d")).toBeNull();
  });
});
