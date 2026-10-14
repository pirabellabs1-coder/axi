import { describe, it, expect } from "vitest";
import { evaluateLineDiscounts, evaluateCartTier, progressMessages, type EvalDiscount, type EvalLine } from "@/lib/discounts/evaluate";
import { readDiscountConfig, type DiscountKind } from "@/lib/discounts/schema";
import { selectCartOffers, offerRevenue, type OfferRow } from "@/lib/discounts/offers";
import { discountStatus, describeDiscount } from "@/lib/discounts/summary";

const line = (productId: string, unitPrice: number, quantity: number, over: Partial<EvalLine> = {}): EvalLine => ({ productId, unitPrice, quantity, collectionIds: [], isGiftCard: false, onSale: false, ...over });

function disc(id: string, kind: DiscountKind, config: unknown, over: Partial<EvalDiscount> = {}): EvalDiscount {
  const parsed = readDiscountConfig(kind, config);
  if (!parsed) throw new Error(`config invalide pour ${id}`);
  return { id, title: id, kind, priority: 0, combinesWithCoupons: true, combinesWithOtherAutomatic: true, parsed, ...over };
}

const ACC = "col_acc";
const bxgy = (over: Record<string, unknown> = {}) =>
  disc("bxgy", "BUY_X_GET_Y", {
    buy: { target: { collectionIds: [ACC] }, quantity: 2 },
    get: { target: { collectionIds: [ACC] }, quantity: 1, value: { type: "PERCENT", amount: 100 } },
    maxApplicationsPerOrder: 1,
    ...over,
  });

