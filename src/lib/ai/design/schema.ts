/**
 * Lot 4 §9 : contrat de sortie de la génération de boutique (module PUR, testé).
 *
 * L'IA ne produit JAMAIS un document de thème : elle produit un BRIEF (3 directions artistiques),
 * contraint par `STORE_DESIGN_BRIEF_SCHEMA` (JSON Schema envoyé au modèle) et revérifié ici par zod.
 * Le document est ensuite construit par le compilateur déterministe `compileBrief` (compile.ts).
 */
import { z } from "zod";
import { FONT_IDS } from "@/lib/storefront/theme-doc";
import type { FontId, SectionType } from "@/lib/theme-engine/types";

/** Liste BLANCHE des sections que l'IA peut placer sur l'accueil (§9, garde-fou 4). */
export const ALLOWED_HOME_SECTIONS = [
  "hero-banner",
  "image-with-text",
  "rich-text",
  "featured-collection",
  "collection-list",
  "featured-product",
  "multicolumn",
  "image-gallery",
  "faq",
  "newsletter",
  "whatsapp-cta",
  "contact",
  "opening-hours",
  "trust-badges",
  "logo-list",
  "testimonials",
  "reviews",
] as const satisfies readonly SectionType[];

export type AllowedHomeSection = (typeof ALLOWED_HOME_SECTIONS)[number];

/** Sections interdites tant qu'aucun avis réel n'existe (§9 : jamais de faux témoignages ni de faux avis). */
export const REVIEW_SECTIONS: readonly AllowedHomeSection[] = ["testimonials", "reviews"];

export const SCHEMES = ["default", "surface", "inverse", "brand"] as const;
export const DENSITIES = ["airy", "balanced", "compact"] as const;
export const BUTTON_STYLES = ["solid", "outline", "soft"] as const;
export const IMAGE_RATIOS = ["square", "portrait", "landscape", "natural"] as const;
export const GALLERY_STYLES = ["stacked", "carousel", "thumbnails-left", "thumbnails-bottom", "grid-2"] as const;
export const VARIANT_PICKERS = ["buttons", "dropdown", "swatches"] as const;
/** Types de blocs de la fiche produit (`main-product`) que le brief peut ordonner. Aucun bloc n'est créé : seul l'ORDRE change. */
export const PRODUCT_BLOCKS = ["vendor", "title", "price", "rating", "variant_picker", "options", "quantity", "buy_buttons", "stock", "description", "delivery_info", "trust", "share", "sku"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const fontId = z.enum(FONT_IDS as [FontId, ...FontId[]]);

export const copySchema = z
  .object({
    heading: z.string().max(120).optional(),
    subheading: z.string().max(160).optional(),
    text: z.string().max(600).optional(),
    button_label: z.string().max(40).optional(),
  })
  .partial();

export const homeSectionSchema = z.object({
  type: z.enum(ALLOWED_HOME_SECTIONS),
  preset: z.number().int().min(0).max(8).default(0),
  scheme: z.enum(SCHEMES).default("default"),
  copy: copySchema.default({}),
  image: z.object({ photoIndex: z.number().int().min(0).max(31) }).nullable().default(null),
  collectionIndex: z.number().int().min(0).max(199).nullable().default(null),
  productIndexes: z.array(z.number().int().min(0).max(199)).max(12).default([]),
});

export const directionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,12}$/),
  name: z.string().trim().min(1).max(40),
  rationale: z.string().trim().max(240).default(""),
  palette: z.object({ background: hex, surface: hex, text: hex, primary: hex, accent: hex }),
  fonts: z.object({ heading: fontId, body: fontId }),
  headingWeight: z.number().int().min(400).max(800).default(600),
  buttons: z.object({ radius: z.number().int().min(0).max(24).default(12), style: z.enum(BUTTON_STYLES).default("solid") }),
  cards: z.object({ radius: z.number().int().min(0).max(24).default(12), imageRatio: z.enum(IMAGE_RATIOS).default("portrait") }),
  density: z.enum(DENSITIES).default("balanced"),
  announcement: z.string().max(120).nullable().default(null),
  home: z.array(homeSectionSchema).min(1).max(12),
  product: z
    .object({
      gallery: z.enum(GALLERY_STYLES).default("thumbnails-left"),
      variantPicker: z.enum(VARIANT_PICKERS).default("buttons"),
      stickyAddToCart: z.boolean().default(true),
      blocks: z.array(z.enum(PRODUCT_BLOCKS)).max(12).default([]),
    })
    .default({ gallery: "thumbnails-left", variantPicker: "buttons", stickyAddToCart: true, blocks: [] }),
  faq: z.array(z.object({ q: z.string().trim().max(120), a: z.string().trim().max(400) })).max(6).default([]),
});

