import { describe, expect, it } from "vitest";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { adjustForContrast, computeScores, isDocumentFix, scoreTheme, type Issue, type QualityFacts } from "@/lib/theme-engine/quality";
import { applyOperations, setAtPath } from "@/lib/theme-engine/operations";
import { contrastRatio } from "@/lib/storefront/theme-doc";
import type { ThemeDocument } from "@/lib/theme-engine/types";

const base = () => defaultThemeDocument("general");
const rules = (doc: ThemeDocument, facts: QualityFacts = {}) => scoreTheme(doc, facts).issues.map((i) => i.rule);
const issue = (doc: ThemeDocument, rule: string, facts: QualityFacts = {}) => scoreTheme(doc, facts).issues.find((i) => i.rule === rule);

function withGlobal(doc: ThemeDocument, path: string, value: unknown): ThemeDocument {
  return { ...doc, settings: setAtPath(doc.settings, path, value) };
}

/** Applique la correction d'un problème, vérifie qu'il disparaît, que le document reste valide, puis réapplique (idempotence). */
function fixAndCheck(doc: ThemeDocument, i: Issue, facts: QualityFacts = {}): ThemeDocument {
  expect(isDocumentFix(i.fix)).toBe(true);
  if (!isDocumentFix(i.fix)) return doc;
  const r = applyOperations(doc, i.fix);
  expect(r.ok, JSON.stringify(!r.ok && r)).toBe(true);
  if (!r.ok) return doc;
  const after = scoreTheme(r.doc, facts).issues;
  expect(after.find((x) => x.id === i.id)).toBeUndefined();
  // Correction recalculée sur le document corrigé : plus rien à corriger pour cette règle et cette cible.
  expect(after.filter((x) => x.rule === i.rule && JSON.stringify(x.target) === JSON.stringify(i.target))).toEqual([]);
  return r.doc;
}

describe("scores", () => {
  it("bornés 0..100, document par défaut bien noté", () => {
    const { scores } = scoreTheme(base(), { hasWhatsapp: true });
    for (const v of Object.values(scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(scores.accessibility).toBeGreaterThanOrEqual(80);
  });
  it("pénalité plafonnée par règle", () => {
    const many: Issue[] = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, rule: "perf.image", category: "performance", severity: "warning", message: "" }));
    expect(computeScores(many).performance).toBe(84);
    expect(computeScores([]).seo).toBe(100);
  });
  it("tri : erreurs d'abord", () => {
    const doc = withGlobal(withGlobal(base(), "colors.text", "#f0f0f0"), "colors.primaryText", "#ffffff");
    const sev = scoreTheme(withGlobal(doc, "colors.primary", "#fefefe"), { storeDescription: "" }).issues.map((i) => i.severity);
    expect(sev.indexOf("error")).toBe(0);
    expect(sev.lastIndexOf("error")).toBeLessThan(sev.indexOf("warning"));
  });
});

