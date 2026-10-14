import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Montée en gamme (offre au panier, mode `replace`, spec lot 1 §2) :
 *  - `matchUpgradeSelection` (pur) : mêmes valeurs d'options par nom, suppléments, groupes obligatoires ;
 *  - `resolveOfferUpgrade` (fake-db) : revalidation serveur (offre, mode, boutique, déclencheur, disponibilité) ;
 *  - `cartActions().replace` : remplacement à la même position, fusion avec une ligne identique.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ fake: null as any, rateOk: true }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: state.rateOk, retryAfter: 0 }),
  clientIp: async () => "1.2.3.4",
}));
vi.mock("@/lib/auth/permissions", () => ({ effectivePlanId: (sub: { planId?: string } | null) => sub?.planId ?? "FREE" }));

import { matchUpgradeSelection, normalizeOptionLabel, readVariantAttributes, type UpgradeTarget } from "@/lib/discounts/upgrade";
import { resolveOfferUpgrade } from "@/lib/storefront/offer-actions";
import { cartActions, readCartLines } from "@/components/storefront/cart-store";

describe("matchUpgradeSelection", () => {
  const target: UpgradeTarget = {
    variants: [
      { id: "v_s", attributes: { Taille: "S" }, purchasable: true },
      { id: "v_m", attributes: { Taille: "M" }, purchasable: true },
      { id: "v_l", attributes: { Taille: "L" }, purchasable: false },
    ],
    optionGroups: [{ id: "g_emb", name: "Emballage", required: false, minSelect: 0, maxSelect: 1, options: [{ id: "o_gift", name: "Paquet cadeau" }] }],
  };

  it("même valeur d'option par nom (casse, accents et espaces ignorés), option en trop sans objet", () => {
    expect(matchUpgradeSelection({ attributes: { " taille ": "m", Couleur: "Rouge" }, options: [] }, target)).toEqual({ variantId: "v_m", optionIds: [] });
    expect(normalizeOptionLabel("  Écru  Clair ")).toBe("ecru clair");
  });
  it("valeur absente, variante non achetable ou option du produit proposé inconnue de la ligne : fiche (null)", () => {
    expect(matchUpgradeSelection({ attributes: { Taille: "XL" }, options: [] }, target)).toBeNull();
    expect(matchUpgradeSelection({ attributes: { Taille: "L" }, options: [] }, target)).toBeNull();
    expect(matchUpgradeSelection({ attributes: {}, options: [] }, target)).toBeNull();
    expect(matchUpgradeSelection({ attributes: { Couleur: "Rouge" }, options: [] }, target)).toBeNull();
  });
  it("suppléments repris par nom de groupe et d'option ; supplément sans équivalent : null", () => {
    expect(matchUpgradeSelection({ attributes: { Taille: "S" }, options: [{ group: "emballage", name: "paquet cadeau" }] }, target)).toEqual({ variantId: "v_s", optionIds: ["o_gift"] });
    expect(matchUpgradeSelection({ attributes: { Taille: "S" }, options: [{ group: "Gravure", name: "Initiales" }] }, target)).toBeNull();
  });
  it("produit proposé sans variante : variante nulle ; groupe obligatoire non rempli ou maximum dépassé : null", () => {
    const simple: UpgradeTarget = { variants: [], optionGroups: [{ id: "g_s", name: "Sauce", required: true, minSelect: 1, maxSelect: 1, options: [{ id: "o_a", name: "Piment" }, { id: "o_b", name: "Moutarde" }] }] };
    expect(matchUpgradeSelection({ attributes: { Taille: "M" }, options: [{ group: "Sauce", name: "Piment" }] }, simple)).toEqual({ variantId: null, optionIds: ["o_a"] });
    expect(matchUpgradeSelection({ attributes: {}, options: [] }, simple)).toBeNull();
    expect(matchUpgradeSelection({ attributes: {}, options: [{ group: "Sauce", name: "Piment" }, { group: "Sauce", name: "Moutarde" }] }, simple)).toBeNull();
  });
  it("lecture défensive des attributs JSON", () => {
    expect(readVariantAttributes({ Taille: "M", Vide: "", N: 3 })).toEqual({ Taille: "M" });
    expect(readVariantAttributes(["M"])).toEqual({});
    expect(readVariantAttributes(null)).toEqual({});
  });
});

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";

