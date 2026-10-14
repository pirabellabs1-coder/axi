import { z } from "zod";

/**
 * Configurations des remises automatiques (`AutomaticDiscount.config`), spécification lot 1 §2.
 * Union discriminée par `kind` ; validée à l'enregistrement (actions) et relue de façon tolérante à
 * l'évaluation (`readDiscountConfig` : une configuration invalide est ignorée, jamais d'erreur au checkout).
 * Module pur, partagé client / serveur (formulaires), testé (tests/discounts-schema.test.ts).
 */

export const DISCOUNT_KINDS = ["PRODUCT_AMOUNT", "BUY_X_GET_Y", "CART_TIER", "BUNDLE"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** Types réservés aux plans avec `advancedDiscounts` (Business+) ; les autres exigent `automaticDiscounts`. */
export const ADVANCED_KINDS: readonly DiscountKind[] = ["BUY_X_GET_Y", "BUNDLE"];

export const KIND_LABELS: Record<DiscountKind, string> = {
  PRODUCT_AMOUNT: "Remise sur des produits",
  BUY_X_GET_Y: "X achetés = Y offerts",
  CART_TIER: "Paliers de panier",
  BUNDLE: "Lot de produits",
};

const zIdStr = z.string().trim().min(1).max(64);
const zIdList = (max: number) =>
  z
    .array(zIdStr)
    .min(1, "Choisissez au moins un élément")
    .max(max)
    .transform((xs) => [...new Set(xs)]);
const zQty = z.number().int().min(1).max(100);
const zAmount = z.number().int().min(1).max(1_000_000_000);

/** Cible : tout le catalogue, une liste de produits ou une liste de collections. */
export const targetSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ productIds: zIdList(200) }).strict(),
  z.object({ collectionIds: zIdList(50) }).strict(),
]);
export type DiscountTarget = z.infer<typeof targetSchema>;

const percentValue = z.object({ type: z.literal("PERCENT"), amount: z.number().int().min(1, "Entre 1 et 100 %").max(100, "Entre 1 et 100 %") }).strict();
const fixedValue = z.object({ type: z.literal("FIXED_AMOUNT"), amount: zAmount }).strict();
export const valueSchema = z.discriminatedUnion("type", [percentValue, fixedValue]);
export type DiscountValue = z.infer<typeof valueSchema>;

export const productAmountConfigSchema = z
  .object({
    target: targetSchema,
    value: valueSchema,
    /** Montant fixe : par unité (true) ou une fois sur l'ensemble des unités éligibles (false). Sans effet en %. */
    perUnit: z.boolean().default(false),
    minQuantity: zQty.optional(),
    excludeOnSale: z.boolean().default(true),
    /** Offre au panier liée : la remise ne s'applique que si l'un de ces produits est au panier. */
    requiresProductsInCart: z.array(zIdStr).max(50).optional(),
  })
  .strict();

const buyByQuantity = z.object({ target: targetSchema, quantity: zQty }).strict();
const buyByAmount = z.object({ target: targetSchema, minAmount: zAmount }).strict();

export const buyXGetYConfigSchema = z
  .object({
    buy: z.union([buyByQuantity, buyByAmount]),
    get: z.object({ target: targetSchema, quantity: zQty, value: valueSchema }).strict(),
    maxApplicationsPerOrder: z.number().int().min(1).max(20).default(1),
    excludeOnSale: z.boolean().default(true),
  })
  .strict();

const tierValue = z.discriminatedUnion("type", [percentValue, fixedValue, z.object({ type: z.literal("FREE_DELIVERY"), amount: z.number().int().min(0).max(0).default(0) }).strict()]);

export const cartTierConfigSchema = z
  .object({
    tiers: z
      .array(z.object({ minSubtotal: z.number().int().min(1, "Seuil minimum : 1").max(1_000_000_000), value: tierValue }).strict())
      .min(1, "Ajoutez au moins un palier")
      .max(5, "5 paliers maximum"),
    target: targetSchema.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (let i = 1; i < c.tiers.length; i++) {
      if (c.tiers[i].minSubtotal <= c.tiers[i - 1].minSubtotal) {
        ctx.addIssue({ code: "custom", path: ["tiers", i, "minSubtotal"], message: "Les seuils doivent être strictement croissants" });
      }
    }
  });

