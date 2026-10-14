import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Lot 2 §1.1 — langue de la requête (en-tête `x-axi-locale` posé par le proxy), alternatives hreflang,
 * application des traductions au rendu et ISOLATION entre boutiques.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  headers: {} as Record<string, string>,
  cookies: {} as Record<string, string>,
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  // `cache` de React n'existe que dans le rendu serveur : identité simple dans les tests.
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn };
});
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => state.headers[k.toLowerCase()] ?? null }),
  cookies: async () => ({ get: (k: string) => (state.cookies[k] ? { value: state.cookies[k] } : undefined) }),
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));

const { localeAlternates, loadTranslations, localizeStorefront, requestLocale, servedLocales } = await import("@/lib/i18n/resolve");
const { migrateLegacyTheme } = await import("@/lib/theme-engine/defaults");

/** Plan Scale : 5 langues autorisées (le quota est appliqué par `servedLocales`). */
const SCALE = { planId: "SCALE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) };
const STORE_A = { id: "store_AAAAAAAA", slug: "chez-aicha", locale: "fr", enabledLocales: ["en"], subscription: SCALE };
const STORE_B = { id: "store_BBBBBBBB", slug: "chez-bola", locale: "fr", enabledLocales: ["en"], subscription: SCALE };

function seed() {
  state.fake = createFakeDb({
    store: [
      { ...STORE_A, name: "Chez Aïcha", tagline: "Pagnes et wax", description: "Atelier de Cotonou", i18nConfig: null },
      { ...STORE_B, name: "Chez Bola", tagline: null, description: null, i18nConfig: null },
    ],
    storePage: [{ id: "page_1", storeId: STORE_A.id, slug: "livraison", title: "Livraison", body: "Nous livrons à Cotonou." }],
    storeMenu: [{ id: "menu_1", storeId: STORE_A.id, handle: "main", items: [{ label: "Accueil", type: "home" }, { label: "Boutique", type: "catalog", children: [{ label: "Robes", type: "url", target: "/catalogue" }] }] }],
    translation: [
      row(STORE_A.id, "STORE", STORE_A.id, "name", "Aicha's Shop"),
      row(STORE_A.id, "STORE", STORE_A.id, "tagline", "Wax and prints"),
      row(STORE_A.id, "PRODUCT", "prod_1", "name", "Wax dress"),
      row(STORE_A.id, "PRODUCT", "prod_1", "options.name.Taille", "Size"),
      row(STORE_A.id, "PRODUCT", "prod_1", "options.value.M", "M (EU 38)"),
      row(STORE_A.id, "COLLECTION", "col_1", "name", "Dresses"),
      row(STORE_A.id, "PAGE", "page_1", "title", "Delivery"),
      row(STORE_A.id, "MENU", "main", "1", "Shop"),
      // Boutique B : même langue, mêmes identifiants de champs, valeurs différentes.
      row(STORE_B.id, "STORE", STORE_B.id, "name", "NE DOIT PAS FUIR"),
      row(STORE_B.id, "PRODUCT", "prod_1", "name", "NE DOIT PAS FUIR"),
    ],
  });
}

function row(storeId: string, resourceType: string, resourceId: string, field: string, value: string) {
  return { id: `tr_${storeId}_${resourceType}_${resourceId}_${field}`, storeId, resourceType, resourceId, locale: "en", field, value, source: "MANUAL", sourceHash: "x", updatedAt: new Date() };
}

function renderData() {
  return {
    store: { id: STORE_A.id, slug: STORE_A.slug, name: "Chez Aïcha", tagline: "Pagnes et wax", description: "Atelier de Cotonou", copy: { catalogTitle: "Nos produits", addLabel: "Ajouter" }, currency: "XOF" },
    now: new Date().toISOString(),
    collections: [{ id: "col_1", handle: "robes", name: "Robes", description: "Nos robes", seoTitle: null, seoDescription: null, sortOrder: "manual", image: null, productIds: ["prod_1"] }],
    products: {
      prod_1: {
        id: "prod_1",
        slug: "robe-wax",
        name: "Robe en wax",
        description: "Coupe droite",
        options: [{ name: "Taille", type: "size", values: [{ value: "M" }, { value: "L" }] }],
        variants: [{ attributes: { Taille: "M" }, purchasable: true }],
      },
    },
    allProductIds: ["prod_1"],
    menus: { main: [{ label: "Accueil", href: "/s/chez-aicha", children: [] }, { label: "Boutique", href: "/s/chez-aicha/catalogue", children: [{ label: "Robes", href: "/s/chez-aicha/collections/robes", children: [] }] }] },
    pages: [{ slug: "livraison", title: "Livraison" }],
    reviews: { summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }, items: [], page: 1, pages: 1, rating: null, productScoped: false },
    listing: { kind: "collection", title: "Robes", description: "Nos robes", collectionId: "col_1", basePath: "/s/chez-aicha/collections/robes", image: null, query: "", productIds: [], total: 0, page: 1, pages: 1, perPage: 24, facets: {}, params: {} },
  } as never;
}

