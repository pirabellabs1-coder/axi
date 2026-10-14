/**
 * Lot 4D, équipe CAN : sections « Vidéo achetable » (§17), « Stories » (§17) et « Direct » (§18).
 * Rendu réel (react-dom/server) sur des données de rendu minimales, comme `t3-storefront-render.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

// Modules partagés marqués « server-only » (sans effet en test).
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TemplateRenderer } from "@/components/storefront/template-renderer";
import { StoryViewer } from "@/components/storefront/live/stories-strip";
import { isDirectVideoUrl } from "@/components/storefront/sections/shoppable-video";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { SECTION_RENDERERS } from "@/lib/theme-engine/render-registry";
import { CAN_SECTION_TYPES } from "@/lib/theme-engine/section-schemas/_can-sections";
import { sanitizeSection } from "@/lib/storefront/theme-doc";
import { defaultGlobalSettings } from "@/lib/theme-engine/defaults";
import type { CardProduct, RenderData } from "@/lib/storefront/render-types";
import type { BlockInstance, SectionInstance, Template, ThemeDocument } from "@/lib/theme-engine/types";

const product = (over: Partial<CardProduct> = {}): CardProduct => ({
  id: "p1", slug: "pagne-wax", name: "Pagne wax", vendor: null, description: null, price: 12000, compareAt: null, range: false, discountPct: 0, soldOut: false,
  images: [{ url: "https://images.unsplash.com/photo-1?w=800" }], simple: true, unitPrice: 12000, minQty: 1, variantCount: 0, categoryId: null, tags: [], productType: null,
  options: [], isFeatured: false, position: 0, createdAt: "2026-01-01T00:00:00.000Z", isNew: false, sales: 0, rating: null, variants: [], ...over,
});

function data(over: Partial<RenderData> = {}): RenderData {
  const p1 = product();
  const p2 = product({ id: "p2", slug: "robe-bazin", name: "Robe bazin", price: 25000, compareAt: 30000 });
  return {
    store: {
      id: "s1", slug: "chez-aicha", name: "Chez Aïcha", tagline: null, description: null, logoUrl: null, bannerUrl: null, city: "Cotonou", address: null, phone: null, email: null,
      whatsappNumber: "22997000000", whatsappOrdering: true, currency: "XOF", closed: false, unpublished: false, booking: false, sector: "general",
      copy: { addLabel: "Ajouter" } as RenderData["store"]["copy"], openNow: null, hours: [], todayIndex: 0, deliveryEnabled: false, pickupEnabled: false, deliveryZones: [],
      freeShippingFrom: null, paymentLabels: [], showPoweredBy: false, loyalty: null, metaPixelId: null, gaMeasurementId: null,
    },
    now: "2026-10-12T10:00:00.000Z",
    collections: [],
    products: { p1, p2 },
    allProductIds: ["p1", "p2"],
    menus: {},
    reviews: { summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }, items: [], page: 1, pages: 1, rating: null, productScoped: false },
    pages: [],
    ...over,
  } as RenderData;
}

function section(type: SectionInstance["type"], settings: SectionInstance["settings"] = {}, blocks: SectionInstance["blocks"] = []): SectionInstance {
  const s = sanitizeSection({ id: `${type}-1`, type, settings, blocks });
  if (!s) throw new Error(`section ${type} refusée`);
  return s;
}

function doc(sections: SectionInstance[]): ThemeDocument {
  const tpl: Template = { order: sections.map((s) => s.id), sections: Object.fromEntries(sections.map((s) => [s.id, s])) };
  const empty: Template = { order: [], sections: {} };
  return {
    version: 2,
    preset: "general",
    settings: defaultGlobalSettings("general"),
    templates: { home: tpl, product: empty, collection: empty, catalog: empty, page: empty, cart: empty, search: empty, not_found: empty, blog: empty, article: empty },
  };
}

const render = (sections: SectionInstance[], rd: RenderData = data(), props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TemplateRenderer, { doc: doc(sections), template: "home", data: rd, ...props } as Parameters<typeof TemplateRenderer>[0]));

const VIDEO = "https://cdn.example.com/live.mp4";

describe("enregistrement des sections CAN", () => {
  it("chaque type a un schéma, un rendu, et passe le sanitize", () => {
    expect(CAN_SECTION_TYPES).toEqual(["shoppable-video", "stories", "live-shopping"]);
    for (const t of CAN_SECTION_TYPES) {
      expect(SECTION_SCHEMAS[t]?.type).toBe(t);
      expect(SECTION_RENDERERS[t]).toBeTypeOf("function");
      expect(sanitizeSection({ id: "x", type: t, settings: {}, blocks: [] })?.type).toBe(t);
    }
  });
});

describe("vidéo achetable (§17)", () => {
  const blocks: BlockInstance[] = [
    { id: "b1", type: "tagged_product", settings: { product: "p2", at: 12 } },
    { id: "b2", type: "tagged_product", settings: { product: "p1", at: 3, note: "taille M" } },
  ];

  it("liste les produits étiquetés dans l'ordre d'apparition, avec prix et lien WhatsApp", () => {
    const html = render([section("shoppable-video", { video: VIDEO, poster: { url: "https://images.unsplash.com/cover" }, heading: "Vu dans la vidéo" }, blocks)]);
    expect(html.indexOf("Pagne wax")).toBeLessThan(html.indexOf("Robe bazin")); // 3 s avant 12 s
    expect(html).toMatch(/12\s000\s?FCFA/u); // espaces insécables du format français
    expect(html).toContain("taille M");
    expect(html).toContain("https://wa.me/22997000000");
    expect(html).toContain("Commander Pagne wax sur WhatsApp");
  });

  it("prix barré affiché quand il y a une promotion", () => {
    const html = render([section("shoppable-video", { video: VIDEO }, blocks)]);
    expect(html).toMatch(/<s[ >]/);
  });

  it("la vidéo n'est jamais préchargée et reste muette, avec commandes clavier", () => {
    const html = render([section("shoppable-video", { video: VIDEO }, blocks)]);
    expect(html).toContain('preload="none"');
    expect(html).toContain("muted");
    expect(html).not.toContain(`src="${VIDEO}"`); // téléchargée seulement dans la vue
    expect(html).toContain("aria-label=\"Lire : ");
    expect(html).toContain("Activer le son");
  });

  it("sous-titres VTT seulement si le fichier est valide", () => {
    const ok = render([section("shoppable-video", { video: VIDEO, captions: "https://cdn.example.com/s.vtt" }, blocks)]);
    expect(ok).toContain('kind="captions"');
    const ko = render([section("shoppable-video", { video: VIDEO, captions: "https://cdn.example.com/s.exe" }, blocks)]);
    expect(ko).not.toContain('kind="captions"');
  });

  it("sans vidéo lisible : la couverture et les produits restent affichés", () => {
    const html = render([section("shoppable-video", { video: "https://www.youtube.com/watch?v=x", poster: { url: "https://images.unsplash.com/cover" } }, blocks)]);
    expect(html).not.toContain("<video");
    expect(html).toContain("Pagne wax");
  });

  it("sans produit ni couverture : section masquée", () => {
    expect(render([section("shoppable-video", {})], data({ products: {}, allProductIds: [] }))).toBe("");
  });

  it("formats vidéo acceptés", () => {
    expect(isDirectVideoUrl("https://cdn.example.com/a.mp4")).toBe(true);
    expect(isDirectVideoUrl("https://cdn.example.com/a.webm?v=2")).toBe(true);
    expect(isDirectVideoUrl("http://cdn.example.com/a.mp4")).toBe(false);
    expect(isDirectVideoUrl("https://youtu.be/abc")).toBe(false);
    expect(isDirectVideoUrl(null)).toBe(false);
  });
});

describe("stories (§17)", () => {
  const blocks: BlockInstance[] = [
    { id: "s1", type: "story", settings: { title: "Nouveautés", image: { url: "https://images.unsplash.com/a" }, product: "p1", duration: 5 } },
    { id: "s2", type: "story", settings: { title: "Atelier", image: { url: "https://images.unsplash.com/b" }, text: "Dans les coulisses" } },
    { id: "s3", type: "story", settings: { title: "Sans visuel" } },
  ];

  it("un cercle par story avec visuel, le reste ignoré", () => {
    const html = render([section("stories", { heading: "Nos stories" }, blocks)]);
    expect((html.match(/Ouvrir<\/span>/g) ?? []).length).toBe(2);
    expect(html).toContain("Nouveautés");
    expect(html).not.toContain("Sans visuel");
  });

  it("les cercles sont de vrais boutons (pas des div cliquables)", () => {
    const html = render([section("stories", {}, blocks)]);
    expect(html).toContain('<button type="button"');
  });

  it("titres masqués mais toujours lisibles par un lecteur d'écran", () => {
    const html = render([section("stories", { show_labels: false }, blocks)]);
    expect(html).toContain("sr-only");
    expect(html).toContain("Nouveautés");
  });

  it("sans story : section masquée", () => {
    expect(render([section("stories", {}, [])])).toBe("");
  });

  it("la visionneuse est une boîte de dialogue modale accessible", () => {
    const html = renderToStaticMarkup(
      createElement(StoryViewer, {
        stories: [
          { id: "s1", title: "Nouveautés", text: "Arrivage", image: "https://images.unsplash.com/a", video: null, durationMs: 5000, product: { slug: "pagne-wax", name: "Pagne wax", priceLabel: "12 000 FCFA", image: null } },
          { id: "s2", title: "Atelier", text: "", image: "https://images.unsplash.com/b", video: null, durationMs: 5000, product: null },
        ],
        start: 0,
        base: "/s/chez-aicha",
        onClose: () => {},
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Story 1 sur 2 : Nouveautés");
    expect(html).toContain("Fermer les stories");
    expect(html).toContain("Story précédente");
    expect(html).toContain("Mettre en pause");
    expect(html).toContain("/s/chez-aicha/p/pagne-wax");
  });
});

describe("direct (§18)", () => {
  it("affiche le titre, le texte et un état de chargement accessible", () => {
    const html = render([section("live-shopping", { heading: "En direct", text: "Rendez-vous samedi à 18 h." })]);
    expect(html).toContain("En direct");
    expect(html).toContain("Rendez-vous samedi à 18 h.");
    expect(html).toContain('aria-busy="true"');
  });

  it("aucune donnée de direct n'est rendue côté serveur (section pure : tout vient de /api/live)", () => {
    const html = render([section("live-shopping", {})]);
    expect(html).not.toContain("wa.me");
  });
});
