import { z } from "zod";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import { MAX_OPTIONS, MAX_OPTION_VALUES, MAX_VARIANTS, attrKey, type ProductOption } from "./variants";
import { MAX_GIFT_CARD_VALIDITY_DAYS, MIN_GIFT_CARD_VALIDITY_DAYS, giftCardLimits } from "@/lib/giftcards/state";
import { PRODUCT_KINDS, type ProductKindValue } from "@/lib/digital/kinds";
import { MAX_DOWNLOAD_LIMIT, MAX_DOWNLOAD_VALIDITY_DAYS } from "@/lib/digital/rules";

/** Schémas partagés client / serveur pour le catalogue (pas de directive "use server" ici). */

export const MAX_IMAGE_BYTES = 300 * 1024;
/** Plafond technique (le plan applique sa propre limite, vérifiée côté serveur). */
export const SERVER_MAX_IMAGES = 10;
export const MAX_DETAILS = 10;
export const MAX_TAGS = 50;
export const MAX_DESCRIPTION = 10_000;

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Longueur max d'une data-URL héritée (~300 Ko binaires encodés en base64). */
const MAX_IMAGE_DATA_URL = Math.floor(MAX_IMAGE_BYTES * 1.37) + 64;
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export const imageUrlSchema = z
  .string()
  .min(1)
  .refine((u) => (u.startsWith("data:") ? u.length <= MAX_IMAGE_DATA_URL : u.length <= 2000), "Adresse d'image trop longue")
  // Écriture : https ou média téléversé (/media/… ou STORAGE_PUBLIC_URL). Une data-URL raster bornée passe ce schéma
  // uniquement pour qu'un produit ancien reste modifiable avant `pnpm media:migrate` : la garde serveur
  // (`checkImageWrite`, src/lib/storage/write-guard.ts) n'accepte qu'une valeur IDENTIQUE à l'existant.
  .refine((u) => DATA_IMAGE.test(u) || /^https:\/\/[^\s"'<>]+$/i.test(u) || isStoredMediaUrl(u), "URL d'image invalide (https ou image téléversée)");

export const imageSchema = z.object({
  url: imageUrlSchema,
  alt: z.string().trim().max(160).default(""),
});

const money = z.number().int().min(0).max(1_000_000_000);
/** Stock : peut être négatif (survente en politique « continuer à vendre »), uniquement s'il n'est pas modifié (= base). */
const stockQty = z.number().int().min(-1_000_000).max(1_000_000);
const inventoryPolicy = z.enum(["DENY", "CONTINUE"]).default("DENY");
/** Une quantité saisie ne peut pas être négative ; une valeur négative relue telle quelle (stock = base) est acceptée. */
const negativeStockIssue = (stock: number, base: number | null) => stock < 0 && stock !== base;
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const optionValueSchema = z.object({
  value: z.string().trim().min(1, "Valeur vide").max(40),
  swatch: z
    .string()
    .trim()
    .regex(HEX_COLOR, "Couleur au format #RRGGBB")
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  image: imageUrlSchema.nullish().transform((v) => v ?? null),
});

export const productOptionSchema = z
  .object({
    name: z.string().trim().min(1, "Nom d'option requis").max(40),
    type: z.enum(["color", "size", "text"]).default("text"),
    values: z.array(optionValueSchema).min(1, "Ajoutez au moins une valeur").max(MAX_OPTION_VALUES, `${MAX_OPTION_VALUES} valeurs maximum`),
  })
  .superRefine((o, ctx) => {
    const seen = new Set<string>();
    for (const v of o.values) {
      const k = v.value.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: `Valeur en double : « ${v.value} » (${o.name})`, path: ["values"] });
      seen.add(k);
    }
  });

export const optionsSchema = z
  .array(productOptionSchema)
  .max(MAX_OPTIONS, `${MAX_OPTIONS} options maximum`)
  .superRefine((opts, ctx) => {
    const seen = new Set<string>();
    for (const o of opts) {
      const k = o.name.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: `Option en double : « ${o.name} »` });
      seen.add(k);
    }
  });