export const briefSchema = z.object({ directions: z.array(directionSchema).min(1).max(3) });

export type StoreDesignDirection = z.infer<typeof directionSchema>;
export type StoreDesignBrief = z.infer<typeof briefSchema>;
export type BriefHomeSection = z.infer<typeof homeSectionSchema>;

/** JSON Schema envoyé au modèle (sortie structurée). Volontairement strict : `additionalProperties: false`. */
export const STORE_DESIGN_BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["directions"],
  properties: {
    directions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "rationale", "palette", "fonts", "headingWeight", "buttons", "cards", "density", "announcement", "home", "product", "faq"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]{1,12}$" },
          name: { type: "string", maxLength: 40 },
          rationale: { type: "string", maxLength: 240 },
          palette: {
            type: "object",
            additionalProperties: false,
            required: ["background", "surface", "text", "primary", "accent"],
            properties: Object.fromEntries(["background", "surface", "text", "primary", "accent"].map((k) => [k, { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }])),
          },
          fonts: {
            type: "object",
            additionalProperties: false,
            required: ["heading", "body"],
            properties: { heading: { enum: [...FONT_IDS] }, body: { enum: [...FONT_IDS] } },
          },
          headingWeight: { type: "integer", enum: [500, 600, 700, 800] },
          buttons: {
            type: "object",
            additionalProperties: false,
            required: ["radius", "style"],
            properties: { radius: { type: "integer", minimum: 0, maximum: 24 }, style: { enum: [...BUTTON_STYLES] } },
          },
          cards: {
            type: "object",
            additionalProperties: false,
            required: ["radius", "imageRatio"],
            properties: { radius: { type: "integer", minimum: 0, maximum: 24 }, imageRatio: { enum: [...IMAGE_RATIOS] } },
          },
          density: { enum: [...DENSITIES] },
          announcement: { type: ["string", "null"], maxLength: 120 },
          home: {
            type: "array",
            minItems: 4,
            maxItems: 9,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "preset", "scheme", "copy", "image", "collectionIndex", "productIndexes"],
              properties: {
                type: { enum: [...ALLOWED_HOME_SECTIONS] },
                preset: { type: "integer", minimum: 0, maximum: 8 },
                scheme: { enum: [...SCHEMES] },
                copy: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    heading: { type: "string", maxLength: 120 },
                    subheading: { type: "string", maxLength: 160 },
                    text: { type: "string", maxLength: 600 },
                    button_label: { type: "string", maxLength: 40 },
                  },
                },
                image: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  required: ["photoIndex"],
                  properties: { photoIndex: { type: "integer", minimum: 0, maximum: 31 } },
                },
                collectionIndex: { type: ["integer", "null"], minimum: 0, maximum: 199 },
                productIndexes: { type: "array", maxItems: 12, items: { type: "integer", minimum: 0, maximum: 199 } },
              },
            },
          },
          product: {
            type: "object",
            additionalProperties: false,
            required: ["gallery", "variantPicker", "stickyAddToCart", "blocks"],
            properties: {
              gallery: { enum: [...GALLERY_STYLES] },
              variantPicker: { enum: [...VARIANT_PICKERS] },
              stickyAddToCart: { type: "boolean" },
              blocks: { type: "array", maxItems: 12, items: { enum: [...PRODUCT_BLOCKS] } },
            },
          },
          faq: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["q", "a"],
              properties: { q: { type: "string", maxLength: 120 }, a: { type: "string", maxLength: 400 } },
            },
          },
        },
      },
    },
  },
} as const;

/** Lecture de la réponse du modèle : JSON extrait, puis validé par zod. */
export function parseBrief(raw: unknown): { ok: true; brief: StoreDesignBrief } | { ok: false; error: string } {
  const p = briefSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Brief invalide." };
  return { ok: true, brief: p.data };
}
