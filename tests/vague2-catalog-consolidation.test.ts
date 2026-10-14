import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Consolidation vague 2 (catalogue) : produit carte cadeau (plan, valeurs faciales, pas de stock, TVA exonérée),
 * événements de webhook produit émis une fois, champs personnalisés dans l'import / l'export CSV.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const STORE = "storeaaaa1111";
const state = vi.hoisted(() => ({
  fake: null as any,
  features: { giftCards: true, stockTracking: true, variants: true, options: true, csvImport: true } as Record<string, boolean>,
  events: [] as { event: string; data: any }[],
  mfRows: [] as { productId: string; row: Record<string, string | undefined> }[],
  mfErrors: {} as Record<string, string>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: async () => ({}) }));
vi.mock("@/lib/commerce/quotas", () => ({ checkProductsQuota: async () => ({ allowed: true, used: 1, limit: null }), quotaMessage: () => "" }));
vi.mock("@/lib/collections/service", () => ({ lockStoreCategories: async () => {} }));
vi.mock("@/lib/webhooks/emit", () => ({
  emitDomainEvent: vi.fn(async (_tx: unknown, _storeId: string, event: string, data: any) => {
    state.events.push({ event, data });
    return { eventId: "evt" };
  }),
}));
vi.mock("@/lib/metafields/csv-server", () => ({
  prepareProductMetafieldImport: vi.fn(async (_s: string, _c: string, _p: string, headers: string[]) => ({
    storeId: STORE,
    currency: "XOF",
    enabled: true,
    idBySlug: {},
    mapping: { columns: headers.filter((h) => h !== "metafield:custom.inconnu").map((h) => ({ header: h, definition: { id: "def_1", namespace: "custom", key: "matiere", type: "single_line_text" } })), unknown: headers.filter((h) => h === "metafield:custom.inconnu") },
  })),
  importProductMetafieldRow: vi.fn(async (_tx: unknown, _ctx: unknown, productId: string, row: Record<string, string | undefined>) => {
    state.mfRows.push({ productId, row });
    return { errors: state.mfErrors, written: 1, deleted: 0 };
  }),
  productMetafieldCsv: vi.fn(),
}));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    planFeature: (_planId: string, f: string) => state.features[f] ?? true,
    requireStore: async () => ({ store: { id: STORE, slug: "boutique", currency: "XOF" }, user: { id: "user_1" }, planId: "BUSINESS", role: "OWNER", can: () => true }),
  };
});

import { saveProduct, importCatalog } from "@/lib/products/actions";
import { exportCatalogRows, guessColumn, metafieldHeaderColumns, CSV_COLUMNS } from "@/lib/products/csv-catalog";
import { giftCardFaceValueIssue } from "@/lib/products/schemas";
import { linkedDiscountConfig, discountRequiresProducts } from "@/lib/discounts/offer-link";
import { gatewayPayerOf } from "@/lib/commerce/orders";
import { presentmentTotalText } from "@/lib/commerce/order-display";

function seed() {
  state.events = [];
  state.mfRows = [];
  state.mfErrors = {};
  state.features = { giftCards: true, stockTracking: true, variants: true, options: true, csvImport: true };
  state.fake = createFakeDb({ product: [], variant: [], category: [], optionGroup: [], option: [], inventoryMovement: [], cartItem: [] });
}

const product = () => state.fake.tables.product[0];
const giftPayload = (over: Record<string, unknown> = {}) => ({ name: "Carte cadeau", price: 10_000, isGiftCard: true, trackStock: true, stock: 5, ...over });

beforeEach(seed);