export const variantSchema = z.object({
  id: z.string().max(64).optional(),
  attributes: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40)),
  price: money.nullish().transform((v) => v ?? null),
  compareAtPrice: money.nullish().transform((v) => v ?? null),
  sku: optText(60),
  barcode: optText(60),
  stock: stockQty.default(0),
  /** Stock affiché au chargement (variante existante) : le serveur applique stock − stockBase. Absent = valeur absolue. */
  stockBase: stockQty.nullish().transform((v) => v ?? null),
  weightGrams: z.number().int().min(0).max(1_000_000).nullish().transform((v) => v ?? null),
  imageUrl: imageUrlSchema.nullish().transform((v) => v ?? null),
  available: z.boolean().default(true),
  /** « Continuer à vendre en cas de rupture » pour cette variante. */
  inventoryPolicy,
});

export const optionGroupSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Nom du groupe requis").max(60),
  required: z.boolean().default(false),
  minSelect: z.number().int().min(0).max(20).default(0),
  maxSelect: z.number().int().min(1).max(20).default(1),
  options: z
    .array(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(60), priceDelta: z.number().int().min(-1_000_000_000).max(1_000_000_000).default(0) }))
    .min(1, "Ajoutez au moins une option")
    .max(30),
});

export const detailSchema = z.object({
  title: z.string().trim().min(1, "Titre de l'onglet requis").max(60),
  body: z.string().trim().min(1, "Contenu de l'onglet requis").max(5000),
});

const isoDate = z
  .string()
  .trim()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Date invalide" });
      return z.NEVER;
    }
    return d;
  });

