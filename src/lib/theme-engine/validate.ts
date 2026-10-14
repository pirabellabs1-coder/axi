/**
 * Validation du document de thème (zod 4), dérivée des schémas de sections (`SECTION_SCHEMAS`).
 * Utilisée côté serveur avant tout enregistrement, et côté client pour afficher les erreurs dans l'éditeur.
 *
 * Règles : sections/blocs/réglages inconnus rejetés ; chaque valeur validée selon son champ (longueurs, bornes,
 * `#RRGGBB`, URLs https ou internes, images https / médias téléversés / data-URL raster héritées ≤ 300 Ko) ; `maxBlocks` et `limit` respectés ;
 * sections obligatoires présentes et uniques ; références (collections, produits, menus) vérifiées si fournies.
 */
import { z } from "zod";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import { SECTION_SCHEMAS, sectionsForTemplate } from "./schemas";
import { completeLateTemplates, defaultsFor, FONT_IDS, MAX_SECTIONS_PER_TEMPLATE, TEMPLATE_IDS } from "./editor-defaults";
import type { SectionType, SettingField, Template, TemplateId, ThemeDocument } from "./types";
import {
  ALTERNATE_SUFFIX_RE,
  ALTERNATE_TEMPLATE_TYPES,
  AUDIENCE_CUSTOMER_SEGMENTS,
  AUDIENCE_DEVICES,
  AUDIENCE_SOURCES,
  BLOG_CATEGORY_HANDLE_RE,
  DEFAULT_MOTION,
  DYNAMIC_SOURCE_FIELD_TYPES,
  DYNAMIC_SOURCE_RE,
  MAX_ALTERNATE_TEMPLATES,
  MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE,
  MAX_VISIBILITY_RULES,
  MOTION_PRESETS,
  SECTION_ANIMATIONS,
  THEME_DOC_VERSION,
} from "./types";

/* ───────────── Primitives ───────────── */

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const MAX_IMAGE_DATA_URL = 410_000; // ≈ 300 Ko binaires encodés en base64
export const MAX_DOCUMENT_BYTES = 3_500_000;

/** Chemin interne de la boutique : `/catalogue`, `/collections/robes?tri=prix`, `/p/robe-wax`. */
export function isInternalPath(v: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9\-._~/%?=&#+]*$/.test(v) && !v.includes("\\") && v.length <= 300;
}

export function isHttpsUrl(v: string): boolean {
  if (v.length > 2000) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Lien autorisé dans un réglage : chemin interne ou https. */
export function isSafeLink(v: string): boolean {
  return isInternalPath(v) || isHttpsUrl(v);
}

const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Forme d'une image : https, chemin interne (dont `/media/…`), média du bucket (STORAGE_PUBLIC_URL), ou data-URL
 * raster héritée (jamais SVG) ≤ 300 Ko. Validation de FORME, partagée client / serveur : à l'écriture, l'action
 * serveur (src/lib/theme/actions.ts → checkImageWrite) refuse en plus toute data-URL absente du thème déjà en base
 * et tout média d'une autre boutique.
 */
export function isSafeImageUrl(v: string): boolean {
  if (v.startsWith("data:")) return v.length <= MAX_IMAGE_DATA_URL && DATA_IMAGE_RE.test(v);
  return isHttpsUrl(v) || isInternalPath(v) || isStoredMediaUrl(v);
}

/** Vidéo : YouTube, Vimeo ou fichier MP4/WebM en https. */
export function isSafeVideoUrl(v: string): boolean {
  if (!isHttpsUrl(v)) return false;
  const u = new URL(v);
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (["youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com", "player.vimeo.com"].includes(host)) return true;
  return /\.(mp4|webm)$/i.test(u.pathname);
}

const HTML_TAG_RE = /<\/?[a-z!][^>]*>/i;
const MD_LINK_RE = /\]\(([^)\s]*)[^)]*\)/g;