function seed() {
  state.rateOk = true;
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "boutique-a", status: "PUBLISHED" },
      { id: B, slug: "boutique-b", status: "PUBLISHED" },
    ],
    subscription: [
      { id: "sub_A", storeId: A, planId: "BUSINESS" },
      { id: "sub_B", storeId: B, planId: "BUSINESS" },
    ],
    category: [{ id: "col_tee_0001", storeId: A, name: "T-shirts", rules: null, position: 0 }],
    product: [
      { id: "prod_basic01", storeId: A, name: "T-shirt basique", slug: "tee-basique", status: "ACTIVE", isGiftCard: false, price: 5_000, trackStock: true, stock: 0, inventoryPolicy: "DENY", minQty: 1, maxQty: null, images: [], categoryId: "col_tee_0001" },
      { id: "prod_prem001", storeId: A, name: "T-shirt premium", slug: "tee-premium", status: "ACTIVE", isGiftCard: false, price: 9_000, promoPrice: null, trackStock: true, stock: 0, inventoryPolicy: "DENY", minQty: 1, maxQty: 3, images: [{ url: "https://cdn.example.com/p.jpg" }] },
      { id: "prod_B_00001", storeId: B, name: "Produit B", slug: "produit-b", status: "ACTIVE", isGiftCard: false, price: 1_000, trackStock: false, stock: 0, minQty: 1, images: [] },
    ],
    variant: [
      { id: "var_basic_M", productId: "prod_basic01", name: "M / Blanc", attributes: { Taille: "M", Couleur: "Blanc" }, price: null, available: true, stock: 5, inventoryPolicy: "DENY", position: 0 },
      { id: "var_prem_S", productId: "prod_prem001", name: "S", attributes: { Taille: "S" }, price: null, available: true, stock: 5, inventoryPolicy: "DENY", position: 0 },
      { id: "var_prem_M", productId: "prod_prem001", name: "M", attributes: { Taille: "M" }, price: 9_500, available: true, stock: 2, inventoryPolicy: "DENY", position: 1 },
    ],
    optionGroup: [
      { id: "grp_basic_e", productId: "prod_basic01", name: "Emballage", required: false, minSelect: 0, maxSelect: 1, position: 0 },
      { id: "grp_prem_e", productId: "prod_prem001", name: "Emballage", required: false, minSelect: 0, maxSelect: 1, position: 0 },
    ],
    option: [
      { id: "opt_basic_gift", groupId: "grp_basic_e", name: "Paquet cadeau", priceDelta: 300, position: 0 },
      { id: "opt_prem_gift", groupId: "grp_prem_e", name: "Paquet cadeau", priceDelta: 500, position: 0 },
    ],
    cartOffer: [
      { id: "offer_up_001", storeId: A, title: "Passez au premium", placement: "CART", mode: "replace", triggerProductIds: ["prod_basic01"], triggerCollectionIds: [], offerProductIds: ["prod_prem001"], active: true, position: 0 },
      { id: "offer_add_01", storeId: A, title: "Vente croisée", placement: "CART", mode: "add", triggerProductIds: ["prod_basic01"], triggerCollectionIds: [], offerProductIds: ["prod_prem001"], active: true, position: 1 },
      { id: "offer_col_01", storeId: A, title: "Par collection", placement: "CART", mode: "replace", triggerProductIds: [], triggerCollectionIds: ["col_tee_0001"], offerProductIds: ["prod_prem001"], active: true, position: 2 },
    ],
  });
}

const line = (over: Partial<{ key: string; productId: string; variantId: string | null; optionIds: string[]; quantity: number }> = {}) => ({
  key: "prod_basic01:var_basic_M:opt_basic_gift",
  productId: "prod_basic01",
  variantId: "var_basic_M" as string | null,
  optionIds: ["opt_basic_gift"],
  quantity: 2,
  ...over,
});

