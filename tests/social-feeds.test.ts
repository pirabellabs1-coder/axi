import { describe, it, expect } from "vitest";
import { buildCatalogItems, cleanDescription, formatFeedPrice, itemAvailability, itemPricing, readSettings, toMetaItemData, contentHash, validGtin, type SourceProduct, type SourceVariant } from "@/lib/social/feed-items";
import { csvCell, renderRssFeed, renderTiktokCsv, xmlEscape, TIKTOK_COLUMNS } from "@/lib/social/feed-format";

const BASE = "https://axi.africa";
const NOW = new Date("2026-10-11T12:00:00Z");
const store = { slug: "dantokpa-mode", name: "Dantokpa Mode", currency: "XOF", status: "PUBLISHED" };

function variant(over: Partial<SourceVariant> = {}): SourceVariant {
  return { id: "var_m_orange_001", name: "M / Orange", attributes: { Taille: "M", Couleur: "Orange" }, price: null, compareAtPrice: null, barcode: null, imageUrl: null, available: true, stock: 4, inventoryPolicy: "DENY", ...over };
}

function product(over: Partial<SourceProduct> & Record<string, unknown> = {}): SourceProduct {
  return {
    id: "prod_robe_wax_01",
    slug: "robe-wax-abomey",
    name: "Robe wax Abomey",
    description: "**Coton** 100 %, coupe *ample*.\n\n- Lavage à 30°",
    price: 18000,
    compareAtPrice: null,
    promoPrice: null,
    promoStart: null,
    promoEnd: null,
    barcode: null,
    trackStock: true,
    stock: 3,
    inventoryPolicy: "DENY",
    images: [{ url: "https://images.example.com/robe.jpg?w=900&q=72&h=1125", alt: "Robe" }],
    vendor: null,
    categoryId: null,
    isGiftCard: false,
    variants: [],
    ...over,
  } as SourceProduct;
}