describe("BUY_X_GET_Y", () => {
  it("2 achetés = 1 offert : l'unité offerte est la moins chère", () => {
    const lines = [line("a", 5000, 1, { collectionIds: [ACC] }), line("b", 3000, 1, { collectionIds: [ACC] }), line("c", 4000, 1, { collectionIds: [ACC] })];
    const [r] = evaluateLineDiscounts(lines, [bxgy()]);
    expect(r.amount).toBe(3000);
    expect(r.perLine).toEqual([0, 3000, 0]);
    expect(r.applications).toBe(1);
  });

  it("même cible : il faut buy + get unités dans le panier", () => {
    const lines = [line("a", 5000, 2, { collectionIds: [ACC] })];
    expect(evaluateLineDiscounts(lines, [bxgy()])).toEqual([]);
    const three = [line("a", 5000, 3, { collectionIds: [ACC] })];
    expect(evaluateLineDiscounts(three, [bxgy()])[0].amount).toBe(5000);
  });

  it("maxApplicationsPerOrder : borne le nombre d'applications ; les moins chères restantes sont offertes", () => {
    const lines = [line("a", 10, 1, { collectionIds: [ACC] }), line("b", 8, 1, { collectionIds: [ACC] }), line("c", 6, 1, { collectionIds: [ACC] }), line("d", 4, 1, { collectionIds: [ACC] }), line("e", 2, 1, { collectionIds: [ACC] }), line("f", 1, 1, { collectionIds: [ACC] })];
    const one = evaluateLineDiscounts(lines, [bxgy()])[0];
    expect(one.amount).toBe(1);
    const two = evaluateLineDiscounts(lines, [bxgy({ maxApplicationsPerOrder: 2 })])[0];
    expect(two.applications).toBe(2);
    expect(two.amount).toBe(1 + 2);
  });

  it("cibles différentes : les unités « achetées » non offrables sont utilisées en priorité", () => {
    const d = disc("x", "BUY_X_GET_Y", { buy: { target: { all: true }, quantity: 2 }, get: { target: { productIds: ["y"] }, quantity: 1, value: { type: "PERCENT", amount: 50 } } });
    const lines = [line("y", 100, 1), line("z", 50, 2)];
    const [r] = evaluateLineDiscounts(lines, [d]);
    expect(r.perLine).toEqual([50, 0]);
  });

  it("excludeOnSale (défaut) : les unités en promo datée ne sont pas éligibles ; false les accepte", () => {
    const lines = [line("a", 5000, 3, { collectionIds: [ACC], onSale: true })];
    expect(evaluateLineDiscounts(lines, [bxgy()])).toEqual([]);
    expect(evaluateLineDiscounts(lines, [bxgy({ excludeOnSale: false })])[0].amount).toBe(5000);
  });

  it("achat par montant minimum", () => {
    const d = disc("m", "BUY_X_GET_Y", { buy: { target: { productIds: ["a"] }, minAmount: 10000 }, get: { target: { productIds: ["g"] }, quantity: 1, value: { type: "FIXED_AMOUNT", amount: 1500 } } });
    expect(evaluateLineDiscounts([line("a", 6000, 1), line("g", 2000, 1)], [d])).toEqual([]);
    expect(evaluateLineDiscounts([line("a", 6000, 2), line("g", 2000, 1)], [d])[0].perLine).toEqual([0, 1500]);
  });

  it("une unité reçoit au plus une remise de ligne ; priorité puis économie puis id", () => {
    const pct = disc("pct", "PRODUCT_AMOUNT", { target: { collectionIds: [ACC] }, value: { type: "PERCENT", amount: 10 } });
    const lines = [line("a", 5000, 3, { collectionIds: [ACC] })];
    // Sans priorité : la plus forte économie (offert = 5000 > 10 % = 1500) passe d'abord et consomme les 3 unités.
    const r1 = evaluateLineDiscounts(lines, [pct, bxgy()]);
    expect(r1.map((x) => x.discount.id)).toEqual(["bxgy"]);
    // Priorité supérieure : le pourcentage consomme toutes les unités, plus rien pour l'offre.
    const r2 = evaluateLineDiscounts(lines, [{ ...pct, priority: 5 }, bxgy()]);
    expect(r2.map((x) => x.discount.id)).toEqual(["pct"]);
    expect(r2[0].amount).toBe(1500);
  });

  it("lignes carte cadeau jamais éligibles", () => {
    const all = disc("all", "PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount: 50 } });
    const [r] = evaluateLineDiscounts([line("gc", 10000, 1, { isGiftCard: true }), line("a", 1000, 1)], [all]);
    expect(r.perLine).toEqual([0, 500]);
  });

  it("référence disparue : ignorée sans erreur", () => {
    const gone = disc("gone", "PRODUCT_AMOUNT", { target: { productIds: ["deleted_product"] }, value: { type: "PERCENT", amount: 10 } });
    expect(evaluateLineDiscounts([line("a", 1000, 1)], [gone])).toEqual([]);
  });
});

describe("PRODUCT_AMOUNT", () => {
  it("montant fixe par unité, plafonné au prix", () => {
    const d = disc("f", "PRODUCT_AMOUNT", { target: { all: true }, value: { type: "FIXED_AMOUNT", amount: 700 }, perUnit: true });
    expect(evaluateLineDiscounts([line("a", 500, 2), line("b", 2000, 1)], [d])[0].perLine).toEqual([1000, 700]);
  });
  it("montant fixe global réparti au plus fort reste", () => {
    const d = disc("f", "PRODUCT_AMOUNT", { target: { all: true }, value: { type: "FIXED_AMOUNT", amount: 1000 } });
    const [r] = evaluateLineDiscounts([line("a", 1000, 1), line("b", 2000, 1)], [d]);
    expect(r.perLine).toEqual([333, 667]);
  });
  it("quantité minimale et produit requis au panier", () => {
    const d = disc("q", "PRODUCT_AMOUNT", { target: { all: true }, value: { type: "PERCENT", amount: 10 }, minQuantity: 3 });
    expect(evaluateLineDiscounts([line("a", 1000, 2)], [d])).toEqual([]);
    const req = disc("r", "PRODUCT_AMOUNT", { target: { productIds: ["b"] }, value: { type: "PERCENT", amount: 20 }, requiresProductsInCart: ["a"] });
    expect(evaluateLineDiscounts([line("b", 1000, 1)], [req])).toEqual([]);
    expect(evaluateLineDiscounts([line("a", 1000, 1), line("b", 1000, 1)], [req])[0].perLine).toEqual([0, 200]);
  });
});

describe("BUNDLE", () => {
  const bundle = disc("lot", "BUNDLE", { items: [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 2 }], price: { type: "FIXED_PRICE", amount: 15000 }, maxSets: 2 });
  it("lot complet : prix du lot réparti au plus fort reste sur ses lignes", () => {
    const [r] = evaluateLineDiscounts([line("a", 10000, 1), line("b", 5000, 2)], [bundle]);
    expect(r.amount).toBe(5000);
    expect(r.perLine).toEqual([2500, 2500]);
  });
  it("lots multiples (bornés par maxSets) ; lot incomplet ignoré", () => {
    expect(evaluateLineDiscounts([line("a", 10000, 3), line("b", 5000, 6)], [bundle])[0].applications).toBe(2);
    expect(evaluateLineDiscounts([line("a", 10000, 1), line("b", 5000, 1)], [bundle])).toEqual([]);
  });
  it("prix du lot supérieur à la somme : aucune remise", () => {
    expect(evaluateLineDiscounts([line("a", 1000, 1), line("b", 1000, 2)], [bundle])).toEqual([]);
  });
  it("variante exigée", () => {
    const v = disc("v", "BUNDLE", { items: [{ productId: "a", variantId: "va", quantity: 1 }, { productId: "b", quantity: 1 }], price: { type: "PERCENT", amount: 10 } });
    expect(evaluateLineDiscounts([line("a", 1000, 1, { variantId: "vb" }), line("b", 1000, 1)], [v])).toEqual([]);
    expect(evaluateLineDiscounts([line("a", 1000, 1, { variantId: "va" }), line("b", 1000, 1)], [v])[0].amount).toBe(200);
  });
});