/** Markdown limité : pas de HTML brut, liens https ou internes uniquement. */
export function isSafeMarkdown(v: string): boolean {
  if (HTML_TAG_RE.test(v)) return false;
  for (const m of v.matchAll(MD_LINK_RE)) if (!isSafeLink(m[1])) return false;
  return true;
}

export const SCHEME_ID_RE = /^[a-z0-9-]{1,24}$/;
/** Valeurs fixes du réglage « Couleurs de la section » (en plus des schémas globaux). */
export const BUILTIN_SCHEMES = ["default", "surface", "inverse", "brand"];

const hex = z.string().regex(HEX_RE, "Couleur attendue au format #RRGGBB.");
const idRef = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identifiant invalide.");
const menuHandle = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Menu invalide.");
const imageValue = z
  .object({
    url: z.string().refine(isSafeImageUrl, "Image : adresse https ou fichier importé (PNG, JPEG, WebP) de 300 Ko maximum."),
    alt: z.string().max(200, "Texte alternatif : 200 caractères maximum.").optional(),
  })
  .strict();
const linkValue = z.string().max(2000).refine((v) => v === "" || isSafeLink(v), "Lien : chemin de la boutique (/catalogue) ou adresse https.");

/* ───────────── Champ → zod ───────────── */

export function fieldSchema(field: SettingField): z.ZodType | null {
  switch (field.type) {
    case "header":
    case "paragraph":
      return null;
    case "text":
      return z.string().max(field.maxLength ?? 300, `${field.label} : ${field.maxLength ?? 300} caractères maximum.`);
    case "textarea":
      return z.string().max(field.maxLength ?? 2000, `${field.label} : ${field.maxLength ?? 2000} caractères maximum.`);
    case "richtext":
      return z.string().max(5000, `${field.label} : 5 000 caractères maximum.`).refine(isSafeMarkdown, `${field.label} : HTML interdit, liens https ou internes uniquement.`);
    case "number": {
      let s = z.number({ error: `${field.label} : nombre attendu.` }).finite();
      if (field.min != null) s = s.min(field.min, `${field.label} : minimum ${field.min}.`);
      if (field.max != null) s = s.max(field.max, `${field.label} : maximum ${field.max}.`);
      return s;
    }
    case "range":
      return z.number({ error: `${field.label} : nombre attendu.` }).finite().min(field.min, `${field.label} : minimum ${field.min}.`).max(field.max, `${field.label} : maximum ${field.max}.`);
    case "checkbox":
      return z.boolean({ error: `${field.label} : oui ou non attendu.` });
    case "select":
    case "segmented": {
      const values = field.options.map((o) => o.value);
      // Les schémas de couleurs globaux (`colors.schemes`) sont aussi utilisables par section (vérifiés au niveau du document).
      if (field.id === "scheme") return z.string().refine((v) => values.includes(v) || SCHEME_ID_RE.test(v), `${field.label} : choix invalide.`);
      return z.string().refine((v) => values.includes(v), `${field.label} : choix invalide.`);
    }
    case "color":
      return hex.nullable();
    case "image":
      return imageValue.nullable();
    case "video":
      // `null` = aucune vidéo (forme canonique produite par le sanitiseur pour une valeur vide), comme "".
      return z.string().refine((v) => v === "" || isSafeVideoUrl(v), "Vidéo : lien YouTube, Vimeo ou fichier MP4 en https.").nullable();
    case "url":
      // `null` = aucun lien (bloc sans lien) : forme canonique du sanitiseur pour un `url` vide, tolérée au même titre que "".
      return linkValue.nullable();
    case "collection":
    case "product":
      return idRef.nullable();
    case "product_list":
      return z
        .array(idRef)
        .max(field.limit ?? 24, `${field.label} : ${field.limit ?? 24} produits maximum.`)
        .refine((a) => new Set(a).size === a.length, `${field.label} : produit en double.`);
    case "menu":
      return z.union([z.literal(""), menuHandle]);
    case "blog_category":
      return z.string().refine((v) => v === "" || BLOG_CATEGORY_HANDLE_RE.test(v), `${field.label} : catégorie du blog invalide.`);
    case "font":
      return z.enum(FONT_IDS, { error: `${field.label} : police inconnue.` });
  }
}