describe("produit carte cadeau", () => {
  it("création : drapeau et validité enregistrés, jamais de suivi de stock, TVA exonérée, product.created une fois", async () => {
    const r = await saveProduct(STORE, giftPayload({ giftCardValidityDays: 400 }));
    expect(r.ok).toBe(true);
    expect(product()).toMatchObject({ isGiftCard: true, giftCardValidityDays: 400, trackStock: false, stock: 0, taxCategory: "exempt" });
    expect(state.events.filter((e) => e.event === "product.created")).toHaveLength(1);
  });

  it("valeurs faciales : variantes = valeurs, bornées par la devise", async () => {
    const options = [{ name: "Montant", type: "text", values: [{ value: "10000" }, { value: "900000" }] }];
    const variants = [
      { attributes: { Montant: "10000" }, price: 10_000 },
      { attributes: { Montant: "900000" }, price: 900_000 },
    ];
    const r = await saveProduct(STORE, giftPayload({ options, variants }));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/entre 1000 et 500000 XOF/);
    expect(giftCardFaceValueIssue({ price: 25_000, variants: [] }, "XOF")).toBeNull();
    expect(giftCardFaceValueIssue({ price: 500, variants: [] }, "XOF")).not.toBeNull();
  });

  it("plan sans cartes cadeaux : refusé ; suppléments et promotion : refusés", async () => {
    state.features.giftCards = false;
    const gated = await saveProduct(STORE, giftPayload());
    expect(gated.ok ? "" : gated.error).toMatch(/cartes cadeaux ne sont pas incluses/);
    state.features.giftCards = true;
    const withGroups = await saveProduct(STORE, giftPayload({ optionGroups: [{ name: "Emballage", options: [{ name: "Papier", priceDelta: 500 }] }] }));
    expect(withGroups.ok).toBe(false);
    const withPromo = await saveProduct(STORE, giftPayload({ promoPrice: 8_000 }));
    expect(withPromo.ok).toBe(false);
    expect(state.fake.tables.product).toHaveLength(0);
  });

  it("validité hors bornes refusée ; désactiver le drapeau remet un produit normal", async () => {
    expect((await saveProduct(STORE, giftPayload({ giftCardValidityDays: 30 }))).ok).toBe(false);
    const r = await saveProduct(STORE, giftPayload());
    expect(r.ok).toBe(true);
    const id = product().id;
    const off = await saveProduct(STORE, { productId: id, name: "Carte cadeau", price: 10_000, isGiftCard: false });
    expect(off.ok).toBe(true);
    // M : la catégorie fiscale redevient « standard » (sinon le produit resterait exonéré de TVA à vie).
    expect(product()).toMatchObject({ isGiftCard: false, giftCardValidityDays: null, taxCategory: "standard" });
    expect(state.events.map((e) => e.event)).toEqual(["product.created", "product.updated"]);
  });

  it("charge utile sans drapeau (import, anciens clients) : la carte cadeau reste une carte cadeau, sans stock", async () => {
    await saveProduct(STORE, giftPayload());
    const id = product().id;
    const r = await saveProduct(STORE, { productId: id, name: "Carte cadeau Noël", price: 15_000, trackStock: true, stock: 3 });
    expect(r.ok).toBe(true);
    expect(product()).toMatchObject({ isGiftCard: true, trackStock: false, name: "Carte cadeau Noël", taxCategory: "exempt" });
  });

  it("drapeau absent sur un produit NORMAL : la catégorie fiscale saisie dans la fiche est conservée", async () => {
    expect((await saveProduct(STORE, { name: "Riz", price: 5_000 })).ok).toBe(true);
    const id = product().id;
    product().taxCategory = "reduced"; // posé par la carte « Taxes » de la fiche produit
    expect((await saveProduct(STORE, { productId: id, name: "Riz 5 kg", price: 6_000 })).ok).toBe(true);
    expect(product()).toMatchObject({ name: "Riz 5 kg", taxCategory: "reduced" });
  });
});

