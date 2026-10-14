import { describe, it, expect } from "vitest";
import { fallbackThemeDocument, sequentialIds } from "@/lib/theme-engine/editor-defaults";
import * as ops from "@/lib/theme-engine/operations";
import { ThemeOpError } from "@/lib/theme-engine/operations";
import { collectReferences, isSafeImageUrl, isSafeLink, isSafeMarkdown, isSafeVideoUrl, issueKey, validateThemeDocument } from "@/lib/theme-engine/validate";
import { createHistory, pushHistory, redo, undo } from "@/lib/theme-engine/editor-history";
import { contrastRatio } from "@/lib/theme-engine/editor-color";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { canRestoreVersions, canUsePreset, themePlanRules, VERSIONS_KEPT_ADVANCED, VERSIONS_KEPT_BASIC } from "@/lib/theme/plan-rules";
import { readMenuItems, validateMenuItems } from "@/lib/theme/menu-schema";

const base = () => fallbackThemeDocument();
const ids = () => sequentialIds(1000);
const clone = (d: ThemeDocument) => structuredClone(d);
const home = (d: ThemeDocument) => d.templates.home;
const firstOf = (d: ThemeDocument, type: string) => Object.values(home(d).sections).find((s) => s.type === type)!;

describe("opérations : sections", () => {
  it("ajoute une section à l'index demandé avec un id unique, sans muter l'original", () => {
    const d = base();
    const before = JSON.stringify(d);
    const r = ops.addSection(d, "home", "rich-text", { index: 1 });
    expect(JSON.stringify(d)).toBe(before);
    expect(home(r.doc).order[1]).toBe(r.id);
    expect(home(r.doc).sections[r.id].type).toBe("rich-text");
    expect(home(d).order).not.toContain(r.id);
    const r2 = ops.addSection(r.doc, "home", "rich-text");
    expect(r2.id).not.toBe(r.id);
  });

  it("refuse les sections de modèle hors de leur page et les doublons de section obligatoire", () => {
    const d = base();
    expect(() => ops.addSection(d, "home", "main-product")).toThrow(ThemeOpError);
    expect(() => ops.addSection(d, "product", "main-product")).toThrow(/déjà présente/);
    expect(ops.canAddSection(d, "product", "product-recommendations").ok).toBe(true);
  });

  it("déplace une section en conservant tous les ids", () => {
    const d = base();
    const [a, b, c] = home(d).order;
    const m = ops.moveSection(d, "home", a, 2);
    expect(home(m).order.slice(0, 3)).toEqual([b, c, a]);
    expect(new Set(home(m).order)).toEqual(new Set(home(d).order));
    expect(ops.moveSection(d, "home", a, 0)).toBe(d);
  });

  it("duplique une section (nouveaux ids pour la section et ses blocs) juste après l'original", () => {
    const d = base();
    const hero = firstOf(d, "hero-banner");
    const r = ops.duplicateSection(d, "home", hero.id, ids());
    const order = home(r.doc).order;
    expect(order[order.indexOf(hero.id) + 1]).toBe(r.id);
    const copy = home(r.doc).sections[r.id];
    expect(copy.settings).toEqual(hero.settings);
    expect(copy.blocks.map((b) => b.type)).toEqual(hero.blocks.map((b) => b.type));
    expect(copy.blocks.some((b) => hero.blocks.some((h) => h.id === b.id))).toBe(false);
    expect(validateThemeDocument(r.doc).ok).toBe(true);
  });

  it("supprime et masque, mais protège les sections obligatoires", () => {
    const d = base();
    const faq = firstOf(d, "faq");
    const removed = ops.removeSection(d, "home", faq.id);
    expect(home(removed).sections[faq.id]).toBeUndefined();
    expect(home(removed).order).not.toContain(faq.id);
    const hidden = ops.setSectionHidden(d, "home", faq.id, true);
    expect(home(hidden).sections[faq.id].disabled).toBe(true);
    expect(home(ops.setSectionHidden(hidden, "home", faq.id, false)).sections[faq.id].disabled).toBeUndefined();
    const main = Object.values(d.templates.product.sections).find((s) => s.type === "main-product")!;
    expect(() => ops.removeSection(d, "product", main.id)).toThrow(/obligatoire/);
    expect(() => ops.setSectionHidden(d, "product", main.id, true)).toThrow(ThemeOpError);
    expect(() => ops.duplicateSection(d, "product", main.id)).toThrow(ThemeOpError);
  });

  it("change un réglage, réinitialise, applique un préréglage", () => {
    const d = base();
    const faq = firstOf(d, "faq");
    const u = ops.updateSectionSetting(d, "home", faq.id, "heading", "Vos questions");
    expect(home(u).sections[faq.id].settings.heading).toBe("Vos questions");
    expect(() => ops.updateSectionSetting(d, "home", faq.id, "inconnu", 1)).toThrow(/Réglage inconnu/);
    const reset = ops.resetSectionSettings(u, "home", faq.id);
    expect(home(reset).sections[faq.id].settings.heading).toBe("Questions fréquentes");
    const preset = ops.applySectionPreset(u, "home", faq.id, 0, ids());
    expect(home(preset).sections[faq.id].id).toBe(faq.id);
    expect(home(preset).sections[faq.id].blocks).toHaveLength(SECTION_SCHEMAS.faq.presets[0].blocks!.length);
  });

  it("met à jour un réglage global par chemin, sans pollution de prototype", () => {
    const d = base();
    const u = ops.updateGlobalSetting(d, "colors.primary", "#123456");
    expect(u.settings.colors.primary).toBe("#123456");
    expect(d.settings.colors.primary).not.toBe("#123456");
    expect(ops.updateGlobalSetting(d, "header.announcement.text", "Promo").settings.header.announcement.text).toBe("Promo");
    expect(() => ops.updateGlobalSetting(d, "__proto__.polluted", 1)).toThrow(ThemeOpError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("opérations : blocs", () => {
  it("ajoute, déplace, duplique, masque et supprime un bloc", () => {
    const d = base();
    const faq = firstOf(d, "faq");
    const added = ops.addBlock(d, "home", faq.id, "question", { index: 0 });
    const s = home(added.doc).sections[faq.id];
    expect(s.blocks[0].id).toBe(added.id);
    expect(s.blocks[0].settings.question).toBe("Livrez-vous partout ?");
    const moved = ops.moveBlock(added.doc, "home", faq.id, added.id, 2);
    expect(home(moved).sections[faq.id].blocks[2].id).toBe(added.id);
    const dup = ops.duplicateBlock(moved, "home", faq.id, added.id);
    expect(home(dup.doc).sections[faq.id].blocks[3].id).toBe(dup.id);
    const hidden = ops.setBlockHidden(dup.doc, "home", faq.id, dup.id, true);
    expect(home(hidden).sections[faq.id].blocks[3].disabled).toBe(true);
    const removed = ops.removeBlock(hidden, "home", faq.id, dup.id);
    expect(home(removed).sections[faq.id].blocks.some((b) => b.id === dup.id)).toBe(false);
  });

  it("respecte maxBlocks de la section et limit du bloc", () => {
    let d = base();
    const hero = firstOf(d, "hero-banner"); // maxBlocks 5, bouton limit 2
    d = ops.addBlock(d, "home", hero.id, "button").doc; // 2 boutons
    expect(() => ops.addBlock(d, "home", hero.id, "button")).toThrow(/2 maximum/);
    d = ops.addBlock(d, "home", hero.id, "text").doc; // 5 blocs
    expect(() => ops.addBlock(d, "home", hero.id, "heading")).toThrow(/Maximum 5 blocs/);
    expect(() => ops.addBlock(base(), "home", hero.id, "slide")).toThrow(/pas disponible/);
  });
});

describe("validation du document", () => {
  it("accepte le document par défaut et complète les réglages manquants", () => {
    const d = clone(base());
    const faq = firstOf(d, "faq");
    delete faq.settings.padding_top;
    const v = validateThemeDocument(d);
    expect(v.ok).toBe(true);
    if (v.ok) expect(home(v.doc).sections[faq.id].settings.padding_top).toBe(48);
  });

  it("rejette sections, blocs et réglages inconnus", () => {
    const d1 = clone(base());
    (firstOf(d1, "faq") as { type: string }).type = "carrousel-3d";
    expect(validateThemeDocument(d1).ok).toBe(false);

    const d2 = clone(base());
    firstOf(d2, "faq").blocks.push({ id: "x-1", type: "slide", settings: {} });
    expect(validateThemeDocument(d2).ok).toBe(false);

    const d3 = clone(base());
    firstOf(d3, "faq").settings.onclick = "alert(1)";
    const v3 = validateThemeDocument(d3);
    expect(v3.ok).toBe(false);
    if (!v3.ok) expect(v3.errors[0].message).toMatch(/Réglage inconnu/);
  });

  it("rejette les dépassements de blocs et les sections obligatoires absentes ou masquées", () => {
    const d1 = clone(base());
    const hero = firstOf(d1, "hero-banner");
    hero.blocks = Array.from({ length: 6 }, (_, i) => ({ id: `t-${i}`, type: "text", settings: { text: "x" } }));
    expect(validateThemeDocument(d1).ok).toBe(false);

    const d2 = clone(base());
    const h2 = firstOf(d2, "hero-banner");
    h2.blocks = Array.from({ length: 3 }, (_, i) => ({ id: `b-${i}`, type: "button", settings: {} }));
    const v2 = validateThemeDocument(d2);
    expect(!v2.ok && v2.errors.some((e) => /Bouton/.test(e.message))).toBe(true);

    const d3 = clone(base());
    d3.templates.product = { order: [], sections: {} };
    const v3 = validateThemeDocument(d3);
    expect(!v3.ok && v3.errors.some((e) => /Fiche produit.*obligatoire/.test(e.message))).toBe(true);

    const d4 = clone(base());
    Object.values(d4.templates.product.sections).find((s) => s.type === "main-product")!.disabled = true;
    expect(validateThemeDocument(d4).ok).toBe(false);
  });

  it("rejette un ordre incohérent et une section non autorisée sur la page", () => {
    const d1 = clone(base());
    home(d1).order.push("fantome");
    expect(validateThemeDocument(d1).ok).toBe(false);
    const d2 = clone(base());
    const main = Object.values(d2.templates.cart.sections).find((s) => s.type === "main-cart")!;
    home(d2).sections[main.id] = main;
    home(d2).order.push(main.id);
    expect(validateThemeDocument(d2).ok).toBe(false);
  });

  it("valide couleurs, bornes et énumérations", () => {
    for (const bad of ["red", "#12345", "#1234567", "javascript:alert(1)"]) {
      const d = clone(base());
      d.settings.colors.primary = bad;
      expect(validateThemeDocument(d).ok).toBe(false);
    }
    const ok = clone(base());
    ok.settings.colors.primary = "#AbCdEf";
    expect(validateThemeDocument(ok).ok).toBe(true);

    const range = clone(base());
    firstOf(range, "faq").settings.padding_top = 999;
    const v = validateThemeDocument(range);
    expect(!v.ok && v.errors[0].message).toMatch(/maximum 160/);

    const sel = clone(base());
    firstOf(sel, "faq").settings.heading_size = "xxl";
    expect(validateThemeDocument(sel).ok).toBe(false);

    const scheme = clone(base());
    firstOf(scheme, "faq").settings.scheme = "inexistant";
    expect(validateThemeDocument(scheme).ok).toBe(false);
    firstOf(scheme, "faq").settings.scheme = scheme.settings.colors.schemes[0].id;
    expect(validateThemeDocument(scheme).ok).toBe(true);
  });

  it("n'accepte que des liens internes ou https", () => {
    expect(isSafeLink("/catalogue")).toBe(true);
    expect(isSafeLink("/collections/robes?tri=prix")).toBe(true);
    expect(isSafeLink("https://exemple.com/a")).toBe(true);
    for (const bad of ["http://exemple.com", "javascript:alert(1)", "//evil.com", "data:text/html,x", "/\\evil", "https://user:pw@x.com"]) expect(isSafeLink(bad)).toBe(false);

    const d = clone(base());
    const hero = firstOf(d, "hero-banner");
    hero.blocks.find((b) => b.type === "button")!.settings.button_link = "javascript:alert(1)";
    expect(validateThemeDocument(d).ok).toBe(false);
  });

  it("filtre images, vidéos et Markdown", () => {
    expect(isSafeImageUrl("https://cdn.exemple.com/a.jpg")).toBe(true);
    expect(isSafeImageUrl("data:image/webp;base64,AAAA")).toBe(true);
    expect(isSafeImageUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSafeImageUrl(`data:image/png;base64,${"A".repeat(420_000)}`)).toBe(false);
    expect(isSafeVideoUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isSafeVideoUrl("https://cdn.exemple.com/v.mp4")).toBe(true);
    expect(isSafeVideoUrl("https://exemple.com/page")).toBe(false);
    expect(isSafeMarkdown("**Gras** et [lien](/catalogue)")).toBe(true);
    expect(isSafeMarkdown("<script>alert(1)</script>")).toBe(false);
    expect(isSafeMarkdown("[x](javascript:alert(1))")).toBe(false);
  });

  it("vérifie l'appartenance des collections, produits et menus", () => {
    const d = clone(base());
    const fc = firstOf(d, "featured-collection");
    fc.settings.collection = "col_autre_boutique";
    const refs = collectReferences(d);
    expect(refs.collectionIds).toContain("col_autre_boutique");
    const v = validateThemeDocument(d, { refs: { collectionIds: new Set(["col_a"]), productIds: new Set(), menuHandles: new Set(["main", "footer"]) } });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(issueKey(v.errors[0].path)).toBe(`section:${fc.id}:collection`);
    const ok = validateThemeDocument(d, { refs: { collectionIds: new Set(["col_autre_boutique"]), productIds: new Set(), menuHandles: new Set(["main", "footer"]) } });
    expect(ok.ok).toBe(true);
    const menu = clone(base());
    menu.settings.header.menu = "inconnu";
    expect(validateThemeDocument(menu, { refs: { collectionIds: new Set(), productIds: new Set(), menuHandles: new Set(["main", "footer"]) } }).ok).toBe(false);
  });

  it("calcule les clés d'erreur de l'éditeur", () => {
    expect(issueKey(["settings", "colors", "primary"])).toBe("global:colors.primary");
    expect(issueKey(["templates", "home", "sections", "s1", "settings", "heading"])).toBe("section:s1:heading");
    expect(issueKey(["templates", "home", "sections", "s1", "blocks", 2, "settings", "text"])).toBe("block:s1:2:text");
  });
});

describe("limites de plan", () => {
  it("Gratuit : 2 modèles de départ, pas d'historique ; plans payants : tout", () => {
    const free = themePlanRules("FREE", "restaurant", "general");
    expect(free.presetLimit).toBe(2);
    expect(free.allowedPresets).toEqual(["general", "restaurant"]);
    expect(free.versionHistory).toBe(false);
    expect(free.versionsKept).toBe(VERSIONS_KEPT_BASIC);
    expect(canUsePreset("FREE", "restaurant", "general", "mode")).toBe(false);
    expect(canUsePreset("FREE", "restaurant", "general", "restaurant")).toBe(true);
    expect(canUsePreset("FREE", "restaurant", "mode", "mode")).toBe(true); // le modèle actuel reste utilisable
    expect(canRestoreVersions("FREE")).toBe(false);

    const starter = themePlanRules("STARTER", "general", "general");
    expect(starter.presetLimit).toBeNull();
    expect(canUsePreset("STARTER", "general", "general", "clinique")).toBe(true);

    expect(canRestoreVersions("BUSINESS")).toBe(true);
    expect(themePlanRules("BUSINESS", null, "general").versionsKept).toBe(VERSIONS_KEPT_ADVANCED);
  });
});

describe("historique annuler / rétablir", () => {
  it("regroupe les frappes rapides sur un même champ et rétablit", () => {
    let h = createHistory(0);
    h = pushHistory(h, 1, { coalesceKey: "a", now: 0 });
    h = pushHistory(h, 2, { coalesceKey: "a", now: 300 });
    h = pushHistory(h, 3, { coalesceKey: "b", now: 400 });
    expect(h.past).toEqual([0, 2]);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(0);
    h = redo(h);
    expect(h.present).toBe(2);
    h = pushHistory(h, 9);
    expect(h.future).toEqual([]);
  });
});

describe("contraste", () => {
  it("calcule le ratio WCAG", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});

describe("menus de navigation", () => {
  const items = [
    { id: "a", label: "Accueil", type: "home" },
    { id: "b", label: "Robes", type: "collection", target: "col1", children: [{ id: "c", label: "Promo", type: "url", target: "https://exemple.com" }] },
  ];

  it("accepte deux niveaux et vérifie les cibles", () => {
    expect(validateMenuItems(items).ok).toBe(true);
    const refs = { collectionIds: new Set(["col1"]), productIds: new Set<string>(), pageIds: new Set<string>() };
    expect(validateMenuItems(items, refs).ok).toBe(true);
    const other = validateMenuItems(items, { ...refs, collectionIds: new Set() });
    expect(other.ok).toBe(false);
  });

  it("refuse un troisième niveau, les URLs dangereuses, les libellés vides et les cibles manquantes", () => {
    const deep = [{ ...items[1], children: [{ id: "c", label: "x", type: "home", children: [{ id: "d", label: "y", type: "home" }] }] }];
    expect(validateMenuItems(deep).ok).toBe(false);
    expect(validateMenuItems([{ id: "a", label: "x", type: "url", target: "javascript:alert(1)" }]).ok).toBe(false);
    expect(validateMenuItems([{ id: "a", label: " ", type: "home" }]).ok).toBe(false);
    expect(validateMenuItems([{ id: "a", label: "x", type: "product" }]).ok).toBe(false);
    expect(validateMenuItems([{ id: "a", label: "x", type: "home" }, { id: "a", label: "y", type: "catalog" }]).ok).toBe(false);
  });

  it("lit un menu enregistré de façon tolérante", () => {
    expect(readMenuItems(null)).toEqual([]);
    expect(readMenuItems([{ id: "a", label: "Ok", type: "home" }, { bad: true }])).toEqual([{ id: "a", label: "Ok", type: "home" }]);
  });
});