/** Lot 4 §5 : `{ "$source": "product.title" }` (grammaire fermée), accepté par les champs de DYNAMIC_SOURCE_FIELD_TYPES. */
export const dynamicSourceSchema = z
  .object({ $source: z.string().max(120).regex(DYNAMIC_SOURCE_RE, "Source dynamique invalide.") })
  .strict();
const DYNAMIC_TYPES = new Set<string>(DYNAMIC_SOURCE_FIELD_TYPES);

/** Objet strict des réglages : clés inconnues rejetées, clés manquantes complétées par les valeurs par défaut. */
export function settingsSchema(fields: SettingField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    if (!("id" in f)) continue;
    const s = fieldSchema(f);
    if (s) shape[f.id] = (DYNAMIC_TYPES.has(f.type) ? z.union([s, dynamicSourceSchema]) : s).optional();
  }
  return z
    .object(shape)
    .strict()
    .transform((v) => ({ ...defaultsFor(fields), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) }));
}

/* ───────────── Sections ───────────── */

const instanceId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identifiant invalide.");

/* ───────────── Lot 4 : audiences et animations de section ───────────── */

const HHMM = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Heure attendue au format HH:MM.");
const uniqueList = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .min(1, "Au moins une valeur.")
    .max(max, `${max} valeurs maximum.`)
    .refine((a) => new Set(a as unknown[]).size === a.length, "Valeur en double.");

export const audienceRuleSchema = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("city"), values: uniqueList(z.string().trim().min(1).max(80), 50) }).strict(),
    z.object({ type: z.literal("customer"), values: uniqueList(z.enum(AUDIENCE_CUSTOMER_SEGMENTS), AUDIENCE_CUSTOMER_SEGMENTS.length) }).strict(),
    z.object({ type: z.literal("source"), values: uniqueList(z.enum(AUDIENCE_SOURCES), AUDIENCE_SOURCES.length) }).strict(),
    z.object({ type: z.literal("locale"), values: uniqueList(z.string().regex(/^[a-z]{2,3}$/, "Langue invalide."), 12) }).strict(),
    z.object({ type: z.literal("schedule"), days: uniqueList(z.number().int().min(0).max(6), 7), from: HHMM, to: HHMM }).strict(),
    z.object({ type: z.literal("device"), values: uniqueList(z.enum(AUDIENCE_DEVICES), AUDIENCE_DEVICES.length) }).strict(),
  ],
  { error: "Règle d'audience inconnue." },
);

export const sectionVisibilitySchema = z
  .object({
    match: z.enum(["all", "any"]),
    mode: z.enum(["show", "hide"]),
    rules: z.array(audienceRuleSchema).max(MAX_VISIBILITY_RULES, `${MAX_VISIBILITY_RULES} règles maximum par section.`),
  })
  .strict();