const theme = () => migrateLegacyTheme({ sector: "general", themeId: "market", themeConfig: null, bannerUrl: null, logoUrl: null, name: "Chez Aïcha", tagline: null, description: null, whatsappNumber: null });

beforeEach(() => {
  seed();
  state.headers = {};
  state.cookies = {};
});

describe("langue de la requête", () => {
  it("vient de l'en-tête du proxy, validée contre les langues de la boutique", async () => {
    state.headers["x-axi-locale"] = "en";
    state.headers["x-axi-locale-path"] = "/s/chez-aicha/p/robe-wax";
    const ctx = await requestLocale(STORE_A as never);
    expect(ctx).toMatchObject({ locale: "en", primary: "fr", isSecondary: true, dir: "ltr", prefix: "/en", basePath: "/s/chez-aicha/en" });
  });

  it("retombe sur la langue principale pour une langue non activée ou absurde", async () => {
    state.headers["x-axi-locale"] = "pt";
    expect((await requestLocale(STORE_A as never)).locale).toBe("fr");
    state.headers["x-axi-locale"] = "<script>";
    expect((await requestLocale({ ...STORE_A, id: "store_AAAAAAAB" } as never)).locale).toBe("fr");
  });

  it("suggère une langue d'après le cookie ou le navigateur, sans jamais rediriger", async () => {
    state.headers["accept-language"] = "en-GB,en;q=0.9";
    state.headers["x-axi-locale-path"] = "/s/chez-aicha/p/robe-wax";
    const ctx = await requestLocale(STORE_A as never);
    expect(ctx.locale).toBe("fr");
    expect(ctx.suggestion).toEqual({ locale: "en", label: "English", href: "/s/chez-aicha/en/p/robe-wax" });
  });

  it("applique le quota du plan (langues en trop non servies)", () => {
    // Plan Scale : 5 langues au total.
    expect(servedLocales({ ...STORE_A, enabledLocales: ["en", "pt", "es", "ar", "sw"] } as never)).toMatchObject({ secondary: ["en", "pt", "es", "ar"], overQuota: ["sw"] });
    // Sans abonnement : plan gratuit, 1 langue. La langue secondaire n'est plus servie (baisse de plan).
    expect(servedLocales({ ...STORE_A, subscription: null } as never)).toMatchObject({ primary: "fr", secondary: [], overQuota: ["en"] });
  });
});

describe("hreflang", () => {
  it("liste une URL par langue servie plus x-default sur la langue principale", () => {
    const ctx = { served: ["fr", "en", "ar"], primary: "fr", path: "/s/chez-aicha/p/robe-wax" };
    expect(localeAlternates(ctx)).toEqual({
      canonical: "/s/chez-aicha/p/robe-wax",
      languages: {
        fr: "/s/chez-aicha/p/robe-wax",
        en: "/s/chez-aicha/en/p/robe-wax",
        ar: "/s/chez-aicha/ar/p/robe-wax",
        "x-default": "/s/chez-aicha/p/robe-wax",
      },
    });
  });
});