/** Charge utile complète du formulaire produit (validée telle quelle côté serveur). */
export const productPayloadSchema = z
  .object({
    productId: z.string().max(64).optional(),
    name: z.string().trim().min(2, "Titre trop court (2 caractères minimum)").max(120, "120 caractères maximum"),
    slug: z.string().trim().max(120).optional().default(""),
    description: z.string().max(MAX_DESCRIPTION, "Description trop longue").default(""),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
    isFeatured: z.boolean().default(false),
    // Organisation
    categoryId: z.string().max(64).nullish().transform((v) => v || null),
    collectionIds: z.array(z.string().max(64)).max(50).default([]),
    newCollection: optText(60),
    productType: optText(60),
    vendor: optText(60),
    tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS, `${MAX_TAGS} étiquettes maximum`).default([]),
    seoTitle: optText(70),
    seoDescription: optText(320),
    // Prix
    price: money,
    compareAtPrice: money.nullish().transform((v) => v ?? null),
    costPrice: money.nullish().transform((v) => v ?? null),
    promoPrice: money.nullish().transform((v) => v ?? null),
    promoStart: isoDate,
    promoEnd: isoDate,
    // Inventaire / expédition
    sku: optText(60),
    /** Code-barres d'un produit sans variante (les variantes portent le leur). */
    barcode: optText(60),
    trackStock: z.boolean().default(false),
    stock: stockQty.default(0),
    /** Stock affiché au chargement de la fiche : le serveur applique stock − stockBase. Absent = valeur absolue. */
    stockBase: stockQty.nullish().transform((v) => v ?? null),
    /** Produit sans variante : « continuer à vendre en cas de rupture » (avec variantes : réglage par variante). */
    inventoryPolicy,
    /** Seuil d'alerte « stock bas » propre au produit ; null = seuil par défaut de la boutique. */
    lowStockThreshold: z.number().int().min(0, "Seuil positif ou nul").max(100_000, "Seuil trop élevé").nullish().transform((v) => v ?? null),
    minQty: z.number().int().min(1).max(10_000).default(1),
    maxQty: z.number().int().min(1).max(10_000).nullish().transform((v) => v ?? null),
    weightGrams: z.number().int().min(0).max(1_000_000).nullish().transform((v) => v ?? null),
    // Contenu
    images: z.array(imageSchema).max(SERVER_MAX_IMAGES, `${SERVER_MAX_IMAGES} images maximum`).default([]),
    options: optionsSchema.default([]),
    variants: z.array(variantSchema).max(MAX_VARIANTS, `${MAX_VARIANTS} variantes maximum`).default([]),
    optionGroups: z.array(optionGroupSchema).max(10, "10 groupes de suppléments maximum").default([]),
    details: z.array(detailSchema).max(MAX_DETAILS, `${MAX_DETAILS} onglets maximum`).default([]),
    /**
     * Lot 1 : produit carte cadeau (variantes = valeurs faciales, pas de suivi de stock ni de suppléments).
     * Absent (import CSV, anciens clients) = inchangé.
     */
    isGiftCard: z.boolean().optional(),
    /** Validité des cartes émises, en jours (180 à 1 825) ; vide = 365. */
    giftCardValidityDays: z
      .number()
      .int()
      .min(MIN_GIFT_CARD_VALIDITY_DAYS, `${MIN_GIFT_CARD_VALIDITY_DAYS} jours minimum`)
      .max(MAX_GIFT_CARD_VALIDITY_DAYS, `${MAX_GIFT_CARD_VALIDITY_DAYS} jours maximum`)
      .nullish()
      .transform((v) => v ?? null),
    /**
     * Vague 2 : nature du produit. Absent (import CSV, anciens clients) = inchangé ; une carte cadeau
     * (`isGiftCard`) reste toujours de nature GIFT_CARD (cohérence imposée côté serveur).
     */
    kind: z.enum(PRODUCT_KINDS).optional(),
    /** DIGITAL : nombre de téléchargements autorisés par commande (vide = 5 ; 0 = illimité). */
    downloadLimit: z.number().int().min(0, "Nombre positif").max(MAX_DOWNLOAD_LIMIT, `${MAX_DOWNLOAD_LIMIT} maximum`).nullish().transform((v) => v ?? null),
    /** DIGITAL : validité du lien en jours (vide = 365 ; 0 = sans expiration). */
    downloadValidityDays: z.number().int().min(0, "Nombre positif").max(MAX_DOWNLOAD_VALIDITY_DAYS, `${MAX_DOWNLOAD_VALIDITY_DAYS} jours maximum`).nullish().transform((v) => v ?? null),
    /** SERVICE : durée de la prestation en minutes. */
    serviceDurationMinutes: z.number().int().min(0, "Durée positive").max(100_000, "Durée trop longue").nullish().transform((v) => v ?? null),
    /** SERVICE : lieu de la prestation (adresse, salle, « en visioconférence »…). */
    serviceLocation: optText(160),
    /** SERVICE : prestation à distance. */
    serviceRemote: z.boolean().optional(),
    /** SERVICE : note de réservation affichée sur la fiche (délais, pièces à apporter…). */
    serviceBookingNote: optText(500),
    /** DIGITAL et SERVICE : instructions envoyées à l'acheteur après le paiement. */
    postPurchaseInstructions: optText(1000),
  })
  .superRefine((d, ctx) => {
    if (d.promoPrice != null && d.promoPrice >= d.price) ctx.addIssue({ code: "custom", path: ["promoPrice"], message: "Le prix promo doit être inférieur au prix" });
    if (d.promoStart && d.promoEnd && d.promoEnd <= d.promoStart) ctx.addIssue({ code: "custom", path: ["promoEnd"], message: "La fin doit être après le début" });
    if (d.maxQty != null && d.maxQty < d.minQty) ctx.addIssue({ code: "custom", path: ["maxQty"], message: "Doit être supérieur ou égal au minimum" });
    if (negativeStockIssue(d.stock, d.stockBase)) ctx.addIssue({ code: "custom", path: ["stock"], message: "La quantité saisie ne peut pas être négative" });
    for (const v of d.variants) {
      if (negativeStockIssue(v.stock, v.stockBase)) ctx.addIssue({ code: "custom", path: ["variants"], message: "La quantité d'une variante ne peut pas être négative" });
    }
    for (const g of d.optionGroups) {
      if (g.minSelect > g.maxSelect) ctx.addIssue({ code: "custom", path: ["optionGroups"], message: `Supplément « ${g.name} » : le minimum dépasse le maximum` });
      if (g.maxSelect > g.options.length) ctx.addIssue({ code: "custom", path: ["optionGroups"], message: `Supplément « ${g.name} » : le maximum dépasse le nombre de choix` });
    }
    if (d.isGiftCard) {
      if (d.optionGroups.length > 0) ctx.addIssue({ code: "custom", path: ["optionGroups"], message: "Une carte cadeau n'a pas de suppléments : retirez-les." });
      if (d.promoPrice != null) ctx.addIssue({ code: "custom", path: ["promoPrice"], message: "Pas de prix promotionnel sur une carte cadeau : sa valeur est son prix." });
    }
    // Vague 2 : cohérence `kind` / `isGiftCard` (les deux champs décrivent la même réalité).
    if (d.kind === "GIFT_CARD" && d.isGiftCard === false) ctx.addIssue({ code: "custom", path: ["kind"], message: "Type incohérent : activez « carte cadeau » ou choisissez un autre type." });
    if (d.kind && d.kind !== "GIFT_CARD" && d.isGiftCard === true) ctx.addIssue({ code: "custom", path: ["kind"], message: "Type incohérent : une carte cadeau garde le type « Carte cadeau »." });
    const issue = variantsConsistencyIssue(d.options as ProductOption[], d.variants);
    if (issue) ctx.addIssue({ code: "custom", path: ["variants"], message: issue });
  });