function sectionSchema(type: SectionType) {
  const schema = SECTION_SCHEMAS[type];
  const blockTypes = schema.blocks ?? [];
  const block = blockTypes.length
    ? z.discriminatedUnion(
        "type",
        blockTypes.map((b) =>
          z.object({ id: instanceId, type: z.literal(b.type), settings: settingsSchema(b.settings), disabled: z.boolean().optional() }).strict(),
        ) as unknown as [z.ZodObject, ...z.ZodObject[]],
        { error: "Type de bloc inconnu." },
      )
    : z.never({ error: "Cette section n'accepte pas de blocs." });
  return z
    .object({
      id: instanceId,
      type: z.literal(type),
      settings: settingsSchema(schema.settings),
      blocks: z.array(block),
      disabled: z.boolean().optional(),
      // Lot 4 (facultatifs, absents des documents antérieurs)
      visibility: sectionVisibilitySchema.optional(),
      animation: z.enum(SECTION_ANIMATIONS, { error: "Animation inconnue." }).optional(),
    })
    .strict()
    .superRefine((s, ctx) => {
      if (schema.maxBlocks != null && s.blocks.length > schema.maxBlocks) {
        ctx.addIssue({ code: "custom", path: ["blocks"], message: `« ${schema.name} » : ${schema.maxBlocks} blocs maximum.` });
      }
      for (const bs of blockTypes) {
        if (bs.limit != null && s.blocks.filter((b) => (b as { type: string }).type === bs.type).length > bs.limit) {
          ctx.addIssue({ code: "custom", path: ["blocks"], message: `« ${bs.name} » : ${bs.limit} maximum dans « ${schema.name} ».` });
        }
      }
      if (schema.required && s.disabled) ctx.addIssue({ code: "custom", path: ["disabled"], message: `« ${schema.name} » ne peut pas être masquée.` });
    });
}

const SECTION_TYPES = Object.keys(SECTION_SCHEMAS) as SectionType[];
const anySection = z.discriminatedUnion(
  "type",
  SECTION_TYPES.map((t) => sectionSchema(t)) as unknown as [z.ZodObject, ...z.ZodObject[]],
  { error: "Type de section inconnu." },
);

function templateSchema(template: TemplateId) {
  const allowed = new Set(sectionsForTemplate(template).map((s) => s.type));
  const required = Object.values(SECTION_SCHEMAS).filter((s) => s.required && s.templates?.includes(template));
  return z
    .object({
      order: z.array(instanceId).max(MAX_SECTIONS_PER_TEMPLATE, `${MAX_SECTIONS_PER_TEMPLATE} sections maximum par page.`),
      sections: z.record(z.string(), anySection),
    })
    .strict()
    .superRefine((t, ctx) => {
      const keys = Object.keys(t.sections);
      if (new Set(t.order).size !== t.order.length) ctx.addIssue({ code: "custom", path: ["order"], message: "Section en double dans l'ordre." });
      if (keys.length !== t.order.length || !keys.every((k) => t.order.includes(k))) {
        ctx.addIssue({ code: "custom", path: ["order"], message: "Ordre des sections incohérent." });
      }
      const ids = new Set<string>();
      for (const [key, raw] of Object.entries(t.sections)) {
        const s = raw as { id: string; type: SectionType; blocks: { id: string }[] };
        if (s.id !== key) ctx.addIssue({ code: "custom", path: ["sections", key, "id"], message: "Identifiant de section incohérent." });
        if (!allowed.has(s.type)) ctx.addIssue({ code: "custom", path: ["sections", key, "type"], message: `« ${SECTION_SCHEMAS[s.type].name} » n'est pas disponible sur ce modèle de page.` });
        for (const id of [s.id, ...s.blocks.map((b) => b.id)]) {
          if (ids.has(id)) ctx.addIssue({ code: "custom", path: ["sections", key], message: "Identifiant en double." });
          ids.add(id);
        }
      }
      for (const r of required) {
        const n = Object.values(t.sections).filter((s) => (s as { type: string }).type === r.type).length;
        if (n === 0) ctx.addIssue({ code: "custom", path: ["order"], message: `La section « ${r.name} » est obligatoire sur ce modèle.` });
        if (n > 1) ctx.addIssue({ code: "custom", path: ["order"], message: `La section « ${r.name} » ne peut apparaître qu'une fois.` });
      }
      const personalized = Object.values(t.sections).filter((s) => (s as { visibility?: unknown }).visibility !== undefined).length;
      if (personalized > MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE) {
        ctx.addIssue({ code: "custom", path: ["order"], message: `${MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE} sections personnalisées par audience maximum par page.` });
      }
    });
}

/* ───────────── Réglages globaux ───────────── */

