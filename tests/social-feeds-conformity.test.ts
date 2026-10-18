import { describe, it, expect, afterAll } from "vitest";
import {
  buildCatalogItems, formatFeedPrice, formatEffectiveDate, storedMediaKey, toMetaItemData, META_BATCH_TITLE_MAX,
  type SourceProduct, type SourceVariant,
} from "@/lib/social/feed-items";
import { renderRssFeed, renderTiktokCsv, TIKTOK_COLUMNS } from "@/lib/social/feed-format";

/**
 * Conformité des flux aux spécifications officielles (consultées le 14/10/2026, sources dans docs/SOCIAL-COMMERCE.md) :
 * Google Merchant Center « Product data specification », Meta « Product data specifications for catalogs » et
 * « Product Catalog Items Batch », TikTok « Catalog Product Parameters ».
 */

const BASE = "https://axi.africa";
const NOW = new Date("2026-10-14T12:00:00Z");
const WEBP = "/media/stores/storeaaa0001/2026/10/" + "a".repeat(64) + ".webp";
const PNG = "/media/stores/storeaaa0001/2026/10/" + "b".repeat(64) + ".png";

// Origine publique (images téléversées rendues absolues) : posée avant la collecte des blocs describe.
const previous = process.env.NEXT_PUBLIC_APP_URL;
process.env.NEXT_PUBLIC_APP_URL = BASE;
afterAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = previous;
});

function variant(over: Partial<SourceVariant> = {}): SourceVariant {
  return { id: "var_m_orange_001", name: "M / Orange", attributes: { Taille: "M", Couleur: "Orange" }, price: null, compareAtPrice: null, barcode: null, imageUrl: null, available: true, stock: 4, inventoryPolicy: "DENY", ...over };
}

function product(over: Partial<SourceProduct> = {}): SourceProduct {
  return {
    id: "prod_robe_wax_01", slug: "robe-wax-abomey", name: "Robe wax Abomey", description: "Coton 100 %, coupe ample.", price: 1999, compareAtPrice: null,
    promoPrice: null, promoStart: null, promoEnd: null, barcode: null, trackStock: true, stock: 3, inventoryPolicy: "DENY",
    images: [{ url: WEBP }, { url: PNG }, { url: "https://images.example.com/c.jpg" }], vendor: null, categoryId: null, isGiftCard: false, variants: [], ...over,
  };
}

const store = (currency: string) => ({ slug: "dantokpa-mode", name: "Dantokpa Mode", currency, status: "PUBLISHED" });

