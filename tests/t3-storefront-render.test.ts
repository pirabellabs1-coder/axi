/**
 * Lot 4A, équipe T3 (rendu boutique) : nouvelles sections, sources dynamiques, audience, animations, modèles alternatifs.
 * Rendu réel de `TemplateRenderer` (react-dom/server) sur des données de rendu minimales.
 */
import { describe, expect, it, vi } from "vitest";

// Certains modules partagés de la chaîne des sections sont marqués « server-only » (sans effet en test).
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TemplateRenderer } from "@/components/storefront/template-renderer";
import { specRows } from "@/components/storefront/sections/product-specs";
import { sizeTable } from "@/components/storefront/sections/size-guide";
import { comparison, parseCell } from "@/components/storefront/sections/comparison-table";
import { parsePreviewAudience, parseReduceMotion } from "@/components/storefront/preview-audience";
import { dynamicContextFromData } from "@/components/storefront/dynamic-context";
import { sectionAnimAttrs } from "@/components/storefront/ui";
import { isAmbientVideoUrl } from "@/components/storefront/ambient-video";
import { effectiveMotion, motionEnvFromRequest } from "@/lib/theme-engine/motion";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { SECTION_RENDERERS } from "@/lib/theme-engine/render-registry";
import { T3_SECTION_TYPES } from "@/lib/theme-engine/section-schemas/_t3-sections";
import { sanitizeSection } from "@/lib/storefront/theme-doc";
import { defaultGlobalSettings } from "@/lib/theme-engine/defaults";
import type { RenderData } from "@/lib/storefront/render-types";
import type { RenderCtx } from "@/components/storefront/render-context";
import type { SectionInstance, Template, ThemeDocument } from "@/lib/theme-engine/types";
import type { RenderMetafield } from "@/components/storefront/lot4-types";

const mf = (name: string, type: string, value: unknown, text: string, extra: Partial<RenderMetafield> = {}): RenderMetafield => ({ namespace: "custom", key: name.toLowerCase(), name, type, value, storefrontVisible: true, text, url: null, image: null, ...extra });

function data(over: Partial<RenderData> = {}): RenderData {
  return {
    store: { id: "s1", slug: "chez-aicha", name: "Chez Aïcha", tagline: null, description: "Cuisine maison", logoUrl: null, bannerUrl: null, city: "Cotonou", address: null, phone: null, email: null, whatsappNumber: null, whatsappOrdering: false, currency: "XOF", closed: false, unpublished: false, booking: false, sector: "general", copy: {} as RenderData["store"]["copy"], openNow: null, hours: [], todayIndex: 0, deliveryEnabled: false, pickupEnabled: false, deliveryZones: [], freeShippingFrom: null, paymentLabels: [], showPoweredBy: false, loyalty: null, metaPixelId: null, gaMeasurementId: null },
    now: "2026-10-11T10:00:00.000Z",
    collections: [],
    products: {},
    allProductIds: [],
    menus: {},
    reviews: { summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }, items: [], page: 1, pages: 1, rating: null, productScoped: false },
    pages: [],
    product: {
      id: "p1", slug: "pagne-wax", name: "Pagne wax", vendor: "Atelier Dantokpa", productType: null, description: "Coton imprimé", images: [], basePrice: 12000, compareAt: null, sku: null, trackStock: false, stock: null, inStock: true, backorder: false, continueSelling: false, lowStock: false, minQty: 1, maxQty: null, options: [], variants: [], optionGroups: [], details: [], tags: [], collection: null, rating: null, requestedVariantId: null, url: "/s/chez-aicha/p/pagne-wax",
    },
    metafields: { product: { "custom.matiere": mf("Matière", "single_line_text", "Coton", "Coton"), "custom.lavage": mf("Lavage", "boolean", true, "Oui") } },
    ...over,
  };
}