const range = (min: number, max: number, label: string) =>
  z.number({ error: `${label} : nombre attendu.` }).finite().min(min, `${label} : minimum ${min}.`).max(max, `${label} : maximum ${max}.`);
const socialUrl = z.string().max(300).refine((v) => v === "" || isHttpsUrl(v), "Réseau social : adresse https attendue.").optional();

export const globalSettingsSchema = z
  .object({
    colors: z
      .object({
        background: hex,
        surface: hex,
        text: hex,
        muted: hex,
        primary: hex,
        primaryText: hex,
        accent: hex,
        border: hex,
        schemes: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z0-9-]{1,24}$/, "Identifiant de schéma invalide."),
                name: z.string().trim().min(1, "Nom du schéma requis.").max(40),
                background: hex,
                text: hex,
                primary: hex,
                primaryText: hex,
                // Rôles avancés optionnels (absents des documents antérieurs) : `null` = dérivation au rendu, comme `url`/`video`.
                surface: hex.nullable().optional(),
                border: hex.nullable().optional(),
                link: hex.nullable().optional(),
                secondaryButton: hex.nullable().optional(),
                secondaryButtonText: hex.nullable().optional(),
              })
              .strict(),
          )
          .max(8, "8 schémas de couleurs maximum.")
          .refine((a) => new Set(a.map((s) => s.id)).size === a.length, "Schémas de couleurs en double."),
      })
      .strict(),
    typography: z
      .object({
        heading: z.enum(FONT_IDS),
        body: z.enum(FONT_IDS),
        headingWeight: z.union([z.literal(500), z.literal(600), z.literal(700), z.literal(800)]),
        scale: range(0.85, 1.3, "Taille des titres"),
        uppercaseButtons: z.boolean(),
        // Réglages fins (complétés si absents des documents antérieurs).
        headingTracking: range(-0.05, 0.1, "Interlettrage des titres").default(0),
        headingTransform: z.enum(["none", "uppercase", "small-caps"]).default("none"),
        bodyScale: range(0.9, 1.2, "Taille du texte").optional(),
        bodyLeading: z.enum(["tight", "normal", "relaxed"]).default("normal"),
        headingLineHeight: z.enum(["tight", "normal"]).default("tight"),
      })
      .strict()
      // `bodyScale` absent : le corps suivait l'échelle générale → on reprend `scale` (borné 0.9–1.2) pour un rendu inchangé.
      .transform((tp) => ({ ...tp, bodyScale: tp.bodyScale ?? Math.min(1.2, Math.max(0.9, tp.scale)) })),
    buttons: z
      .object({
        radius: range(0, 999, "Arrondi des boutons"),
        style: z.enum(["solid", "outline", "soft"]),
        shadow: z.boolean(),
        // Complétés si absents (documents antérieurs)
        borderWidth: range(0, 3, "Épaisseur du contour des boutons").default(1),
        size: z.enum(["compact", "normal", "large"]).default("normal"),
      })
      .strict(),
    cards: z
      .object({
        radius: range(0, 40, "Arrondi des cartes"),
        imageRatio: z.enum(["square", "portrait", "landscape", "natural"]),
        showVendor: z.boolean(),
        showSecondImage: z.boolean(),
        quickAdd: z.boolean(),
        border: z.boolean(),
        // Lot 1 : complété si absent (documents antérieurs)
        showFavorite: z.boolean().default(false),
        // Personnalisation des cartes : complétés si absents (documents antérieurs = rendu actuel)
        saleBadge: z.enum(["percent", "text", "hidden"]).default("percent"),
        style: z.enum(["standard", "overlay"]).default("standard"),
        showNewBadge: z.boolean().default(false),
      })
      .strict(),
    layout: z.object({ pageWidth: range(1100, 1600, "Largeur de page"), sectionSpacing: range(0, 160, "Espacement des sections"), gutter: range(8, 48, "Marges latérales") }).strict(),
    header: z
      .object({
        logo: imageValue.nullable(),
        logoWidth: range(40, 300, "Largeur du logo"),
        layout: z.enum(["logo-left", "logo-center", "minimal"]),
        sticky: z.boolean(),
        menu: z.union([z.literal(""), menuHandle]),
        showSearch: z.boolean(),
        // Lot 1 : complété si absent (documents antérieurs)
        showAccount: z.boolean().default(true),
        // Vague 2 : complété si absent (documents antérieurs)
        showCurrencyPicker: z.boolean().default(true),
        // En-tête transparent sur la bannière : complété si absent (documents antérieurs → false, rendu inchangé)
        transparentOverHero: z.boolean().default(false),
        announcement: z
          .object({
            enabled: z.boolean(),
            text: z.string().max(160, "Annonce : 160 caractères maximum."),
            link: linkValue.optional(),
            scheme: z.string().max(24).optional(),
          })
          .strict(),
      })
      .strict(),
    footer: z
      .object({
        menus: z.array(menuHandle).max(4, "4 menus maximum dans le pied de page."),
        showSocial: z.boolean(),
        social: z.object({ instagram: socialUrl, facebook: socialUrl, tiktok: socialUrl, youtube: socialUrl, whatsapp: socialUrl }).strict(),
        text: z.string().max(500, "Texte du pied de page : 500 caractères maximum."),
        showPaymentIcons: z.boolean(),
        newsletter: z.boolean(),
      })
      .strict(),
    product: z
      .object({
        gallery: z.enum(["stacked", "carousel", "thumbnails-left", "thumbnails-bottom", "grid-2"]),
        variantPicker: z.enum(["buttons", "dropdown", "swatches"]),
        stickyAddToCart: z.boolean(),
        showSku: z.boolean(),
        showStock: z.boolean(),
        showShareButtons: z.boolean(),
      })
      .strict(),
    cart: z.object({ type: z.enum(["drawer", "page"]), showNote: z.boolean(), freeShippingBar: z.boolean() }).strict(),
    social: z
      .object({
        favicon: z.object({ url: z.string().refine(isSafeImageUrl, "Favicon : image https ou fichier importé.") }).strict().nullable(),
        shareImage: z.object({ url: z.string().refine(isSafeImageUrl, "Image de partage : image https ou fichier importé.") }).strict().nullable(),
      })
      .strict(),
    // Lot 4 §2 : facultatif ; clés manquantes complétées par DEFAULT_MOTION
    motion: z
      .object({
        preset: z.enum(MOTION_PRESETS).default(DEFAULT_MOTION.preset),
        reveal: z.boolean().default(DEFAULT_MOTION.reveal),
        parallax: z.boolean().default(DEFAULT_MOTION.parallax),
        hoverZoom: z.boolean().default(DEFAULT_MOTION.hoverZoom),
      })
      .strict()
      .optional(),
  })
  .strict();