describe("articles de catalogue", () => {
  it("une ligne par variante (id = variante, groupe = produit), lien et image publics", () => {
    const { items } = buildCatalogItems({ store, products: [product({ variants: [variant(), variant({ id: "var_s_bleu_0002", name: "S / Bleu", attributes: { Taille: "S", Couleur: "Bleu" } })] })], baseUrl: BASE, now: NOW });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "var_m_orange_001", itemGroupId: "prod_robe_wax_01", color: "Orange", size: "M", title: "Robe wax Abomey (M / Orange)", brand: "Dantokpa Mode", condition: "new", availability: "in_stock" });
    expect(items[0].link).toBe(`${BASE}/s/dantokpa-mode/p/robe-wax-abomey?variant=var_m_orange_001`);
    expect(items[0].imageLink).toBe("https://images.example.com/robe.jpg?w=900&q=72&h=1125");
  });

  it("produit sans variante : id = produit, pas de groupe", () => {
    const { items } = buildCatalogItems({ store, products: [product()], baseUrl: BASE, now: NOW });
    expect(items[0]).toMatchObject({ id: "prod_robe_wax_01", itemGroupId: null, variantId: null });
  });

  it("description nettoyée (Markdown et balises retirés)", () => {
    expect(cleanDescription("**Coton** <script>alert(1)</script> *doux*\n- lavable")).toBe("Coton alert(1) doux lavable");
    expect(cleanDescription("a\u0000b\u0007c")).toBe("abc");
  });

  it("disponibilité selon la politique de stock, jamais de quantité", () => {
    expect(itemAvailability({ trackStock: false }, { stock: 0, inventoryPolicy: "DENY" }, true)).toBe("in_stock");
    expect(itemAvailability({ trackStock: true }, { stock: 0, inventoryPolicy: "DENY" }, true)).toBe("out_of_stock");
    expect(itemAvailability({ trackStock: true }, { stock: 0, inventoryPolicy: "CONTINUE" }, true)).toBe("preorder");
    expect(itemAvailability({ trackStock: true }, { stock: 5, inventoryPolicy: "DENY", available: false }, true)).toBe("out_of_stock");
    expect(itemAvailability({ trackStock: true }, { stock: 5, inventoryPolicy: "DENY" }, false)).toBe("out_of_stock");
  });

  it("boutique fermée temporairement : tout en rupture", () => {
    const { items } = buildCatalogItems({ store: { ...store, status: "CLOSED_TEMPORARILY" }, products: [product()], baseUrl: BASE, now: NOW });
    expect(items[0].availability).toBe("out_of_stock");
  });

  it("réglage « exclure les ruptures »", () => {
    const p = product({ stock: 0 });
    expect(buildCatalogItems({ store, products: [p], baseUrl: BASE, now: NOW }).items).toHaveLength(1);
    expect(buildCatalogItems({ store, products: [p], baseUrl: BASE, now: NOW, settings: { includeOutOfStock: false, brand: null, googleProductCategory: null } }).items).toHaveLength(0);
  });

  it("prix barré : prix comparé, promotion datée, prix de variante", () => {
    expect(itemPricing(product({ compareAtPrice: 22000 }), null, NOW)).toEqual({ price: 22000, salePrice: 18000, effective: null });
    const promo = product({ promoPrice: 15000, promoStart: new Date("2026-10-01T00:00:00Z"), promoEnd: new Date("2026-10-31T23:59:00Z") });
    expect(itemPricing(promo, null, NOW)).toEqual({ price: 18000, salePrice: 15000, effective: "2026-10-01T00:00Z/2026-10-31T23:59Z" });
    expect(itemPricing(promo, null, new Date("2026-11-02T00:00:00Z")).salePrice).toBeNull();
    expect(itemPricing(promo, variant({ price: 20000, compareAtPrice: 25000 }), NOW)).toEqual({ price: 25000, salePrice: 20000, effective: null });
    expect(itemPricing(product(), variant({ price: 20000 }), NOW)).toEqual({ price: 20000, salePrice: null, effective: null });
  });

  it("format de prix par devise", () => {
    expect(formatFeedPrice(18000, "XOF")).toBe("18000 XOF");
    expect(formatFeedPrice(1999, "EUR")).toBe("19.99 EUR");
  });

  it("GTIN : seulement un code-barres valide (clé de contrôle)", () => {
    expect(validGtin("4006381333931")).toBe("4006381333931");
    expect(validGtin("4006381333932")).toBeNull();
    expect(validGtin("ABC-123")).toBeNull();
    expect(validGtin(null)).toBeNull();
    const { items } = buildCatalogItems({ store, products: [product({ barcode: "4006381333931" })], baseUrl: BASE, now: NOW });
    expect(items[0].gtin).toBe("4006381333931");
  });

  it("exclusions explicites : sans photo publique, prix nul ; cartes cadeaux ignorées", () => {
    const { items, skipped } = buildCatalogItems({
      store,
      products: [
        product({ id: "prod_no_image_01", images: [{ url: "data:image/png;base64,AAAA" }] }),
        product({ id: "prod_free_00001", price: 0 }),
        product({ id: "prod_giftcard_01", isGiftCard: true }),
      ],
      baseUrl: BASE,
      now: NOW,
    });
    expect(items).toHaveLength(0);
    expect(skipped.map((s) => s.id).sort()).toEqual(["prod_free_00001", "prod_no_image_01"]);
  });

  it("marque : réglage > vendeur du produit > nom de la boutique", () => {
    expect(buildCatalogItems({ store, products: [product({ vendor: "Atelier Ganvié" })], baseUrl: BASE, now: NOW }).items[0].brand).toBe("Atelier Ganvié");
    expect(buildCatalogItems({ store, products: [product({ vendor: "Atelier Ganvié" })], baseUrl: BASE, now: NOW, settings: readSettings({ brand: "Ma marque" }) }).items[0].brand).toBe("Ma marque");
  });

  it("réglages en liste blanche", () => {
    expect(readSettings({ includeOutOfStock: false, brand: "  X  ", evil: "<x>" })).toEqual({ includeOutOfStock: false, brand: "X", googleProductCategory: null });
    expect(readSettings(null)).toEqual({ includeOutOfStock: true, brand: null, googleProductCategory: null });
    expect(readSettings("nope")).toEqual({ includeOutOfStock: true, brand: null, googleProductCategory: null });
    expect(readSettings({ googleProductCategory: "2271" }).googleProductCategory).toBe("2271");
    expect(readSettings({ googleProductCategory: "Apparel & Accessories > Clothing > Dresses" }).googleProductCategory).toBe("Apparel & Accessories > Clothing > Dresses");
    expect(readSettings({ googleProductCategory: "<script>" }).googleProductCategory).toBeNull();
  });
});

