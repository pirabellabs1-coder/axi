/**
 * Vague 2 : le modèle « Recherche » devient un vrai modèle de thème (section `main-search`).
 *  - enregistrement (schéma requis, rendu, sanitize) et édition dans l'éditeur ;
 *  - rendu : en-tête de résultats, filtres et tri du catalogue, suggestions, états vide ;
 *  - rétrocompatibilité : un document enregistré avec `main-collection` sur le modèle recherche est complété au
 *    chargement (rendu ET validation), sans jamais invalider un brouillon.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Le tri et les filtres sont des îlots clients (`FilterForm`) : routeur simulé pour un rendu serveur de test.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TemplateRenderer } from "@/components/storefront/template-renderer";
import { searchSuggestions } from "@/components/storefront/sections/main-search";
import { SECTION_SCHEMAS, sectionsForTemplate } from "@/lib/theme-engine/schemas";
import { SECTION_RENDERERS } from "@/lib/theme-engine/render-registry";
import { completeLateTemplates, EDITABLE_TEMPLATES, fallbackTemplate, migrateSearchTemplate } from "@/lib/theme-engine/editor-defaults";
import { buildSection, defaultGlobalSettings, defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { sanitizeSection, sanitizeThemeDocument } from "@/lib/storefront/theme-doc";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { computeFacets, parseCatalogParams } from "@/lib/storefront/catalog";
import type { CardProduct, ListingData, RenderData } from "@/lib/storefront/render-types";
import type { SectionInstance, Template, ThemeDocument } from "@/lib/theme-engine/types";

function card(over: Partial<CardProduct> = {}): CardProduct {
  return {
    id: "p1", slug: "pagne-wax", name: "Pagne wax", vendor: "Atelier Dantokpa", description: null, price: 12000, compareAt: null, range: false, discountPct: 0, soldOut: false,
    images: [], simple: true, unitPrice: 12000, minQty: 1, variantCount: 0, categoryId: null, tags: ["wax"], productType: "Tissu", options: [], isFeatured: false,
    position: 0, createdAt: "2026-01-01T00:00:00.000Z", isNew: false, sales: 0, rating: null, variants: [], ...over,
  };
}

const PRODUCTS = [
  card(),
  card({ id: "p2", slug: "robe-wax", name: "Robe en wax", tags: ["wax", "robe"], isFeatured: true }),
  card({ id: "p3", slug: "sac-raphia", name: "Sac raphia", tags: ["raphia"], productType: "Sac" }),
];

function listing(over: Partial<ListingData> = {}): ListingData {
  const params = parseCatalogParams({ q: "wax" });
  const ids = ["p1", "p2"];
  return {
    kind: "search", title: "Résultats pour « wax »", description: null, image: null, collectionId: null, query: params.q,
    productIds: ids, total: ids.length, page: 1, pages: 1, perPage: 24, facets: computeFacets(PRODUCTS, []), params, basePath: "/s/dantokpa/recherche",
    ...over,
  };
}

function data(over: Partial<RenderData> = {}): RenderData {
  return {
    store: { id: "s1", slug: "dantokpa", name: "Dantokpa", tagline: null, description: null, logoUrl: null, bannerUrl: null, city: null, address: null, phone: null, email: null, whatsappNumber: null, whatsappOrdering: false, currency: "XOF", closed: false, unpublished: false, booking: false, sector: "general", copy: { addLabel: "Ajouter", searchPlaceholder: "Rechercher un article", catalogTitle: "Catalogue", featuredTitle: "Sélection", emptyCatalog: "Rien ici", pickupTitle: "Retrait" } as RenderData["store"]["copy"], openNow: null, hours: [], todayIndex: 0, deliveryEnabled: false, pickupEnabled: false, deliveryZones: [], freeShippingFrom: null, paymentLabels: [], showPoweredBy: false, loyalty: null, metaPixelId: null, gaMeasurementId: null },
    now: "2026-10-11T10:00:00.000Z",
    collections: [{ id: "c1", handle: "pagnes", name: "Pagnes", description: null, image: null, seoTitle: null, seoDescription: null, sortOrder: "manual", productIds: ["p1", "p2"] }],
    products: Object.fromEntries(PRODUCTS.map((p) => [p.id, p])),
    allProductIds: PRODUCTS.map((p) => p.id),
    menus: {},
    reviews: { summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }, items: [], page: 1, pages: 1, rating: null, productScoped: false },
    pages: [],
    listing: listing(),
    ...over,
  };
}

function searchDoc(settings: SectionInstance["settings"] = {}): ThemeDocument {
  const s = buildSection("main", "main-search", settings);
  const tpl: Template = { order: [s.id], sections: { [s.id]: s } };
  const empty: Template = { order: [], sections: {} };
  return {
    version: 2,
    preset: "general",
    settings: defaultGlobalSettings("general"),
    templates: { home: empty, product: empty, collection: empty, catalog: empty, page: empty, cart: empty, search: tpl, not_found: empty, blog: empty, article: empty },
  };
}

const render = (d: ThemeDocument, rd: RenderData) => renderToStaticMarkup(createElement(TemplateRenderer, { doc: d, template: "search", data: rd }));

/** Document « ancien » : modèle recherche basé sur `main-collection`, comme avant la vague 2. */
function legacyDoc(): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(defaultThemeDocument("mode"))) as ThemeDocument & { templates: Record<string, Template> };
  const legacy = buildSection("main", "main-collection", { show_banner: true, show_filters: false, show_sort: true, per_page: 12, columns: "3" });
  doc.templates.search = { order: [legacy.id], sections: { [legacy.id]: legacy } };
  return doc as unknown as Record<string, unknown>;
}