describe("CART_TIER", () => {
  const tiers = disc("t", "CART_TIER", { tiers: [{ minSubtotal: 20000, value: { type: "PERCENT", amount: 5 } }, { minSubtotal: 50000, value: { type: "PERCENT", amount: 10 } }] });
  it("meilleur palier atteint, sur le net", () => {
    const lines = [line("a", 30000, 2)];
    const r = evaluateCartTier(lines, [60000], [tiers], 0);
    expect(r?.amount).toBe(6000);
    expect(evaluateCartTier(lines, [40000], [tiers], 0)?.amount).toBe(2000);
    expect(evaluateCartTier(lines, [10000], [tiers], 0)).toBeNull();
  });
  it("une seule remise de panier : la plus avantageuse ; livraison offerte valorisée aux frais", () => {
    const fixed = disc("f", "CART_TIER", { tiers: [{ minSubtotal: 10000, value: { type: "FIXED_AMOUNT", amount: 2500 } }] });
    const free = disc("d", "CART_TIER", { tiers: [{ minSubtotal: 10000, value: { type: "FREE_DELIVERY" } }] });
    expect(evaluateCartTier([line("a", 30000, 1)], [30000], [tiers, fixed, free], 2000)?.discount.id).toBe("f");
    expect(evaluateCartTier([line("a", 30000, 1)], [30000], [tiers, fixed, free], 3000)?.freeDelivery).toBe(true);
  });
  it("cartes cadeaux exclues de l'assiette", () => {
    expect(evaluateCartTier([line("gc", 50000, 1, { isGiftCard: true })], [50000], [tiers], 0)).toBeNull();
  });
  it("progression : « Plus que … pour −10 % »", () => {
    const msgs = progressMessages([line("a", 45000, 1)], [45000], [tiers], { lineIds: new Set(), tier: null }, "XOF");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ code: "tier_progress", remaining: 5000 });
    // Espaces insécables de formatMoney et du pourcentage : on normalise avant de comparer.
    expect(msgs[0].text.replace(/[  ]/g, " ")).toBe("Plus que 5 000 FCFA pour −10 %.");
  });
  it("progression X achetés = Y offerts", () => {
    const msgs = progressMessages([line("a", 1000, 2, { collectionIds: [ACC] })], [2000], [bxgy()], { lineIds: new Set(), tier: null }, "XOF");
    expect(msgs[0]).toMatchObject({ code: "bxgy_progress", remaining: 1 });
    expect(msgs[0].text).toMatch(/ajoutez 1 article éligible pour en recevoir 1 offert/);
  });
});