/* ───────────── Document ───────────── */

const templatesShape = Object.fromEntries(TEMPLATE_IDS.map((t) => [t, templateSchema(t)])) as Record<TemplateId, ReturnType<typeof templateSchema>>;

const alternateSuffix = z.string().regex(ALTERNATE_SUFFIX_RE, "Nom de modèle : minuscules, chiffres et tirets (24 caractères maximum).");
/** Lot 4 §6 : un modèle alternatif suit les règles du modèle de son type (sections permises, section obligatoire). */
const alternatesShape = Object.fromEntries(ALTERNATE_TEMPLATE_TYPES.map((t) => [t, z.record(alternateSuffix, templateSchema(t)).optional()]));

/** Modèles d'un document avec leur chemin : `templates.{tid}` puis `alternates.{type}.{suffixe}`. */
function documentTemplates(doc: { templates: Record<string, unknown>; alternates?: Record<string, Record<string, unknown> | undefined> }): { path: string[]; template: Template }[] {
  const out: { path: string[]; template: Template }[] = Object.entries(doc.templates ?? {}).map(([tid, t]) => ({ path: ["templates", tid], template: t as Template }));
  for (const [type, bySuffix] of Object.entries(doc.alternates ?? {})) {
    for (const [suffix, t] of Object.entries(bySuffix ?? {})) out.push({ path: ["alternates", type, suffix], template: t as Template });
  }
  return out;
}