describe("enregistrement de la section « Recherche »", () => {
  it("schéma obligatoire du modèle search, rendu enregistré, sanitize accepté", () => {
    const schema = SECTION_SCHEMAS["main-search"];
    expect(schema?.required).toBe(true);
    expect(schema.templates).toEqual(["search"]);
    expect(schema.category).toBe("Modèle");
    expect(SECTION_RENDERERS["main-search"]).toBeTypeOf("function");
    expect(sanitizeSection({ id: "x", type: "main-search", settings: {}, blocks: [] })?.type).toBe("main-search");
  });

  it("la section « Collection » n'est plus proposée sur le modèle recherche", () => {
    const types = sectionsForTemplate("search").map((s) => s.type);
    expect(types).toContain("main-search");
    expect(types).not.toContain("main-collection");
    // …et reste disponible sur collection et catalogue.
    expect(sectionsForTemplate("collection").map((s) => s.type)).toContain("main-collection");
    expect(sectionsForTemplate("catalog").map((s) => s.type)).toContain("main-collection");
  });

  it("le modèle « Recherche » est éditable et présent dans les défauts de chaque secteur", () => {
    expect(EDITABLE_TEMPLATES.map((t) => t.id)).toContain("search");
    for (const sector of ["general", "mode", "restaurant", "beaute", "salon", "clinique", "patisserie", "epicerie"]) {
      const d = defaultThemeDocument(sector);
      const types = Object.values(d.templates.search.sections).map((s) => s.type);
      expect(types).toEqual(["main-search"]);
    }
    expect(Object.values(fallbackTemplate("search").sections).map((s) => s.type)).toEqual(["main-search"]);
  });
});