function section(type: SectionInstance["type"], settings: SectionInstance["settings"] = {}, blocks: SectionInstance["blocks"] = [], extra: Partial<SectionInstance> = {}): SectionInstance {
  const s = sanitizeSection({ id: `${type}-1`, type, settings, blocks });
  if (!s) throw new Error(`section ${type} refusée`);
  return { ...s, ...extra };
}

function doc(sections: SectionInstance[], over: Partial<ThemeDocument> = {}): ThemeDocument {
  const tpl: Template = { order: sections.map((s) => s.id), sections: Object.fromEntries(sections.map((s) => [s.id, s])) };
  const empty: Template = { order: [], sections: {} };
  return {
    version: 2,
    preset: "general",
    settings: { ...defaultGlobalSettings("general"), motion: { preset: "subtle", reveal: true, parallax: false, hoverZoom: true } },
    templates: { home: tpl, product: tpl, collection: empty, catalog: empty, page: empty, cart: empty, search: empty, not_found: empty, blog: empty, article: empty },
    ...over,
  };
}

const render = (d: ThemeDocument, rd: RenderData, props: Partial<Parameters<typeof TemplateRenderer>[0]> = {}) => renderToStaticMarkup(createElement(TemplateRenderer, { doc: d, template: "product", data: rd, ...props }));

describe("enregistrement des sections T3", () => {
  it("chaque type a un schéma, un rendu, et passe le sanitize", () => {
    for (const t of T3_SECTION_TYPES) {
      expect(SECTION_SCHEMAS[t]?.type).toBe(t);
      expect(SECTION_RENDERERS[t]).toBeTypeOf("function");
      expect(sanitizeSection({ id: "x", type: t, settings: {}, blocks: [] })?.type).toBe(t);
    }
  });
});

describe("product-specs", () => {
  it("mode automatique : champs publics du produit, puis lignes manuelles ; lignes vides omises", () => {
    const rows = specRows({ auto: true }, [{ id: "b1", type: "row", settings: { label: "Origine", value: "Bénin" } }, { id: "b2", type: "row", settings: { label: "Vide", value: "" } }], data());
    expect(rows.map((r) => [r.label, r.text])).toEqual([["Matière", "Coton"], ["Lavage", "Oui"], ["Origine", "Bénin"]]);
  });
  it("sans donnée : section masquée en boutique", () => {
    const html = render(doc([section("product-specs", { auto: true })]), data({ metafields: {} }));
    expect(html).toBe("");
  });
  it("rendu en tableau accessible (en-têtes de ligne)", () => {
    const html = render(doc([section("product-specs", { heading: "Détails" })]), data());
    expect(html).toContain('<th scope="row"');
    expect(html).toContain("Matière");
    expect(html).toContain("Coton");
  });
});

describe("sources dynamiques au rendu", () => {
  const bound = (src: string) => section("product-specs", { auto: false }, [{ id: "r1", type: "row", settings: { label: "Matière", value: { $source: src } } }]);
  it("valeur résolue depuis un champ personnalisé public", () => {
    expect(render(doc([bound("product.metafields.custom.matiere")]), data())).toContain("Coton");
  });
  it("champ absent : défaut du champ (ligne vide omise, section masquée)", () => {
    expect(render(doc([bound("product.metafields.custom.inconnu")]), data())).toBe("");
  });
  it("champ non public jamais exposé, même transmis par erreur", () => {
    const rd = data({ metafields: { product: { "custom.matiere": { ...mf("Matière", "single_line_text", "Secret", "Secret"), storefrontVisible: false as true } } } });
    expect(render(doc([bound("product.metafields.custom.matiere")]), rd)).not.toContain("Secret");
  });
  it("hide_if_empty masque la section dont une source est vide", () => {
    const rich = section("rich-text", { hide_if_empty: true }, [{ id: "t", type: "heading", settings: { text: { $source: "product.vendor" } } }]);
    // `hide_if_empty` n'est pas un réglage de schéma : on le pose après sanitize (comme le ferait un schéma qui le déclare).
    const withFlag = { ...rich, settings: { ...rich.settings, hide_if_empty: true } };
    const rd = data();
    expect(render(doc([withFlag]), rd)).toContain("Atelier Dantokpa");
    rd.product!.vendor = null;
    expect(render(doc([withFlag]), rd)).toBe("");
  });
  it("contexte : produit, variante, boutique, références résolues dans la boutique", () => {
    const rd = data({ products: { p2: { slug: "boubou" } as RenderData["products"][string] } });
    const ctx = dynamicContextFromData(rd);
    expect(ctx.product?.title).toBe("Pagne wax");
    expect(ctx.store?.title).toBe("Chez Aïcha");
    expect(ctx.resolveReference?.("product_reference", "p2")).toBe("/s/chez-aicha/p/boubou");
    expect(ctx.resolveReference?.("product_reference", "absent")).toBeNull();
  });
});

