import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FIXED_EUR_PARITIES, invert, mul, ONE, type FxRate } from "@/lib/currency/convert";
import {
  buildProductInput,
  convertStorePrice,
  convertToStore,
  eligibilityErrors,
  mapReturnedSkus,
  parseTiktokAmount,
  salesAttributesOf,
  sellableQuantity,
  sellerSkus,
  toTiktokAmount,
  type AxiProductForSync,
} from "@/lib/tiktok-shop/mapping";
import { stockDiff } from "@/lib/tiktok-shop/sync";
import { DEFAULT_SETTINGS, emptyLink, readConfig } from "@/lib/tiktok-shop/model";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn() }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn() }));
vi.mock("@/lib/currency/rates", () => ({ loadPlatformRates: vi.fn(async () => []) }));

/** XOF → EUR : parité fixe BCEAO (1 EUR = 655,957 XOF), donc 1 XOF = 1000/655957 EUR. */
const XOF_EUR: FxRate = invert(FIXED_EUR_PARITIES.XOF);
/** 1 EUR = 1,08 USD (taux de test) ⇒ XOF → USD composé. */
const EUR_USD: FxRate = { num: BigInt(108), den: BigInt(100) };
const XOF_USD: FxRate = mul(XOF_EUR, EUR_USD);

describe("montants TikTok", () => {
  it("formate selon les décimales du marché", () => {
    expect(toTiktokAmount(1250, "EUR", 2)).toBe("12.50");
    expect(toTiktokAmount(5, "EUR", 2)).toBe("0.05");
    expect(toTiktokAmount(150_050, "IDR", 0)).toBe("1501"); // IDR : 2 décimales côté Axi, 0 côté TikTok (arrondi)
    expect(toTiktokAmount(1500, "JPY", 0)).toBe("1500");
  });
  it("lit les chaînes TikTok en unités mineures Axi", () => {
    expect(parseTiktokAmount("12.5", "EUR")).toBe(1250);
    expect(parseTiktokAmount("12,50", "EUR")).toBe(1250);
    expect(parseTiktokAmount("1500", "IDR")).toBe(150_000);
    expect(parseTiktokAmount("1500", "JPY")).toBe(1500);
    expect(parseTiktokAmount("abc", "EUR")).toBe(0);
    expect(parseTiktokAmount("", "EUR")).toBe(0);
  });
});

describe("conversion multi-devises", () => {
  it("même devise : identité (majoration comprise)", () => {
    expect(convertStorePrice(1000, { storeCurrency: "EUR", marketCurrency: "EUR", rate: ONE, markupBps: 0 })).toBe(1000);
    expect(convertStorePrice(1000, { storeCurrency: "EUR", marketCurrency: "EUR", rate: ONE, markupBps: 1000 })).toBe(1100);
  });
  it("XOF → EUR à la parité fixe : 10 000 FCFA = 15,24 €", () => {
    expect(convertStorePrice(10_000, { storeCurrency: "XOF", marketCurrency: "EUR", rate: XOF_EUR, markupBps: 0 })).toBe(1524);
    // +15 % : 17,53 €
    expect(convertStorePrice(10_000, { storeCurrency: "XOF", marketCurrency: "EUR", rate: XOF_EUR, markupBps: 1500 })).toBe(1753);
  });
  it("XOF → USD via EUR : 10 000 FCFA ≈ 16,46 $", () => {
    expect(convertStorePrice(10_000, { storeCurrency: "XOF", marketCurrency: "USD", rate: XOF_USD, markupBps: 0 })).toBe(1646);
  });
  it("retour marché → boutique : 15,24 € ≈ 9 997 FCFA", () => {
    expect(convertToStore(1524, { marketCurrency: "EUR", storeCurrency: "XOF", rate: FIXED_EUR_PARITIES.XOF })).toBe(9997);
  });
});

const IMG = "https://cdn.example.com/stores/s/p1.jpg";

function product(overrides: Partial<AxiProductForSync> = {}): AxiProductForSync {
  return {
    id: "prod_0000001",
    name: "Robe wax Ada",
    description: "Robe en wax.\n\nTaille <ajustée>.",
    status: "ACTIVE",
    kind: "PHYSICAL",
    isGiftCard: false,
    price: 15_000,
    sku: null,
    trackStock: true,
    stock: 4,
    weightGrams: 400,
    images: [{ url: IMG, alt: "" }],
    variants: [
      { id: "var_00000001", name: "M / Rouge", attributes: { Taille: "M", Couleur: "Rouge" }, price: null, sku: "ADA-M-R", weightGrams: null, imageUrl: null, available: true, stock: 3 },
      { id: "var_00000002", name: "L / Rouge", attributes: { Taille: "L", Couleur: "Rouge" }, price: 17_000, sku: "ADA-M-R", weightGrams: 600, imageUrl: null, available: true, stock: -2 },
      { id: "var_00000003", name: "XL", attributes: {}, price: null, sku: null, weightGrams: null, imageUrl: null, available: false, stock: 9 },
    ],
    ...overrides,
  };
}