describe("rendu de la recherche", () => {
  it("en-tête de résultats, champ de recherche, tri et grille", () => {
    const html = render(searchDoc(), data());
    expect(html).toContain("2 résultats");
    expect(html).toContain("wax");
    expect(html).toContain('role="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('name="tri"');
    expect(html).toContain("/s/dantokpa/p/robe-wax");
  });

  it("une seule occurrence : « 1 résultat » au singulier", () => {
    const d = data({ listing: listing({ productIds: ["p1"], total: 1 }) });
    expect(render(searchDoc(), d)).toContain("1 résultat pour");
  });

  it("sans résultat : message, filtres retirables et contenu de secours", () => {
    const params = parseCatalogParams({ q: "chaussure" });
    const d = data({ listing: listing({ productIds: [], total: 0, query: "chaussure", params }) });
    const html = render(searchDoc(), d);
    expect(html).toContain("Aucun résultat");
    expect(html).toContain("Voir tout le catalogue");
    expect(html).toContain("Les plus demandés");
    expect(html).toContain("Pagnes"); // collection à parcourir
  });

  it("avant toute recherche : champ seul + collections et produits mis en avant", () => {
    const params = parseCatalogParams({});
    const d = data({ listing: listing({ productIds: [], total: 0, query: "", params, title: "Rechercher" }) });
    const html = render(searchDoc(), d);
    expect(html).toContain("Rechercher");
    expect(html).toContain("Parcourir");
    expect(html).not.toContain("Aucun résultat");
  });

  it("réglages respectés : titre, tri et filtres masqués, état vide « rien »", () => {
    const params = parseCatalogParams({});
    const d = data({ listing: listing({ productIds: [], total: 0, query: "", params }) });
    const html = render(searchDoc({ heading: "Que cherchez-vous ?", show_sort: false, show_filters: false, empty_content: "none" }), d);
    expect(html).toContain("Que cherchez-vous ?");
    expect(html).not.toContain('name="tri"');
    expect(html).not.toContain("Parcourir");
  });

  it("suggestions : mots proches du catalogue, aucune sur une requête trop courte", () => {
    expect(searchSuggestions(PRODUCTS, "wa")).toContain("wax");
    expect(searchSuggestions(PRODUCTS, "raphi")).toContain("raphia");
    expect(searchSuggestions(PRODUCTS, "w")).toEqual([]);
    // Affichées dans le rendu quand les résultats sont rares.
    const params = parseCatalogParams({ q: "raphi" });
    const d = data({ listing: listing({ productIds: [], total: 0, query: "raphi", params }) });
    expect(render(searchDoc(), d)).toContain("Essayez aussi");
  });
});

describe("rétrocompatibilité des documents de thème", () => {
  it("un modèle recherche en `main-collection` est migré en `main-search` avec ses réglages", () => {
    const migrated = migrateSearchTemplate(legacyDoc()) as ThemeDocument;
    const tpl = migrated.templates.search;
    const sections = Object.values(tpl.sections);
    expect(sections.map((s) => s.type)).toEqual(["main-search"]);
    expect(tpl.order).toEqual([sections[0].id]);
    expect(sections[0].settings.per_page).toBe(12);
    expect(sections[0].settings.columns).toBe("3");
    expect(sections[0].settings.show_filters).toBe(false);
    // Réglages propres à la nouvelle section : valeurs par défaut.
    expect(sections[0].settings.show_suggestions).toBe(true);
  });

  it("idempotent : un document déjà migré est renvoyé tel quel (même référence)", () => {
    const current = JSON.parse(JSON.stringify(defaultThemeDocument("general")));
    expect(migrateSearchTemplate(current)).toBe(current);
    const once = migrateSearchTemplate(legacyDoc());
    expect(migrateSearchTemplate(once)).toBe(once);
  });

  it("le rendu complète un ancien document sans perdre les autres modèles", () => {
    const sanitized = sanitizeThemeDocument(legacyDoc(), defaultThemeDocument("mode"));
    expect(Object.values(sanitized.templates.search.sections).map((s) => s.type)).toEqual(["main-search"]);
    expect(Object.values(sanitized.templates.search.sections)[0].settings.per_page).toBe(12);
    expect(Object.values(sanitized.templates.home.sections).length).toBeGreaterThan(1);
  });

  it("la validation accepte un ancien brouillon (jamais invalidé) et refuse `main-collection` sur la recherche", () => {
    const ok = validateThemeDocument(legacyDoc());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(Object.values(ok.doc.templates.search.sections).map((s) => s.type)).toEqual(["main-search"]);
    // Document qui contient DÉJÀ `main-search` : une section « Collection » en plus est refusée.
    const broken = JSON.parse(JSON.stringify(defaultThemeDocument("general"))) as ThemeDocument;
    const extra = buildSection("legacy", "main-collection", {});
    broken.templates.search.sections[extra.id] = extra;
    broken.templates.search.order.push(extra.id);
    expect(validateThemeDocument(broken).ok).toBe(false);
  });

  it("un document sans modèle recherche reste traité par les mécanismes existants", () => {
    const doc = JSON.parse(JSON.stringify(defaultThemeDocument("general"))) as unknown as { templates: Record<string, unknown> };
    delete doc.templates.search;
    const completed = completeLateTemplates(doc) as ThemeDocument;
    // `completeLateTemplates` ne crée que les modèles tardifs ; la validation réinjecte le défaut du modèle recherche.
    const r = validateThemeDocument(completed);
    expect(r.ok).toBe(false);
    const sanitized = sanitizeThemeDocument(doc, defaultThemeDocument("general"));
    expect(Object.values(sanitized.templates.search.sections).map((s) => s.type)).toEqual(["main-search"]);
  });
});