describe("accessibilité", () => {
  it("contraste du texte : corrigé, même teinte si possible", () => {
    const doc = withGlobal(base(), "colors.text", "#cccccc");
    const i = issue(doc, "a11y.contrast.text")!;
    expect(i.severity).toBe("error");
    const fixed = fixAndCheck(doc, i);
    expect(contrastRatio(fixed.settings.colors.text, fixed.settings.colors.background)).toBeGreaterThanOrEqual(4.5);
  });
  it("contraste des boutons", () => {
    const doc = withGlobal(withGlobal(base(), "colors.primary", "#ffd400"), "colors.primaryText", "#ffffff");
    fixAndCheck(doc, issue(doc, "a11y.contrast.button")!);
  });
  it("texte secondaire et schémas", () => {
    let doc = withGlobal(base(), "colors.muted", "#dddddd");
    fixAndCheck(doc, issue(doc, "a11y.contrast.muted")!);
    doc = withGlobal(base(), "colors.schemes", [{ id: "pale", name: "Pâle", background: "#ffffff", text: "#eeeeee", primary: "#000000", primaryText: "#111111" }]);
    fixAndCheck(doc, issue(doc, "a11y.contrast.scheme")!);
  });
  it("adjustForContrast atteint le seuil", () => {
    for (const [fg, bg] of [["#777777", "#ffffff"], ["#336699", "#224466"], ["#ffffff", "#ffff00"]]) expect(contrastRatio(adjustForContrast(fg, bg), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("image sans alt (section) : alt = titre", () => {
    const doc = base();
    const hero = Object.values(doc.templates.home.sections).find((s) => s.type === "hero-banner")!;
    const d = { ...doc, templates: { ...doc.templates, home: { ...doc.templates.home, sections: { ...doc.templates.home.sections, [hero.id]: { ...hero, settings: { ...hero.settings, image: { url: "https://cdn.example.com/h.webp" } } } } } } };
    const i = scoreTheme(d).issues.find((x) => x.rule === "a11y.alt.section" && x.target?.sectionId === hero.id)!;
    const fixed = fixAndCheck(d, i);
    expect((fixed.templates.home.sections[hero.id].settings.image as { alt: string }).alt.length).toBeGreaterThan(0);
  });
  it("logo sans alt (nom de boutique), produits sans alt (action IA)", () => {
    const doc = withGlobal(base(), "header.logo", { url: "https://cdn.example.com/logo.webp" });
    fixAndCheck(doc, issue(doc, "a11y.alt.logo", { storeName: "Chez Aïcha" })!, { storeName: "Chez Aïcha" });
    const p = issue(base(), "a11y.alt.products", { productsWithoutAlt: [{ id: "p1", name: "Robe" }] })!;
    expect(p.fix).toEqual({ action: "ai_alt", productIds: ["p1"] });
  });
  it("plusieurs titres très grands en tête", () => {
    const doc = base();
    const [a, b] = doc.templates.home.order.slice(0, 2);
    const sections = { ...doc.templates.home.sections };
    sections[a] = { ...sections[a], type: "rich-text", settings: { heading_size: "xl" }, blocks: [] };
    sections[b] = { ...sections[b], type: "rich-text", settings: { heading_size: "xl" }, blocks: [] };
    const d: ThemeDocument = { ...doc, templates: { ...doc.templates, home: { ...doc.templates.home, sections } } };
    const i = scoreTheme(d).issues.find((x) => x.rule === "a11y.headings.xl")!;
    expect(isDocumentFix(i.fix) && i.fix).toHaveLength(1);
    const r = applyOperations(d, i.fix, { validate: false });
    expect(r.ok && rules(r.doc)).not.toContain("a11y.headings.xl");
  });
  it("bouton sans libellé", () => {
    const doc = base();
    const hero = Object.values(doc.templates.home.sections).find((s) => s.type === "hero-banner")!;
    const btn = hero.blocks.find((b) => b.type === "button")!;
    const blocks = hero.blocks.map((b) => (b.id === btn.id ? { ...b, settings: { ...b.settings, button_label: "" } } : b));
    const d = { ...doc, templates: { ...doc.templates, home: { ...doc.templates.home, sections: { ...doc.templates.home.sections, [hero.id]: { ...hero, blocks } } } } };
    fixAndCheck(d, scoreTheme(d).issues.find((x) => x.rule === "a11y.link.label")!);
  });
});

describe("performance", () => {
  it("image lourde : action de recompression ; data-URL mesurée", () => {
    const url = "https://cdn.example.com/lourde.jpg";
    const doc = withGlobal(base(), "header.logo", { url, alt: "Logo" });
    const i = issue(doc, "perf.image", { images: { [url]: { bytes: 900_000, width: 4000, height: 3000, format: "jpeg" } } })!;
    expect(i.severity).toBe("warning");
    expect(i.fix).toEqual({ action: "compress_image", url });
    expect(issue(doc, "perf.image", { images: { [url]: { bytes: 90_000, width: 800, height: 600, format: "webp" } } })).toBeUndefined();
    const data = `data:image/png;base64,${"A".repeat(600_000)}`;
    expect(issue(withGlobal(base(), "header.logo", { url: data, alt: "Logo" }), "perf.image")?.severity).toBe("warning");
  });
  it("diaporama et vidéo en lecture auto", () => {
    let doc = base();
    const r = applyOperations(doc, [
      { op: "addSection", template: "home", type: "slideshow" },
      { op: "addSection", template: "home", type: "video" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    doc = r.doc;
    const [slideId, videoId] = r.created;
    const more = applyOperations(doc, [
      { op: "addBlock", template: "home", sectionId: slideId, type: "slide" },
      { op: "addBlock", template: "home", sectionId: slideId, type: "slide" },
      { op: "updateSectionSetting", template: "home", sectionId: videoId, key: "autoplay", value: true },
    ]);
    expect(more.ok).toBe(true);
    if (!more.ok) return;
    fixAndCheck(more.doc, issue(more.doc, "perf.slideshow.autoplay")!);
    fixAndCheck(more.doc, issue(more.doc, "perf.video.autoplay")!);
  });
  it("plus de 15 sections à l'accueil : masquer l'excédent", () => {
    const ops = Array.from({ length: 12 }, () => ({ op: "addSection" as const, template: "home" as const, type: "custom-spacer" as const }));
    const r = applyOperations(base(), ops);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const i = issue(r.doc, "perf.home.sections")!;
    const fixed = fixAndCheck(r.doc, i);
    expect(fixed.templates.home.order.filter((id) => !fixed.templates.home.sections[id].disabled)).toHaveLength(15);
  });
});

describe("SEO", () => {
  it("description courte, collections, titres SEO : actions IA", () => {
    expect(issue(base(), "seo.store.description", { storeDescription: "Boutique" })?.fix).toEqual({ action: "ai_seo", target: "store_description" });
    expect(issue(base(), "seo.store.description", { storeDescription: "x".repeat(60) })).toBeUndefined();
    expect(issue(base(), "seo.store.description")).toBeUndefined(); // fait absent : règle non évaluée
    expect(issue(base(), "seo.collection.description", { collectionsWithoutDescription: [{ id: "c1", name: "Robes" }] })?.fix).toMatchObject({ ids: ["c1"] });
    expect(issue(base(), "seo.product.seo_title", { productsWithLongSeoTitle: [{ id: "p1", name: "X", length: 80 }] })).toBeDefined();
  });
  it("image de partage : le logo", () => {
    const doc = withGlobal(withGlobal(base(), "header.logo", { url: "https://cdn.example.com/l.webp", alt: "L" }), "social.shareImage", null);
    fixAndCheck(doc, issue(doc, "seo.share_image")!);
    expect(issue(withGlobal(base(), "social.shareImage", null), "seo.share_image")?.fix).toBeUndefined();
  });
});

describe("conversion", () => {
  function homeWithout(types: string[]): ThemeDocument {
    const doc = base();
    const home = doc.templates.home;
    const order = home.order.filter((id) => !types.includes(home.sections[id].type));
    return { ...doc, templates: { ...doc.templates, home: { order, sections: Object.fromEntries(order.map((id) => [id, home.sections[id]])) } } };
  }
  function productWithoutBlocks(doc: ThemeDocument, types: string[]): ThemeDocument {
    const p = doc.templates.product;
    const sections = Object.fromEntries(Object.entries(p.sections).map(([id, s]) => [id, s.type === "main-product" ? { ...s, blocks: s.blocks.filter((b) => !types.includes(b.type)) } : s]));
    return { ...doc, templates: { ...doc.templates, product: { ...p, sections } } };
  }
  it("pas d'appel WhatsApp : ajouter la section", () => {
    const doc = productWithoutBlocks(homeWithout(["whatsapp-cta"]), ["buy_buttons"]);
    fixAndCheck(doc, issue(doc, "conv.whatsapp")!);
    expect(issue(doc, "conv.whatsapp", { hasWhatsapp: false })?.fix).toBeUndefined();
  });
  it("pas de garanties", () => {
    const doc = productWithoutBlocks(homeWithout(["trust-badges"]), ["trust"]);
    fixAndCheck(doc, issue(doc, "conv.trust")!);
  });
  it("avis existants non affichés", () => {
    const doc = productWithoutBlocks(homeWithout(["reviews", "testimonials"]), ["rating"]);
    expect(issue(doc, "conv.reviews")).toBeUndefined();
    fixAndCheck(doc, issue(doc, "conv.reviews", { reviewCount: 4 })!, { reviewCount: 4 });
  });
  it("annonce trop longue", () => {
    const doc = withGlobal(withGlobal(base(), "header.announcement.enabled", true), "header.announcement.text", "Livraison offerte ".repeat(9).trim());
    const fixed = fixAndCheck(doc, issue(doc, "conv.announcement.length")!);
    expect(fixed.settings.header.announcement.text.length).toBeLessThanOrEqual(120);
  });
  it("prix masqué : bloc réaffiché ou ajouté", () => {
    const doc = base();
    const main = Object.values(doc.templates.product.sections).find((s) => s.type === "main-product")!;
    const hidden = { ...doc, templates: { ...doc.templates, product: { ...doc.templates.product, sections: { ...doc.templates.product.sections, [main.id]: { ...main, blocks: main.blocks.map((b) => (b.type === "price" ? { ...b, disabled: true } : b)) } } } } };
    fixAndCheck(hidden, issue(hidden, "conv.price_hidden")!);
    const removed = productWithoutBlocks(base(), ["price"]);
    const i = issue(removed, "conv.price_hidden")!;
    expect(i.severity).toBe("error");
    fixAndCheck(removed, i);
  });
});
