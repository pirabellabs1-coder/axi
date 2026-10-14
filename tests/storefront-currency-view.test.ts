/**
 * Vague 2 (correctif) : la devise choisie par l'acheteur change les prix de TOUTE la vitrine.
 *  - conversion d'affichage (prix, prix barré, montants informatifs, prix fixés par devise) ;
 *  - repli sans erreur quand le taux est périmé / la devise désactivée (aucun contexte de conversion) ;
 *  - rendu réel des sections : cartes produit en euros, données structurées toujours en devise boutique.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// La fiche produit est un îlot client : routeur et navigation simulés pour un rendu serveur de test.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TemplateRenderer } from "@/components/storefront/template-renderer";
import { chargeNotice, currencyView, isConverted, storeCurrencyView, viewCompareAt, viewMoney, viewPlain, viewPrice } from "@/lib/storefront/currency-view";
import { FIXED_EUR_PARITIES, invert, isFresh, makeFx, resolvePlatformRate, type RateRow } from "@/lib/currency/convert";
import { sanitizeSection } from "@/lib/storefront/theme-doc";
import { buildSection, defaultGlobalSettings } from "@/lib/theme-engine/defaults";
import type { CardProduct, RenderData } from "@/lib/storefront/render-types";
import type { SectionInstance, Template, ThemeDocument } from "@/lib/theme-engine/types";

/** 1 XOF = 1000 / 655957 EUR (parité fixe BCEAO), sans marge, sans arrondi commercial. */
const eurFx = (opts: { markupBps?: number; rounding?: "NONE" | "NEAREST_5" } = {}) =>
  makeFx({ base: "XOF", quote: "EUR", rate: invert(FIXED_EUR_PARITIES.XOF), markupBps: opts.markupBps ?? 0, rounding: opts.rounding ?? "NONE", source: "BCEAO_FIXED" });

const EUR = currencyView("XOF", "EUR", eurFx());

function card(over: Partial<CardProduct> = {}): CardProduct {
  return {
    id: "p1", slug: "pagne-wax", name: "Pagne wax", vendor: null, description: null, price: 12000, compareAt: 15000, range: false, discountPct: 20, soldOut: false,
    images: [], simple: true, unitPrice: 12000, minQty: 1, variantCount: 0, categoryId: null, tags: ["wax"], productType: null, options: [], isFeatured: false,
    position: 0, createdAt: "2026-01-01T00:00:00.000Z", isNew: false, sales: 0, rating: null, variants: [], ...over,
  };
}

function data(over: Partial<RenderData> = {}): RenderData {
  const p = card();
  return {
    store: { id: "s1", slug: "dantokpa", name: "Dantokpa", tagline: null, description: null, logoUrl: null, bannerUrl: null, city: null, address: null, phone: null, email: null, whatsappNumber: null, whatsappOrdering: false, currency: "XOF", closed: false, unpublished: false, booking: false, sector: "general", copy: { addLabel: "Ajouter", searchPlaceholder: "Rechercher", catalogTitle: "Catalogue", featuredTitle: "Sélection", emptyCatalog: "Rien ici", pickupTitle: "Retrait" } as RenderData["store"]["copy"], openNow: null, hours: [], todayIndex: 0, deliveryEnabled: false, pickupEnabled: false, deliveryZones: [], freeShippingFrom: null, paymentLabels: [], showPoweredBy: false, loyalty: null, metaPixelId: null, gaMeasurementId: null },
    now: "2026-10-11T10:00:00.000Z",
    collections: [],
    products: { [p.id]: p },
    allProductIds: [p.id],
    menus: {},
    reviews: { summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }, items: [], page: 1, pages: 1, rating: null, productScoped: false },
    pages: [],
    ...over,
  };
}