describe("offres au panier", () => {
  const offer = (over: Partial<OfferRow>): OfferRow => ({ id: "o1", title: "Offre", placement: "CART", mode: "add", triggerProductIds: ["robe"], triggerCollectionIds: [], offerProductIds: ["sac", "foulard"], automaticDiscountId: null, position: 0, active: true, ...over });
  const products = new Map([
    ["sac", { status: "ACTIVE", sellable: true }],
    ["foulard", { status: "ACTIVE", sellable: false }],
    ["ceinture", { status: "ACTIVE", sellable: true }],
    ["bijou", { status: "DRAFT", sellable: true }],
  ]);
  it("déclencheur requis, produits actifs, disponibles et absents du panier", () => {
    const sel = selectCartOffers([offer({})], { placement: "CART", contextProductIds: ["robe"], contextCollectionIds: [], cartProductIds: ["robe"], products });
    expect(sel.map((s) => s.productId)).toEqual(["sac"]);
    expect(selectCartOffers([offer({})], { placement: "CART", contextProductIds: ["autre"], contextCollectionIds: [], cartProductIds: [], products })).toEqual([]);
    expect(selectCartOffers([offer({})], { placement: "CART", contextProductIds: ["robe"], contextCollectionIds: [], cartProductIds: ["robe", "sac"], products })).toEqual([]);
  });
  it("4 maximum, tri par position, dédoublonnage, emplacement respecté", () => {
    const many = new Map(["p1", "p2", "p3", "p4", "p5"].map((id) => [id, { status: "ACTIVE", sellable: true }] as const));
    const offers = [offer({ id: "b", position: 2, offerProductIds: ["p3", "p4", "p5"] }), offer({ id: "a", position: 1, offerProductIds: ["p1", "p2", "p3"] }), offer({ id: "c", placement: "PRODUCT", offerProductIds: ["p5"] })];
    const sel = selectCartOffers(offers, { placement: "CART", contextProductIds: ["robe"], contextCollectionIds: [], cartProductIds: [], products: many });
    expect(sel.map((s) => `${s.offerId}:${s.productId}`)).toEqual(["a:p1", "a:p2", "a:p3", "b:p4"]);
  });
  it("déclencheur par collection ; chiffre d'affaires attribuable", () => {
    const sel = selectCartOffers([offer({ triggerProductIds: [], triggerCollectionIds: ["col"] })], { placement: "CART", contextProductIds: ["x"], contextCollectionIds: ["col"], cartProductIds: [], products });
    expect(sel).toHaveLength(1);
    expect(offerRevenue(["sac"], [{ productId: "sac", netTotal: 4000 }, { productId: "robe", netTotal: 9000 }])).toBe(4000);
  });
});

describe("statut et résumé", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("statut calculé : active, programmée, expirée, épuisée, désactivée", () => {
    expect(discountStatus({ active: true }, now)).toBe("active");
    expect(discountStatus({ active: true, startsAt: new Date("2026-11-20") }, now)).toBe("scheduled");
    expect(discountStatus({ active: true, endsAt: new Date("2026-11-01") }, now)).toBe("expired");
    expect(discountStatus({ active: true, maxUses: 3, usesCount: 3 }, now)).toBe("exhausted");
    expect(discountStatus({ active: false }, now)).toBe("inactive");
  });
  it("résumé en phrase", () => {
    const d = readDiscountConfig("BUY_X_GET_Y", { buy: { target: { collectionIds: ["w"] }, quantity: 2 }, get: { target: { collectionIds: ["w"] }, quantity: 1, value: { type: "PERCENT", amount: 100 } } })!;
    const s = describeDiscount(d, { currency: "XOF", collectionName: () => "Wax", timeZone: "Africa/Porto-Novo" }, { startsAt: new Date("2026-11-01T00:00:00+01:00"), endsAt: new Date("2026-11-30T23:59:59+01:00") });
    expect(s).toBe("Pour 2 articles de la collection Wax achetés, le moins cher est offert, du 1er au 30 novembre.");
  });
});