describe("aucun champ privé dans les flux", () => {
  const secret = product({
    costPrice: 4321,
    sku: "SKU-SECRET-42",
    tags: ["marge-faible"],
    stock: 987654,
    lowStockThreshold: 3,
    variants: [variant({ stock: 123456, sku: "VAR-SKU-SECRET" } as Partial<SourceVariant>)],
  });
  const { items } = buildCatalogItems({ store, products: [secret], baseUrl: BASE, now: NOW });
  const outputs = [
    renderRssFeed("meta", { title: store.name, link: `${BASE}/s/${store.slug}`, description: "x" }, items),
    renderRssFeed("google", { title: store.name, link: `${BASE}/s/${store.slug}`, description: "x" }, items),
    renderTiktokCsv(items),
    JSON.stringify(items.map(toMetaItemData)),
  ];
  it.each(outputs.map((o, i) => [i, o]))("sortie %i", (_i, out) => {
    for (const s of ["4321", "SKU-SECRET-42", "VAR-SKU-SECRET", "marge-faible", "987654", "123456"]) expect(out).not.toContain(s);
  });
});

describe("rendu XML", () => {
  it("échappe le texte et les URL, espace g: et disponibilité par plateforme", () => {
    const { items } = buildCatalogItems({ store, products: [product({ name: `Robe <b>"wax"</b> & 'pagne'`, description: "]]></g:description><g:price>1 XOF</g:price>" })], baseUrl: BASE, now: NOW });
    const meta = renderRssFeed("meta", { title: "A & B", link: `${BASE}/s/x`, description: "<desc>" }, items);
    expect(meta).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(meta).toContain("<title>A &amp; B</title>");
    expect(meta).toContain("<g:title>Robe &lt;b&gt;&quot;wax&quot;&lt;/b&gt; &amp; &apos;pagne&apos;</g:title>");
    expect(meta).toContain("<g:image_link>https://images.example.com/robe.jpg?w=900&amp;q=72&amp;h=1125</g:image_link>");
    expect(meta).not.toContain("<g:price>1 XOF</g:price>");
    expect(meta).toContain("<g:price>18000 XOF</g:price>");
    expect(meta).toContain("<g:availability>in stock</g:availability>");
    expect(meta.match(/<item>/g)).toHaveLength(1);
    const google = renderRssFeed("google", { title: "A", link: `${BASE}/s/x`, description: "d" }, items);
    expect(google).toContain("<g:availability>in_stock</g:availability>");
    expect(google).toContain("<g:identifier_exists>no</g:identifier_exists>");
  });

  it("xmlEscape", () => {
    expect(xmlEscape(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });

  it("caractères interdits en XML retirés", () => {
    const { items } = buildCatalogItems({ store, products: [product({ name: "Robe\u0001\u000Bwax￾" })], baseUrl: BASE, now: NOW });
    expect(renderRssFeed("meta", { title: "x", link: "x", description: "x" }, items)).toContain("<g:title>Robewax</g:title>");
  });
});

describe("rendu CSV TikTok", () => {
  it("en-têtes, guillemets RFC 4180 et virgules", () => {
    const { items } = buildCatalogItems({ store, products: [product({ name: 'Robe "wax", taille unique' })], baseUrl: BASE, now: NOW });
    const csv = renderTiktokCsv(items);
    const [head, row] = csv.split("\r\n");
    expect(head).toBe(TIKTOK_COLUMNS.join(","));
    expect(row).toContain('"Robe ""wax"", taille unique"');
    expect(row.startsWith("prod_robe_wax_01,")).toBe(true);
  });

  it("injection de formules neutralisée", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "  =cmd|' /C calc'!A0"]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    const { items } = buildCatalogItems({ store, products: [product({ name: "=HYPERLINK(\"http://evil\",\"x\")", vendor: "@marque" })], baseUrl: BASE, now: NOW });
    const row = renderTiktokCsv(items).split("\r\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(row).toContain(",'@marque,");
    expect(csvCell("Robe")).toBe("Robe");
    expect(csvCell(null)).toBe("");
  });
});

describe("empreinte des articles", () => {
  it("stable et sensible aux champs envoyés", () => {
    const { items } = buildCatalogItems({ store, products: [product()], baseUrl: BASE, now: NOW });
    const a = toMetaItemData(items[0]);
    expect(contentHash(a)).toBe(contentHash({ ...a }));
    expect(contentHash({ ...a, price: "17000 XOF" })).not.toBe(contentHash(a));
    // Ordre des clés sans effet
    const reversed = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(contentHash(reversed)).toBe(contentHash(a));
  });
});