describe("import CSV : champs personnalisés et webhooks", () => {
  const mapping = ["handle", "title", "price", ""] as const;

  it("cellules metafield de la 1re ligne du produit transmises ; colonnes inconnues signalées ; une erreur de champ n'annule pas le produit", async () => {
    state.mfErrors = { def_1: "Texte trop long" };
    const rows = [
      ["robe-wax", "Robe wax", "15000", "Wax hollandais", "x"],
      ["pagne", "Pagne", "8000", "", "y"],
    ];
    const r = await importCatalog(STORE, {
      rows,
      mapping: [...mapping],
      firstLine: 2,
      metafieldColumns: [
        { index: 3, header: "metafield:custom.matiere" },
        { index: 4, header: "metafield:custom.inconnu" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data!.created).toBe(2);
    expect(state.mfRows).toHaveLength(2);
    expect(state.mfRows[0].row["metafield:custom.matiere"]).toBe("Wax hollandais");
    expect(state.mfRows[1].row["metafield:custom.matiere"]).toBe("");
    expect(r.data!.errors.some((e) => e.message.includes("metafield:custom.inconnu"))).toBe(true);
    expect(r.data!.errors.filter((e) => e.message.includes("Texte trop long"))).toHaveLength(2);
    expect(state.events.filter((e) => e.event === "product.created")).toHaveLength(2);
    expect(state.events[0].data).toMatchObject({ source: "csv_import" });
  });

  // Un export maison peut compter jusqu'à 100 champs personnalisés (plan Business) : la largeur d'une ligne
  // dépasse alors largement les colonnes du catalogue. L'import doit l'accepter (constat : index borné à 59).
  it("aller-retour export → import avec 40 champs personnalisés", async () => {
    const mfHeaders = Array.from({ length: 40 }, (_, i) => `metafield:custom.champ${i + 1}`);
    const extra = Object.fromEntries(mfHeaders.map((h, i) => [h, `valeur ${i + 1}`]));
    const { headers, rows } = exportCatalogRows(
      [{ slug: "robe-wax", name: "Robe wax", description: null, vendor: null, productType: null, tags: [], status: "ACTIVE", collection: null, seoTitle: null, seoDescription: null, price: 15_000, compareAtPrice: null, costPrice: null, sku: null, trackStock: false, stock: 0, weightGrams: null, images: [], options: [], variants: [], extra }],
      mfHeaders,
    );
    expect(headers).toHaveLength(CSV_COLUMNS.length + 40);
    expect(headers.length).toBeGreaterThan(60);

    const mapping = headers.map(guessColumn);
    const metafieldColumns = metafieldHeaderColumns(headers);
    expect(metafieldColumns).toHaveLength(40);
    const r = await importCatalog(STORE, { rows: rows.map((row) => row.map(String)), mapping, firstLine: 2, metafieldColumns });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data!.errors).toEqual([]);
    expect(r.data!.created).toBe(1);
    expect(product()).toMatchObject({ slug: "robe-wax", name: "Robe wax", price: 15_000 });
    expect(state.mfRows).toHaveLength(1);
    expect(state.mfRows[0].row["metafield:custom.champ40"]).toBe("valeur 40");
  });

  it("export : colonnes metafield après les colonnes du catalogue, sur la 1re ligne du produit seulement", () => {
    const base = { slug: "robe", name: "Robe", description: null, vendor: null, productType: null, tags: [], status: "ACTIVE", collection: null, seoTitle: null, seoDescription: null, price: 1000, compareAtPrice: null, costPrice: null, sku: null, trackStock: false, stock: 0, weightGrams: null, images: [], options: [{ name: "Taille", type: "size" as const, values: [{ value: "S" }, { value: "M" }] }] };
    const variants = ["S", "M"].map((t) => ({ attributes: { Taille: t }, price: null, compareAtPrice: null, sku: null, barcode: null, stock: 0, weightGrams: null, imageUrl: null, available: true }));
    const { headers, rows } = exportCatalogRows([{ ...base, variants, extra: { "metafield:custom.matiere": "Wax" } }], ["metafield:custom.matiere"]);
    expect(headers.at(-1)).toBe("metafield:custom.matiere");
    expect(rows).toHaveLength(2);
    expect(rows[0][CSV_COLUMNS.length]).toBe("Wax");
    expect(rows[1][CSV_COLUMNS.length]).toBe("");
    expect(metafieldHeaderColumns(["Handle", "Titre", " metafield:custom.matiere ", "Prix"])).toEqual([{ index: 2, header: "metafield:custom.matiere" }]);
  });
});

describe("fonctions pures de raccordement", () => {
  it("remise liée d'une offre : condition posée, retirée, inchangée", () => {
    const cfg = { target: { all: true }, value: { type: "PERCENT", amount: 10 }, perUnit: false, excludeOnSale: true };
    const on = linkedDiscountConfig(cfg, ["prod_aaaaaaaa", "prod_aaaaaaaa", "prod_bbbbbbbb"]);
    expect(on && "config" in on ? (on.config as any).requiresProductsInCart : null).toEqual(["prod_aaaaaaaa", "prod_bbbbbbbb"]);
    const withReq = { ...cfg, requiresProductsInCart: ["prod_aaaaaaaa"] };
    expect(discountRequiresProducts(withReq)).toBe(true);
    expect(linkedDiscountConfig(withReq, ["prod_aaaaaaaa"])).toBeNull();
    const off = linkedDiscountConfig(withReq, null);
    expect(off && "config" in off ? "requiresProductsInCart" in (off.config as object) : true).toBe(false);
    expect(linkedDiscountConfig({ broken: true }, ["prod_aaaaaaaa"])).toBeNull();
  });

  it("portefeuille du payeur : seulement pour un moyen en ligne qui le propose ; numéro normalisé", () => {
    const gw = { kind: "GATEWAY", channels: ["mtn_momo", "moov_money"] };
    expect(gatewayPayerOf(gw, "mtn_momo", "97 00 00 00", "229")).toEqual({ channel: "mtn_momo", payerPhone: "2290197000000" });
    expect(gatewayPayerOf(gw, "wave", "97000000", "229")).toEqual({});
    expect(gatewayPayerOf({ kind: "MOBILE_MONEY_MANUAL", channels: ["mtn_momo"] }, "mtn_momo", "97000000", "229")).toEqual({});
    expect(gatewayPayerOf(gw, "moov_money", null, "229")).toEqual({ channel: "moov_money" });
    expect(() => gatewayPayerOf(gw, "mtn_momo", "12", "229")).toThrow(/Numéro du portefeuille invalide/);
  });

  it("montant indicatif en devise d'affichage", () => {
    expect(presentmentTotalText({ currency: "XOF", presentmentCurrency: "EUR", presentmentTotal: 1000 })).toMatch(/10,00/);
    expect(presentmentTotalText({ currency: "XOF", presentmentCurrency: null, presentmentTotal: null })).toBeNull();
    expect(presentmentTotalText({ currency: "XOF", presentmentCurrency: "XOF", presentmentTotal: 5000 })).toBeNull();
  });
});