export const bundleConfigSchema = z
  .object({
    items: z
      .array(z.object({ productId: zIdStr, variantId: zIdStr.nullable().optional(), quantity: zQty }).strict())
      .min(2, "Un lot contient au moins 2 produits")
      .max(6, "6 produits maximum"),
    price: z.discriminatedUnion("type", [z.object({ type: z.literal("FIXED_PRICE"), amount: zAmount }).strict(), percentValue]),
    maxSets: z.number().int().min(1).max(10).default(1),
    excludeOnSale: z.boolean().default(true),
  })
  .strict()
  .superRefine((c, ctx) => {
    const keys = c.items.map((i) => `${i.productId}:${i.variantId ?? ""}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Un même produit figure deux fois dans le lot : augmentez plutôt sa quantité" });
  });

export type ProductAmountConfig = z.infer<typeof productAmountConfigSchema>;
export type BuyXGetYConfig = z.infer<typeof buyXGetYConfigSchema>;
export type CartTierConfig = z.infer<typeof cartTierConfigSchema>;
export type BundleConfig = z.infer<typeof bundleConfigSchema>;

export const discountConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PRODUCT_AMOUNT"), config: productAmountConfigSchema }),
  z.object({ kind: z.literal("BUY_X_GET_Y"), config: buyXGetYConfigSchema }),
  z.object({ kind: z.literal("CART_TIER"), config: cartTierConfigSchema }),
  z.object({ kind: z.literal("BUNDLE"), config: bundleConfigSchema }),
]);
export type ParsedDiscount = z.infer<typeof discountConfigSchema>;

/** Validation stricte (enregistrement). */
export function parseDiscountConfig(kind: string, config: unknown): { ok: true; value: ParsedDiscount } | { ok: false; error: string; path: (string | number)[] } {
  const r = discountConfigSchema.safeParse({ kind, config });
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: issue?.message ?? "Configuration invalide", path: (issue?.path ?? []).slice(1).map((p) => (typeof p === "symbol" ? String(p) : p)) };
}

/** Lecture tolérante (évaluation) : null si la configuration stockée est invalide. */
export function readDiscountConfig(kind: string, config: unknown): ParsedDiscount | null {
  const r = discountConfigSchema.safeParse({ kind, config });
  return r.success ? r.data : null;
}

/** Références d'une configuration (vérification d'appartenance à la boutique à l'enregistrement). */
export function configReferences(d: ParsedDiscount): { productIds: string[]; collectionIds: string[]; variantIds: string[] } {
  const productIds = new Set<string>();
  const collectionIds = new Set<string>();
  const variantIds = new Set<string>();
  const addTarget = (t: DiscountTarget | undefined) => {
    if (!t) return;
    if ("productIds" in t) t.productIds.forEach((x) => productIds.add(x));
    if ("collectionIds" in t) t.collectionIds.forEach((x) => collectionIds.add(x));
  };
  switch (d.kind) {
    case "PRODUCT_AMOUNT":
      addTarget(d.config.target);
      d.config.requiresProductsInCart?.forEach((x) => productIds.add(x));
      break;
    case "BUY_X_GET_Y":
      addTarget(d.config.buy.target);
      addTarget(d.config.get.target);
      break;
    case "CART_TIER":
      addTarget(d.config.target);
      break;
    case "BUNDLE":
      for (const i of d.config.items) {
        productIds.add(i.productId);
        if (i.variantId) variantIds.add(i.variantId);
      }
      break;
  }
  return { productIds: [...productIds], collectionIds: [...collectionIds], variantIds: [...variantIds] };
}

/* ───────────────────────── Offres au panier ───────────────────────── */

export const CART_OFFER_PLACEMENTS = ["PRODUCT", "CART", "CHECKOUT"] as const;
export type CartOfferPlacement = (typeof CART_OFFER_PLACEMENTS)[number];
export const PLACEMENT_LABELS: Record<CartOfferPlacement, string> = {
  PRODUCT: "Fiche produit (« Souvent achetés ensemble »)",
  CART: "Panier et tiroir",
  CHECKOUT: "Paiement (au-dessus du total)",
};
export const CART_OFFER_MODES = ["add", "replace"] as const;
export type CartOfferMode = (typeof CART_OFFER_MODES)[number];