describe("application des traductions au rendu", () => {
  it("traduit les textes, préfixe les liens et conserve les champs non traduits", async () => {
    state.headers["x-axi-locale"] = "en";
    state.headers["x-axi-locale-path"] = "/s/chez-aicha/collections/robes";
    const data = renderData();
    const { ctx } = await localizeStorefront(STORE_A as never, theme(), data);
    const d = data as unknown as Record<string, never>;
    expect(ctx).toMatchObject({ locale: "en", isSecondary: true });

    const info = d.store as unknown as Record<string, unknown>;
    expect(info.name).toBe("Aicha's Shop");
    expect(info.tagline).toBe("Wax and prints");
    // Champ sans traduction : texte d'origine conservé (aucun vide, aucun mélange).
    expect(info.description).toBe("Atelier de Cotonou");
    // Libellés d'interface du dictionnaire anglais.
    expect((info.copy as Record<string, string>).addLabel).toBe("Add");
    expect(info.localePrefix).toBe("/en");

    const product = (d.products as unknown as Record<string, Record<string, unknown>>).prod_1!;
    expect(product.name).toBe("Wax dress");
    expect(product.description).toBe("Coupe droite");
    // Options et attributs de variantes traduits de façon COHÉRENTE (sélection par identifiant inchangée).
    expect((product.options as { name: string; values: { value: string }[] }[])[0]).toEqual({ name: "Size", type: "size", values: [{ value: "M (EU 38)" }, { value: "L" }] });
    expect((product.variants as { attributes: Record<string, string> }[])[0]!.attributes).toEqual({ Size: "M (EU 38)" });

    expect((d.collections as unknown as { name: string }[])[0]!.name).toBe("Dresses");
    expect((d.pages as unknown as { title: string }[])[0]!.title).toBe("Delivery");
    const listing = d.listing as unknown as Record<string, string>;
    expect(listing.title).toBe("Dresses");
    expect(listing.basePath).toBe("/s/chez-aicha/en/collections/robes");

    const menu = (d.menus as unknown as Record<string, { label: string; href: string; children: { label: string; href: string }[] }[]>).main!;
    expect(menu[0]).toMatchObject({ label: "Accueil", href: "/s/chez-aicha/en" });
    expect(menu[1]).toMatchObject({ label: "Shop", href: "/s/chez-aicha/en/catalogue" });
    expect(menu[1]!.children[0]).toMatchObject({ label: "Robes", href: "/s/chez-aicha/en/collections/robes" });

    const view = d.locale as unknown as { options: { code: string; href: string }[] };
    expect(view.options.map((o) => o.href)).toEqual(["/s/chez-aicha/collections/robes", "/s/chez-aicha/en/collections/robes"]);
  });

  it("ne lit jamais les traductions d'une autre boutique", async () => {
    state.headers["x-axi-locale"] = "en";
    const bundle = await loadTranslations(STORE_B.id, "en", { STORE: [STORE_A.id], PRODUCT: ["prod_1"] });
    // Les clés de A ne sont pas visibles depuis B ; seules celles de B le sont.
    expect(bundle.get(`STORE:${STORE_A.id}`)).toBeUndefined();
    expect(bundle.get("PRODUCT:prod_1")).toEqual({ name: "NE DOIT PAS FUIR" });

    const data = renderData();
    await localizeStorefront(STORE_A as never, theme(), data);
    const d = data as unknown as Record<string, never>;
    expect((d.products as unknown as Record<string, Record<string, unknown>>).prod_1!.name).toBe("Wax dress");
    expect((d.store as unknown as Record<string, unknown>).name).toBe("Aicha's Shop");
  });

  it("en langue principale, ne charge aucune traduction et ne préfixe rien", async () => {
    const data = renderData();
    const before = JSON.stringify(data);
    const { ctx } = await localizeStorefront(STORE_A as never, theme(), data);
    expect(ctx.isSecondary).toBe(false);
    const d = data as unknown as Record<string, never>;
    expect((d.store as unknown as Record<string, unknown>).name).toBe("Chez Aïcha");
    expect((d.store as unknown as Record<string, unknown>).localePrefix).toBe("");
    expect(JSON.parse(before).menus.main[1].href).toBe("/s/chez-aicha/catalogue");
  });
});