export const themeDocumentSchema = z
  .object({
    version: z.literal(THEME_DOC_VERSION, { error: "Version du document non prise en charge." }),
    preset: z.string().regex(/^[a-z0-9-]{1,40}$/, "Modèle de départ invalide."),
    settings: globalSettingsSchema,
    templates: z.object(templatesShape).strict(),
    alternates: z.object(alternatesShape).strict().optional(),
    updatedAt: z.string().max(40).optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const known = new Set([...BUILTIN_SCHEMES, ...doc.settings.colors.schemes.map((s) => s.id)]);
    for (const { path, template } of documentTemplates(doc as Parameters<typeof documentTemplates>[0])) {
      for (const [sid, s] of Object.entries(template.sections)) {
        const v = (s as { settings: Record<string, unknown> }).settings.scheme;
        if (typeof v === "string" && !known.has(v)) {
          ctx.addIssue({ code: "custom", path: [...path, "sections", sid, "settings", "scheme"], message: "Couleurs de la section : schéma de couleurs introuvable." });
        }
      }
    }
    const alternates = Object.values((doc.alternates ?? {}) as Record<string, Record<string, unknown> | undefined>).reduce((n, m) => n + Object.keys(m ?? {}).length, 0);
    if (alternates > MAX_ALTERNATE_TEMPLATES) ctx.addIssue({ code: "custom", path: ["alternates"], message: `${MAX_ALTERNATE_TEMPLATES} modèles alternatifs maximum.` });
  });

export type ValidationIssue = { path: (string | number)[]; message: string };
export type ThemeRefs = { collectionIds: Set<string>; productIds: Set<string>; menuHandles?: Set<string> };
export type ValidationResult = { ok: true; doc: ThemeDocument } | { ok: false; errors: ValidationIssue[] };

/** Références à vérifier côté serveur (appartenance à la boutique). */
export function collectReferences(doc: ThemeDocument): { collectionIds: string[]; productIds: string[]; menuHandles: string[] } {
  const collections = new Set<string>();
  const products = new Set<string>();
  const menus = new Set<string>();
  if (doc.settings?.header?.menu) menus.add(doc.settings.header.menu);
  for (const m of doc.settings?.footer?.menus ?? []) menus.add(m);
  const visit = (fields: SettingField[], settings: Record<string, unknown>) => {
    for (const f of fields) {
      if (!("id" in f)) continue;
      const v = settings[f.id];
      if (f.type === "collection" && typeof v === "string" && v) collections.add(v);
      if (f.type === "product" && typeof v === "string" && v) products.add(v);
      if (f.type === "product_list" && Array.isArray(v)) v.forEach((x) => typeof x === "string" && products.add(x));
      if (f.type === "menu" && typeof v === "string" && v) menus.add(v);
    }
  };
  for (const { template: t } of documentTemplates(doc as unknown as Parameters<typeof documentTemplates>[0])) {
    for (const s of Object.values(t.sections ?? {})) {
      const schema = SECTION_SCHEMAS[s.type];
      if (!schema) continue;
      visit(schema.settings, s.settings ?? {});
      for (const b of s.blocks ?? []) {
        const bs = schema.blocks?.find((x) => x.type === b.type);
        if (bs) visit(bs.settings, b.settings ?? {});
      }
    }
  }
  return { collectionIds: [...collections], productIds: [...products], menuHandles: [...menus] };
}