describe("mappage produit / variantes", () => {
  it("SKU vendeur : SKU marchand unique, sinon identifiant Axi (idempotence)", () => {
    const skus = sellerSkus(product());
    expect(skus.var_00000001).toBe("AXI-var_00000001"); // doublon « ADA-M-R » → repli
    expect(skus.var_00000002).toBe("AXI-var_00000002");
    expect(sellerSkus(product({ variants: [], sku: "ADA" }))._).toBe("ADA");
  });

  it("attributs de vente : paires de Variant.attributes (≤ 3), repli sur le nom", () => {
    expect(salesAttributesOf(product().variants[0])).toEqual([
      { name: "Taille", valueName: "M" },
      { name: "Couleur", valueName: "Rouge" },
    ]);
    expect(salesAttributesOf(product().variants[2])).toEqual([{ name: "Variante", valueName: "XL" }]);
  });

  it("quantité vendable : jamais négative, 0 si indisponible ou produit inactif, forfait si stock non suivi", () => {
    const p = product();
    expect(sellableQuantity(p, p.variants[0], DEFAULT_SETTINGS)).toBe(3);
    expect(sellableQuantity(p, p.variants[1], DEFAULT_SETTINGS)).toBe(0);
    expect(sellableQuantity(p, p.variants[2], DEFAULT_SETTINGS)).toBe(0);
    expect(sellableQuantity({ ...p, trackStock: false }, p.variants[0], { untrackedQuantity: 25 })).toBe(25);
    expect(sellableQuantity({ ...p, status: "DRAFT" }, p.variants[0], DEFAULT_SETTINGS)).toBe(0);
  });

  it("construit le produit TikTok : prix convertis par variante, stock, poids max, description échappée, attributs", () => {
    const link = { ...emptyLink("601226", "Robes"), attributes: [{ id: "100347", values: [{ id: "1000060" }] }] };
    const r = buildProductInput({ product: product(), link, storeCurrency: "XOF", market: { currency: "EUR", priceDecimals: 2 }, rate: XOF_EUR, settings: DEFAULT_SETTINGS, warehouseId: "WH1", imageUris: { [IMG]: "tos/abc" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.categoryId).toBe("601226");
    expect(r.input.mainImageUris).toEqual(["tos/abc"]);
    expect(r.input.skus.map((s) => s.price)).toEqual([
      { amount: "22.87", currency: "EUR" }, // 15 000 FCFA
      { amount: "25.92", currency: "EUR" }, // 17 000 FCFA (prix de variante)
      { amount: "22.87", currency: "EUR" },
    ]);
    expect(r.input.skus.map((s) => s.inventory[0])).toEqual([
      { warehouseId: "WH1", quantity: 3 },
      { warehouseId: "WH1", quantity: 0 },
      { warehouseId: "WH1", quantity: 0 },
    ]);
    expect(r.input.packageWeight).toEqual({ value: "0.600", unit: "KILOGRAM" });
    expect(r.input.description).toBe("<p>Robe en wax.</p><p>Taille &lt;ajustée&gt;.</p>");
    expect(r.input.productAttributes).toEqual([{ id: "100347", values: [{ id: "1000060" }] }]);
    expect(r.quantities).toEqual({ var_00000001: 3, var_00000002: 0, var_00000003: 0 });
  });

  it("en modification, les SKU déjà créés portent leur identifiant TikTok", () => {
    const link = { ...emptyLink("601226", "Robes"), tiktokProductId: "17001", skus: { var_00000001: "sku-1" } };
    const r = buildProductInput({ product: product(), link, storeCurrency: "EUR", market: { currency: "EUR", priceDecimals: 2 }, rate: ONE, settings: DEFAULT_SETTINGS, warehouseId: "WH1", imageUris: { [IMG]: "tos/abc" } });
    expect(r.ok && r.input.skus[0].id).toBe("sku-1");
    expect(r.ok && r.input.skus[1].id).toBeUndefined();
  });

  it("refuse : produit numérique, sans photo, images non envoyées", () => {
    expect(eligibilityErrors(product({ kind: "DIGITAL" }))[0]).toMatch(/physiques/);
    expect(eligibilityErrors(product({ images: [] })).join(" ")).toMatch(/photo/);
    const r = buildProductInput({ product: product(), link: emptyLink("1", "x"), storeCurrency: "EUR", market: { currency: "EUR", priceDecimals: 2 }, rate: ONE, settings: DEFAULT_SETTINGS, warehouseId: "WH1", imageUris: {} });
    expect(r.ok).toBe(false);
  });

  it("associe les SKU renvoyés par seller_sku", () => {
    const p = product();
    const map = mapReturnedSkus(p, ["var_00000001", "var_00000002"], [
      { id: "s2", sellerSku: "AXI-var_00000002" },
      { id: "s1", sellerSku: "AXI-var_00000001" },
    ]);
    expect(map).toEqual({ var_00000001: "s1", var_00000002: "s2" });
  });
});

describe("synchronisation du stock (écarts seulement)", () => {
  it("n'envoie que les SKU dont la quantité a changé ; variante supprimée → 0", () => {
    const p = product();
    const link = { ...emptyLink("1", "x"), tiktokProductId: "17001", skus: { var_00000001: "s1", var_00000002: "s2", var_gone: "s9" }, pushedStock: { var_00000001: 3, var_00000002: 5, var_gone: 4 } };
    expect(stockDiff(p, link, DEFAULT_SETTINGS)).toEqual([
      { key: "var_00000002", skuId: "s2", quantity: 0 },
      { key: "var_gone", skuId: "s9", quantity: 0 },
    ]);
    // Produit supprimé dans Axi : tout à 0.
    expect(stockDiff(null, link, DEFAULT_SETTINGS).map((d) => d.quantity)).toEqual([0, 0, 0]);
  });
});

describe("config tolérante", () => {
  it("valeurs corrompues → défauts sûrs", () => {
    const c = readConfig({ settings: { markupBps: 999_999, untrackedQuantity: -5 }, products: { p1: { categoryId: "" }, p2: { categoryId: "9", skus: { a: 1, b: "x" } } } });
    expect(c.settings.markupBps).toBe(5000);
    expect(c.settings.untrackedQuantity).toBe(0);
    expect(Object.keys(c.products)).toEqual(["p2"]);
    expect(c.products.p2.skus).toEqual({ b: "x" });
    expect(readConfig(null).shop).toBeNull();
  });
});