function section(type: SectionInstance["type"], settings: SectionInstance["settings"] = {}): SectionInstance {
  const s = sanitizeSection({ id: `${type}-1`, type, settings, blocks: [] });
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

const render = (d: ThemeDocument, rd: RenderData, template: Parameters<typeof TemplateRenderer>[0]["template"] = "home") =>
  renderToStaticMarkup(createElement(TemplateRenderer, { doc: d, template, data: rd }));

/** Les montants formatés en fr-FR contiennent des espaces insécables : on compare sur les chiffres. */
const digits = (s: string) => s.replace(/[  \s]/g, "");

describe("conversion d'affichage", () => {
  it("convertit un prix catalogue et son prix barré (parité fixe XOF → EUR)", () => {
    // 6 560 FCFA = 10,00 € exactement (1 € = 655,957 FCFA).
    expect(viewPrice(EUR, 6560)).toBe(1000);
    expect(digits(viewMoney(EUR, 6560))).toBe("10,00€");
    const shown = viewPrice(EUR, 12000);
    expect(viewCompareAt(EUR, 15000, shown)).toBeGreaterThan(shown);
  });

  it("applique la règle d'arrondi au prix et la même règle au prix barré", () => {
    const view = currencyView("XOF", "EUR", eurFx({ rounding: "NEAREST_5" }));
    const price = viewPrice(view, 12000); // 18,29 € → multiple de 5 € supérieur
    expect(price).toBe(2000);
    // Prix barré arrondi au même palier : il n'est plus supérieur au prix, donc masqué.
    expect(viewCompareAt(view, 13000, price)).toBeNull();
  });

  it("ajoute la marge de change et convertit les montants informatifs au plus proche", () => {
    const withMargin = currencyView("XOF", "EUR", eurFx({ markupBps: 500 })); // +5 %
    expect(viewPrice(withMargin, 6560)).toBe(1050);
    expect(viewPlain(EUR, 6560)).toBe(1000);
  });

  it("un prix fixé par devise remplace la conversion, et seulement pour son article", () => {
    const view = currencyView("XOF", "EUR", eurFx(), { p1: { price: 1500, compareAt: 2000 } });
    expect(viewPrice(view, 12000, "p1")).toBe(1500);
    expect(viewCompareAt(view, 15000, 1500, "p1")).toBe(2000);
    expect(viewPrice(view, 12000, "p2")).not.toBe(1500);
  });

  it("porte une mention d'encaissement dès qu'il y a conversion, jamais sinon", () => {
    expect(chargeNotice(EUR)).toContain("débité en FCFA");
    expect(isConverted(EUR)).toBe(true);
    expect(chargeNotice(storeCurrencyView("XOF"))).toBeNull();
  });
});

describe("repli sans erreur", () => {
  it("devise de la boutique : les montants sont rendus tels quels", () => {
    const v = storeCurrencyView("XOF");
    expect(viewPrice(v, 12000)).toBe(12000);
    expect(digits(viewMoney(v, 12000))).toBe("12000FCFA");
    expect(viewCompareAt(v, 15000, 12000)).toBe(15000);
    expect(viewCompareAt(v, 10000, 12000)).toBeNull();
  });

  it("un taux de plus de 72 h n'est plus affichable : aucun contexte, donc aucune conversion", () => {
    const now = new Date("2026-10-11T10:00:00.000Z");
    const rows: RateRow[] = [{ base: "EUR", quote: "NGN", rate: "1750.0", source: "ECB", fetchedAt: new Date("2026-10-07T10:00:00.000Z") }];
    const resolved = resolvePlatformRate("XOF", "NGN", rows);
    expect(resolved).not.toBeNull();
    expect(isFresh(resolved!, now)).toBe(false);
    // La devise ne sortant pas de `loadStoreFx`, la vue reste celle de la boutique.
    const v = currencyView("XOF", "NGN", null);
    expect(v.currency).toBe("XOF");
    expect(isConverted(v)).toBe(false);
    expect(viewPrice(v, 12000)).toBe(12000);
  });

  it("une cotation illisible ne casse pas le rendu", () => {
    const broken = { storeCurrency: "XOF", currency: "EUR", quote: { num: "zéro", den: "1", markupBps: 0, rounding: "NONE" as const, source: "manual" } };
    expect(viewPrice(broken, 12000)).toBe(12000);
  });

  it("la parité fixe (euro) n'est jamais périmée", () => {
    const resolved = resolvePlatformRate("XOF", "EUR", []);
    expect(resolved?.fetchedAt).toBeNull();
    expect(isFresh(resolved!, new Date())).toBe(true);
  });
});

describe("rendu de la vitrine", () => {
  it("les cartes produit affichent la devise choisie", () => {
    const d = doc([section("product-grid", { heading: "Catalogue", limit: 4 })]);
    const xof = render(d, data());
    expect(xof).toContain("FCFA");
    const eur = render(d, data({ currency: EUR }));
    expect(eur).toContain("€");
    expect(eur).not.toContain("FCFA");
  });

  it("la fiche produit convertit le prix et affiche la mention, les données structurées restent en devise boutique", () => {
    const base = data({ currency: EUR });
    base.product = {
      id: "p1", slug: "pagne-wax", name: "Pagne wax", vendor: null, productType: null, description: null, images: [], basePrice: 6560, compareAt: null, sku: null,
      trackStock: false, stock: null, inStock: true, backorder: false, continueSelling: false, lowStock: false, minQty: 1, maxQty: null, options: [], variants: [],
      optionGroups: [], details: [], tags: [], collection: null, rating: null, requestedVariantId: null, url: "/s/dantokpa/p/pagne-wax",
    };
    // Section de fiche produit instanciée depuis son préréglage (bloc « Prix » compris).
    const d = doc([buildSection("main-product-1", "main-product")]);
    d.templates.product = d.templates.home;
    const html = render(d, base, "product");
    expect(digits(html)).toContain("10,00€");
    expect(html).toContain("Vous serez débité en FCFA.");
    expect(html).toContain('"priceCurrency":"XOF"');
    expect(html).toContain('"price":6560');
  });
});