function refIssues(doc: ThemeDocument, refs: ThemeRefs): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const check = (path: (string | number)[], fields: SettingField[], settings: Record<string, unknown>) => {
    for (const f of fields) {
      if (!("id" in f)) continue;
      const v = settings[f.id];
      const p = [...path, "settings", f.id];
      if (f.type === "collection" && typeof v === "string" && v && !refs.collectionIds.has(v)) issues.push({ path: p, message: "Collection introuvable dans votre boutique." });
      if (f.type === "product" && typeof v === "string" && v && !refs.productIds.has(v)) issues.push({ path: p, message: "Produit introuvable dans votre boutique." });
      if (f.type === "product_list" && Array.isArray(v) && v.some((x) => !refs.productIds.has(String(x)))) issues.push({ path: p, message: "Un des produits est introuvable dans votre boutique." });
      if (f.type === "menu" && refs.menuHandles && typeof v === "string" && v && !refs.menuHandles.has(v)) issues.push({ path: p, message: "Menu introuvable." });
    }
  };
  for (const { path, template: t } of documentTemplates(doc as unknown as Parameters<typeof documentTemplates>[0])) {
    for (const [sid, s] of Object.entries(t.sections)) {
      const schema = SECTION_SCHEMAS[s.type];
      check([...path, "sections", sid], schema.settings, s.settings);
      s.blocks.forEach((b, i) => {
        const bs = schema.blocks?.find((x) => x.type === b.type);
        if (bs) check([...path, "sections", sid, "blocks", i], bs.settings, b.settings);
      });
    }
  }
  if (refs.menuHandles) {
    const { header, footer } = doc.settings;
    if (header.menu && !refs.menuHandles.has(header.menu)) issues.push({ path: ["settings", "header", "menu"], message: "Menu de l'en-tête introuvable." });
    footer.menus.forEach((m, i) => {
      if (!refs.menuHandles!.has(m)) issues.push({ path: ["settings", "footer", "menus", i], message: "Menu du pied de page introuvable." });
    });
  }
  return issues;
}

/**
 * Valide (et normalise : réglages manquants complétés) un document de thème.
 * Rétrocompatibilité : les modèles ajoutés après coup (`blog`, `article`) absents d'un document antérieur sont complétés
 * par leur défaut, et leurs sections obligatoires réinjectées (voir `completeLateTemplates`).
 */
export function validateThemeDocument(input: unknown, opts: { refs?: ThemeRefs } = {}): ValidationResult {
  const parsed = themeDocumentSchema.safeParse(completeLateTemplates(input));
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 50).map((i) => ({
        path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: i.code === "unrecognized_keys" ? `Réglage inconnu : ${(i as { keys?: string[] }).keys?.join(", ") ?? ""}.` : i.message,
      })),
    };
  }
  const doc = parsed.data as unknown as ThemeDocument;
  if (opts.refs) {
    const issues = refIssues(doc, opts.refs);
    if (issues.length) return { ok: false, errors: issues };
  }
  return { ok: true, doc };
}

/**
 * Clé d'erreur utilisée par l'éditeur pour afficher le message sous le bon champ :
 *  - `global:colors.primary`
 *  - `section:{sectionId}:{settingId}` · `block:{sectionId}:{blockIndex}:{settingId}` · `section:{sectionId}` (erreur de section)
 */
export function issueKey(path: (string | number)[]): string {
  if (path[0] === "settings") return `global:${path.slice(1).join(".")}`;
  // Lot 4 : modèle alternatif `alternates.{type}.{suffixe}.sections…` → mêmes clés que `templates.{tid}.sections…`
  if (path[0] === "alternates" && path[3] === "sections") return issueKey(["templates", `${path[1]}:${path[2]}`, ...path.slice(3)]);
  if (path[0] === "templates" && path[2] === "sections" && typeof path[3] === "string") {
    const sid = path[3];
    if (path[4] === "settings" && path[5] != null) return `section:${sid}:${path[5]}`;
    if (path[4] === "blocks" && typeof path[5] === "number" && path[6] === "settings" && path[7] != null) return `block:${sid}:${path[5]}:${path[7]}`;
    return `section:${sid}`;
  }
  return "document";
}