/** Vérifie que chaque variante correspond à une combinaison valide et unique des options. */
export function variantsConsistencyIssue(options: ProductOption[], variants: { attributes: Record<string, string> }[]): string | null {
  if (options.length === 0) return variants.length > 0 ? "Des variantes sont fournies sans option" : null;
  if (variants.length === 0) return "Les options n'ont généré aucune variante";
  const seen = new Set<string>();
  for (const v of variants) {
    const keys = Object.keys(v.attributes);
    if (keys.length !== options.length) return "Chaque variante doit avoir une valeur pour chaque option";
    for (const o of options) {
      const val = v.attributes[o.name];
      if (val == null || !o.values.some((x) => x.value === val)) return `Valeur « ${val ?? ""} » inconnue pour l'option ${o.name}`;
    }
    const k = attrKey(v.attributes, options);
    if (seen.has(k)) return "Deux variantes ont la même combinaison";
    seen.add(k);
  }
  return null;
}

export type ImageInput = z.infer<typeof imageSchema>;
export type VariantInput = z.input<typeof variantSchema>;
export type OptionGroupInput = z.infer<typeof optionGroupSchema>;
export type DetailInput = z.infer<typeof detailSchema>;
export type ProductPayload = z.input<typeof productPayloadSchema>;
export type ProductData = z.output<typeof productPayloadSchema>;

/**
 * Nature retenue à l'enregistrement : `kind` demandé, sinon l'existant, sinon déduit de `isGiftCard`.
 * Pur et partagé par le formulaire, l'import CSV et le MCP.
 */
export function resolveProductKind(d: { kind?: ProductKindValue; isGiftCard?: boolean }, existing?: { kind?: ProductKindValue | null; isGiftCard?: boolean | null } | null): ProductKindValue {
  if (d.isGiftCard === true) return "GIFT_CARD";
  if (d.kind) return d.kind;
  if (d.isGiftCard === false && existing?.kind === "GIFT_CARD") return "PHYSICAL";
  if (existing?.isGiftCard) return "GIFT_CARD";
  return (existing?.kind as ProductKindValue | undefined) ?? "PHYSICAL";
}

/** Normalise une étiquette (espaces, longueur). */
export function normalizeTag(t: string): string {
  return t.replace(/\s+/g, " ").trim().slice(0, 40);
}

/**
 * Contrôle des valeurs faciales d'une carte cadeau (prix du produit, ou de chaque variante) contre les bornes
 * de la devise (`giftCardLimits`). Pur ; renvoie un message ou null.
 */
export function giftCardFaceValueIssue(d: { price: number; variants: { price: number | null; available?: boolean }[] }, currency: string): string | null {
  const { minValue, maxValue } = giftCardLimits(currency);
  const values = d.variants.length > 0 ? d.variants.map((v) => v.price ?? d.price) : [d.price];
  if (values.some((v) => v < minValue || v > maxValue)) return `Chaque valeur d'une carte cadeau doit être comprise entre ${minValue} et ${maxValue} ${currency}.`;
  return null;
}