describe("visibilité par audience (côté serveur)", () => {
  const loyalOnly = section("size-guide", {}, [{ id: "z", type: "size", settings: { size: "M", v1: "90" } }], { visibility: { match: "all", mode: "show", rules: [{ type: "customer", values: ["loyal"] }] } });
  it("section réservée aux fidèles : invisible en anonyme, visible pour un fidèle", () => {
    expect(render(doc([loyalOnly]), data(), { audience: { customer: ["anonymous"] } })).toBe("");
    expect(render(doc([loyalOnly]), data(), { audience: { customer: ["returning", "loyal"] } })).toContain("Guide des tailles");
  });
  it("robots : audience par défaut (anti-cloaking)", () => {
    expect(render(doc([loyalOnly]), data(), { audience: { customer: ["loyal"], isBot: true } })).toBe("");
  });
  it("sans contexte : visiteur anonyme en accès direct", () => {
    expect(render(doc([loyalOnly]), data())).toBe("");
  });
  it("aperçu : audience simulée lue défensivement", () => {
    const now = new Date();
    expect(parsePreviewAudience({ type: "axi:other" }, { now })).toBeUndefined();
    expect(parsePreviewAudience({ type: "axi:preview-audience", audience: null }, { now })?.customer).toEqual(["anonymous"]);
    const a = parsePreviewAudience({ type: "axi:preview-audience", audience: { customer: ["loyal", "pirate"], source: "tiktok", device: "tablette", city: "Porto-Novo" } }, { now });
    expect(a).toMatchObject({ customer: ["loyal"], source: "tiktok", device: null, city: "Porto-Novo" });
    expect(parseReduceMotion({ type: "axi:preview-options", reduceMotion: true })).toBe(true);
    expect(parseReduceMotion({ type: "axi:preview-options", allowNavigation: true })).toBeUndefined();
  });
});

describe("animations", () => {
  const ctx = (motion: ReturnType<typeof effectiveMotion>, first = false) => ({ motion, first }) as unknown as RenderCtx;
  const s = section("size-guide", {}, [{ id: "z", type: "size", settings: { size: "M", v1: "90" } }]);
  it("Save-Data, mode économie, aperçu réduit : aucun attribut d'animation", () => {
    for (const env of [motionEnvFromRequest({ saveDataHeader: "on" }), motionEnvFromRequest({ liteCookie: "1" }), { reduce: true }]) {
      expect(sectionAnimAttrs(s, ctx(effectiveMotion(undefined, env)))).toEqual({});
    }
    const html = render(doc([section("rich-text", {}, [{ id: "h", type: "heading", settings: { text: "A" } }]), s]), data(), { motionEnv: { saveData: true } });
    expect(html).not.toContain("data-anim");
  });
  it("défaut : apparition, jamais sur la première section ni sur une section de modèle (LCP)", () => {
    const m = effectiveMotion(undefined);
    expect(sectionAnimAttrs(s, ctx(m))).toEqual({ "data-anim": "fade-up", "data-anim-self": "" });
    expect(sectionAnimAttrs(s, ctx(m, true))).toEqual({});
    expect(sectionAnimAttrs(section("main-product"), ctx(m))).toEqual({});
    const html = render(doc([section("rich-text", {}, [{ id: "h", type: "heading", settings: { text: "A" } }]), s]), data());
    expect(html.match(/data-anim="fade-up"/g)?.length).toBe(1);
  });
});