/** Valeurs des balises g:name d'un item RSS. */
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<g:${name}>([^<]*)</g:${name}>`, "g"))].map((m) => m[1]);

describe("prix multi-devises (« nombre ISO-4217 », point décimal)", () => {
  it.each([
    [18000, "XOF", "18000 XOF"],
    [1999, "EUR", "19.99 EUR"],
    [1999, "USD", "19.99 USD"],
    [250000, "NGN", "2500.00 NGN"],
    [1500, "JPY", "1500 JPY"],
    [1999, "eur", "19.99 EUR"],
  ])("%i %s → %s", (amount, currency, expected) => {
    expect(formatFeedPrice(amount, currency)).toBe(expected);
  });

  it("la devise de la BOUTIQUE est utilisée dans les trois flux et l'API", () => {
    const { items } = buildCatalogItems({ store: store("EUR"), products: [product({ compareAtPrice: 2499 })], baseUrl: BASE, now: NOW });
    const meta = renderRssFeed("meta", { title: "x", link: BASE, description: "x" }, items);
    const google = renderRssFeed("google", { title: "x", link: BASE, description: "x" }, items);
    expect(tags(meta, "price")).toEqual(["24.99 EUR"]);
    expect(tags(meta, "sale_price")).toEqual(["19.99 EUR"]);
    expect(tags(google, "price")).toEqual(["24.99 EUR"]);
    expect(renderTiktokCsv(items)).toContain(",24.99 EUR,19.99 EUR,");
    expect(toMetaItemData(items[0])).toMatchObject({ price: "24.99 EUR", sale_price: "19.99 EUR" });
  });
});

describe("champs obligatoires", () => {
  const { items } = buildCatalogItems({ store: store("XOF"), products: [product({ price: 18000 })], baseUrl: BASE, now: NOW });
  const channel = { title: "Dantokpa", link: `${BASE}/s/dantokpa-mode`, description: "Mode" };

  it("Meta : id, title, description, availability, condition, price, link, image_link, brand", () => {
    const xml = renderRssFeed("meta", channel, items);
    for (const f of ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"]) expect(tags(xml, f), f).toHaveLength(1);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // Recommandation Meta : un champ par ligne.
    expect(xml).toContain("\n<g:id>prod_robe_wax_01</g:id>\n");
  });

  it("Google : mêmes champs + identifier_exists sans GTIN, disponibilité avec « _ »", () => {
    const xml = renderRssFeed("google", channel, items);
    for (const f of ["id", "title", "description", "availability", "price", "link", "image_link", "brand", "condition", "identifier_exists"]) expect(tags(xml, f), f).toHaveLength(1);
    expect(tags(xml, "availability")).toEqual(["in_stock"]);
    expect(tags(xml, "identifier_exists")).toEqual(["no"]);
  });

  it("TikTok : colonnes obligatoires présentes (sku_id, title, description, availability, condition, price, link, image_link, brand)", () => {
    for (const c of ["sku_id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"]) expect(TIKTOK_COLUMNS).toContain(c);
    const [head, row] = renderTiktokCsv(items).split("\r\n");
    expect(head.split(",")).toHaveLength(TIKTOK_COLUMNS.length);
    expect(row).toContain("in stock");
  });

  it("URL absolues https (liens et images) et longueurs maximales", () => {
    const long = buildCatalogItems({ store: store("XOF"), products: [product({ name: "R".repeat(400), description: "D".repeat(9000) })], baseUrl: BASE, now: NOW }).items[0];
    expect(long.title.length).toBeLessThanOrEqual(150); // Google 150, Meta 200
    expect(long.description.length).toBeLessThanOrEqual(5000);
    expect((toMetaItemData(long).title as string).length).toBeLessThanOrEqual(META_BATCH_TITLE_MAX);
    for (const i of items) {
      for (const u of [i.link, i.imageLink, i.compatImageLink, ...i.additionalImageLinks, ...i.compatAdditionalImageLinks]) expect(u).toMatch(/^https:\/\//);
    }
  });
});

describe("disponibilité par plateforme (vente en rupture autorisée)", () => {
  const { items } = buildCatalogItems({ store: store("XOF"), products: [product({ stock: 0, inventoryPolicy: "CONTINUE", price: 18000 })], baseUrl: BASE, now: NOW });
  it("Google « backorder » (preorder exigerait availability_date), Meta « in stock », TikTok « available for order »", () => {
    expect(items[0].availability).toBe("preorder");
    expect(tags(renderRssFeed("google", { title: "x", link: BASE, description: "x" }, items), "availability")).toEqual(["backorder"]);
    expect(tags(renderRssFeed("meta", { title: "x", link: BASE, description: "x" }, items), "availability")).toEqual(["in stock"]);
    expect(toMetaItemData(items[0]).availability).toBe("in stock");
    expect(renderTiktokCsv(items)).toContain(",available for order,");
  });
});

describe("variantes", () => {
  const { items } = buildCatalogItems({
    store: store("XOF"),
    products: [product({ price: 18000, variants: [variant(), variant({ id: "var_s_bleu_0002", name: "S / Bleu", attributes: { Taille: "S", Couleur: "Bleu" } })] })],
    baseUrl: BASE,
    now: NOW,
  });
  it("item_group_id commun, ids uniques, groupe distinct de tout id, lien vers la variante", () => {
    expect(new Set(items.map((i) => i.itemGroupId))).toEqual(new Set(["prod_robe_wax_01"]));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.map((i) => i.id)).not.toContain("prod_robe_wax_01");
    expect(items[1].link).toBe(`${BASE}/s/dantokpa-mode/p/robe-wax-abomey?variant=var_s_bleu_0002`);
    const google = renderRssFeed("google", { title: "x", link: BASE, description: "x" }, items);
    expect(tags(google, "item_group_id")).toEqual(["prod_robe_wax_01", "prod_robe_wax_01"]);
    expect(tags(google, "color")).toEqual(["Orange", "Bleu"]);
    expect(tags(google, "size")).toEqual(["M", "S"]);
  });
});

describe("images : JPEG/PNG pour Meta et TikTok", () => {
  it("photo téléversée en WebP → conversion /feeds/img/…jpg ; PNG et images externes inchangées ; Google garde l'original", () => {
    expect(storedMediaKey(WEBP)).toBe(WEBP.slice("/media/".length));
    expect(storedMediaKey("https://images.example.com/c.jpg")).toBeNull();
    const { items } = buildCatalogItems({ store: store("XOF"), products: [product({ price: 18000 })], baseUrl: BASE, now: NOW });
    const i = items[0];
    expect(i.imageLink).toBe(`${BASE}${WEBP}`);
    expect(i.compatImageLink).toBe(`${BASE}/s/dantokpa-mode/feeds/img/${WEBP.slice("/media/".length)}.jpg`);
    expect(i.compatAdditionalImageLinks).toEqual([`${BASE}${PNG}`, "https://images.example.com/c.jpg"]);
    expect(tags(renderRssFeed("google", { title: "x", link: BASE, description: "x" }, items), "image_link")).toEqual([`${BASE}${WEBP}`]);
    expect(tags(renderRssFeed("meta", { title: "x", link: BASE, description: "x" }, items), "image_link")[0]).toMatch(/\.webp\.jpg$/);
    const data = toMetaItemData(i);
    expect(data.image_link).toMatch(/\.webp\.jpg$/);
    // items_batch : tableau JSON (et non chaîne séparée par des virgules)
    expect(data.additional_image_link).toEqual([`${BASE}${PNG}`, "https://images.example.com/c.jpg"]);
  });
});

describe("domaine personnalisé et champs utiles (YouTube via Merchant Center, Instagram via Meta)", () => {
  it("liens produits sur le domaine vérifié de la boutique ; images restent sur l'origine Axi", () => {
    const { items } = buildCatalogItems({ store: store("XOF"), products: [product({ price: 18000 })], baseUrl: BASE, storeUrl: "https://boutique-dantokpa.com", now: NOW });
    expect(items[0].link).toBe("https://boutique-dantokpa.com/p/robe-wax-abomey");
    expect(items[0].compatImageLink.startsWith(`${BASE}/s/dantokpa-mode/feeds/img/`)).toBe(true);
  });

  it("google_product_category émis partout quand il est réglé", () => {
    const settings = { includeOutOfStock: true, brand: null, googleProductCategory: "2271" };
    const { items } = buildCatalogItems({ store: store("XOF"), products: [product({ price: 18000 })], baseUrl: BASE, settings, now: NOW });
    expect(tags(renderRssFeed("google", { title: "x", link: BASE, description: "x" }, items), "google_product_category")).toEqual(["2271"]);
    expect(tags(renderRssFeed("meta", { title: "x", link: BASE, description: "x" }, items), "google_product_category")).toEqual(["2271"]);
    expect(toMetaItemData(items[0]).google_product_category).toBe("2271");
    expect(renderTiktokCsv(items).split("\r\n")[1].endsWith(",2271")).toBe(true);
  });

  it("période de promotion ISO 8601 à la minute (Google : 25 caractères au plus par date)", () => {
    const v = formatEffectiveDate(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T23:59:59Z"));
    expect(v).toBe("2026-10-01T00:00Z/2026-10-31T23:59Z");
    for (const part of v.split("/")) expect(part.length).toBeLessThanOrEqual(25);
  });
});

describe("échappement et encodage", () => {
  it("texte hostile échappé, aucun élément injecté, UTF-8 conservé", () => {
    const { items } = buildCatalogItems({
      store: store("XOF"),
      products: [product({ price: 18000, name: "Pagne « Kanvô » & <b>wax</b>", description: "</g:description><g:price>1 XOF</g:price>]]>" })],
      baseUrl: BASE,
      now: NOW,
    });
    const xml = renderRssFeed("google", { title: "x", link: BASE, description: "x" }, items);
    expect(tags(xml, "title")).toEqual(["Pagne « Kanvô » &amp; &lt;b&gt;wax&lt;/b&gt;"]);
    expect(tags(xml, "price")).toEqual(["18000 XOF"]);
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });
});