describe("resolveOfferUpgrade (serveur)", () => {
  beforeEach(seed);

  it("remplace la ligne déclencheuse : même taille, même supplément, même quantité, prix indicatif recalculé", async () => {
    const r = await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line()] });
    expect(r).toEqual({
      kind: "replaced",
      key: "prod_basic01:var_basic_M:opt_basic_gift",
      fromName: "T-shirt basique",
      line: {
        productId: "prod_prem001",
        variantId: "var_prem_M",
        optionIds: ["opt_prem_gift"],
        quantity: 2,
        snapshot: { name: "T-shirt premium", variantName: "M", unitPrice: 10_000, image: "https://cdn.example.com/p.jpg", productSlug: "tee-premium", optionNames: ["Paquet cadeau"] },
      },
    });
  });

  it("quantité jamais ajustée en silence : au-delà du stock ou du maximum, fiche, sans divulguer le stock", async () => {
    // Stock de la variante M : 2 ; maximum du produit proposé : 3.
    for (const quantity of [3, 9]) {
      const r = await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line({ quantity })] });
      expect(r).toEqual({ kind: "choose", href: "/s/boutique-a/p/tee-premium" });
      expect(JSON.stringify(r)).not.toMatch(/stock|quantity|"2"/);
    }
    state.fake.tables.variant.find((v: any) => v.id === "var_prem_M").stock = 10;
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line({ quantity: 4 })] })).toMatchObject({ kind: "choose" });
  });

  it("quantité sous le minimum du produit proposé : fiche", async () => {
    state.fake.tables.product.find((p: any) => p.id === "prod_prem001").minQty = 3;
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line({ quantity: 2 })] })).toEqual({ kind: "choose", href: "/s/boutique-a/p/tee-premium" });
  });

  it("ligne source carte cadeau ou produit source archivé : jamais remplacée", async () => {
    const basic = state.fake.tables.product.find((p: any) => p.id === "prod_basic01");
    basic.isGiftCard = true;
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line()] })).toMatchObject({ kind: "choose" });
    basic.isGiftCard = false;
    basic.status = "ARCHIVED";
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line()] })).toMatchObject({ kind: "choose" });
  });

  it("variante cible correspondante désactivée (indisponible) : fiche", async () => {
    state.fake.tables.variant.find((v: any) => v.id === "var_prem_M").available = false;
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line()] })).toEqual({ kind: "choose", href: "/s/boutique-a/p/tee-premium" });
  });

  it("déclencheur par collection", async () => {
    const r = await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_col_01", productId: "prod_prem001", lines: [line({ optionIds: [] })] });
    expect(r).toMatchObject({ kind: "replaced", line: { variantId: "var_prem_M", optionIds: [] } });
  });

  it("aucune valeur correspondante : la fiche du produit proposé s'ouvre", async () => {
    state.fake.tables.variant.find((v: any) => v.id === "var_basic_M").attributes = { Taille: "XXL" };
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line()] })).toEqual({ kind: "choose", href: "/s/boutique-a/p/tee-premium" });
  });

  it("variante correspondante épuisée : fiche", async () => {
    state.fake.tables.variant.find((v: any) => v.id === "var_prem_M").stock = 0;
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line()] })).toMatchObject({ kind: "choose", href: "/s/boutique-a/p/tee-premium" });
  });

  it("aucun article déclencheur au panier : fiche", async () => {
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line({ key: "x:y:z", productId: "prod_prem001", variantId: "var_prem_S", optionIds: [] })] })).toMatchObject({ kind: "choose" });
  });

  it("refus : offre de mode « add », offre inactive, produit non proposé, autre boutique, plan sans offres, débit dépassé", async () => {
    const base = { storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line()] };
    expect(await resolveOfferUpgrade({ ...base, offerId: "offer_add_01" })).toEqual({ kind: "choose", href: null });
    expect(await resolveOfferUpgrade({ ...base, productId: "prod_B_00001" })).toEqual({ kind: "choose", href: null });
    expect(await resolveOfferUpgrade({ ...base, storeSlug: "boutique-b" })).toEqual({ kind: "choose", href: null });
    state.fake.tables.cartOffer[0].active = false;
    expect(await resolveOfferUpgrade(base)).toEqual({ kind: "choose", href: null });
    state.fake.tables.cartOffer[0].active = true;
    state.fake.tables.subscription[0].planId = "STARTER";
    expect(await resolveOfferUpgrade(base)).toEqual({ kind: "choose", href: null });
    state.fake.tables.subscription[0].planId = "BUSINESS";
    state.rateOk = false;
    expect(await resolveOfferUpgrade(base)).toEqual({ kind: "choose", href: null });
  });

  it("entrée invalide (identifiant malformé, quantité hors bornes) : refus sans lecture", async () => {
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "x", productId: "prod_prem001", lines: [line()] })).toEqual({ kind: "choose", href: null });
    expect(await resolveOfferUpgrade({ storeSlug: "boutique-a", offerId: "offer_up_001", productId: "prod_prem001", lines: [line({ quantity: 0 })] })).toEqual({ kind: "choose", href: null });
  });
});

describe("panier : cartActions().replace", () => {
  const snap = (name: string) => ({ name, variantName: null, unitPrice: 1_000, image: null, productSlug: name });

  it("remplace à la même position et ignore une ligne disparue", () => {
    const slug = "panier-replace";
    const cart = cartActions(slug);
    cart.add({ productId: "p1", variantId: null, optionIds: [], quantity: 2, snapshot: snap("p1") }, { open: false });
    cart.add({ productId: "p2", variantId: null, optionIds: [], quantity: 1, snapshot: snap("p2") }, { open: false });
    const first = readCartLines(slug)[0]!.key;
    expect(cart.replace(first, { productId: "p9", variantId: "v9", optionIds: [], quantity: 2, snapshot: snap("p9") })).toBe(true);
    expect(readCartLines(slug).map((l) => [l.productId, l.quantity, l.key])).toEqual([
      ["p9", 2, "p9:v9:"],
      ["p2", 1, "p2::"],
    ]);
    expect(cart.replace("absente", { productId: "p3", variantId: null, optionIds: [], quantity: 1, snapshot: snap("p3") })).toBe(false);
  });

  it("produit proposé déjà au panier avec la même sélection : quantités fusionnées", () => {
    const slug = "panier-fusion";
    const cart = cartActions(slug);
    cart.add({ productId: "p1", variantId: null, optionIds: [], quantity: 2, snapshot: snap("p1") }, { open: false });
    cart.add({ productId: "p9", variantId: null, optionIds: [], quantity: 1, snapshot: snap("p9") }, { open: false });
    cart.replace("p1::", { productId: "p9", variantId: null, optionIds: [], quantity: 2, snapshot: snap("p9") });
    expect(readCartLines(slug).map((l) => [l.productId, l.quantity])).toEqual([["p9", 3]]);
  });
});