describe("modèles alternatifs", () => {
  it("templateSuffix choisit alternates.product[suffix], suffixe inconnu = modèle par défaut", () => {
    const base = doc([section("size-guide", { heading: "Défaut" }, [{ id: "z", type: "size", settings: { size: "M" } }])]);
    const luxe = section("comparison-table", { heading: "Luxe" }, [{ id: "r", type: "row", settings: { label: "Critère", v1: "oui", v2: "non" } }]);
    const d = { ...base, alternates: { product: { luxe: { order: [luxe.id], sections: { [luxe.id]: luxe } } } } };
    expect(render(d, data(), { templateSuffix: "luxe" })).toContain("Luxe");
    expect(render(d, data(), { templateSuffix: "absent" })).toContain("Défaut");
  });
});

describe("sections premium (données)", () => {
  it("guide des tailles : colonnes nommées seulement", () => {
    const t = sizeTable({ col_1: "Poitrine", col_2: "", col_3: "Hanches", unit: "cm" }, [{ id: "a", type: "size", settings: { size: "S", v1: "84", v2: "x", v3: "90" } }, { id: "b", type: "size", settings: { size: "" } }]);
    expect(t).toEqual({ columns: ["Poitrine", "Hanches"], unit: "cm", rows: [{ id: "a", size: "S", values: ["84", "90"] }] });
  });
  it("tableau comparatif : oui / non en coche / croix, colonne mise en avant", () => {
    expect(parseCell(" Oui ")).toEqual({ kind: "yes" });
    expect(parseCell("non")).toEqual({ kind: "no" });
    expect(parseCell("Parfois")).toEqual({ kind: "text", text: "Parfois" });
    const c = comparison({ col_1: "Nous", col_2: "Eux", col_3: "", highlight: "2" }, [{ id: "r", type: "row", settings: { label: "Livraison", v1: "oui", v2: "non" } }]);
    expect(c.highlight).toBe(1);
    const html = render(doc([section("comparison-table", { col_1: "Nous", col_2: "Eux" }, [{ id: "r", type: "row", settings: { label: "Livraison", v1: "oui", v2: "non" } }])]), data());
    expect(html).toContain('<span class="sr-only">Oui</span>');
    expect(html).toContain('scope="col"');
  });
  it("bandeau défilant : la copie de boucle est masquée aux lecteurs d'écran et hors tabulation", () => {
    const html = render(doc([section("marquee", {}, [{ id: "i", type: "item", settings: { text: "Paiement Mobile Money", link: "/catalogue" } }])]), data());
    expect(html.match(/Paiement Mobile Money/g)?.length).toBe(2);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
  });
  it("vidéo d'ambiance : fichiers directs https uniquement", () => {
    expect(isAmbientVideoUrl("https://cdn.exemple.com/a.mp4")).toBe(true);
    expect(isAmbientVideoUrl("https://www.youtube.com/watch?v=x")).toBe(false);
    expect(isAmbientVideoUrl("http://exemple.com/a.mp4")).toBe(false);
  });
  it("avant / après : masqué sans les deux images ; curseur range accessible sinon", () => {
    expect(render(doc([section("before-after")]), data())).toBe("");
    const img = (u: string) => ({ url: u, alt: "" });
    const html = render(doc([section("before-after", { before: img("https://exemple.com/a.jpg"), after: img("https://exemple.com/b.jpg") })]), data());
    expect(html).toContain('type="range"');
    expect(html).toContain("sr-only");
  });
});
