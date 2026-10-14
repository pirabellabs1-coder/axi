/**
 * Document de thème v2 côté rendu : validation défensive et variables CSS.
 * Module PUR (aucun accès base, aucun « server-only ») : utilisé par le serveur (resolve.ts)
 * ET par l'aperçu en direct de l'éditeur (document reçu par postMessage, revalidé côté client).
 *
 * Règle : une valeur inconnue ou invalide est ignorée et remplacée par celle du document de repli.
 * Aucune chaîne n'est interprétée comme HTML ; seules des URLs https ou internes passent.
 */
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { migrateSearchTemplate } from "@/lib/theme-engine/editor-defaults";
import { safeLink } from "./safe-link";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import {
  ALTERNATE_SUFFIX_RE,
  ALTERNATE_TEMPLATE_TYPES,
  AUDIENCE_CUSTOMER_SEGMENTS,
  AUDIENCE_DEVICES,
  AUDIENCE_SOURCES,
  DEFAULT_MOTION,
  DYNAMIC_SOURCE_FIELD_TYPES,
  isDynamicSource,
  MAX_ALTERNATE_TEMPLATES,
  MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE,
  MAX_VISIBILITY_RULES,
  MOTION_PRESETS,
  SECTION_ANIMATIONS,
  THEME_DOC_VERSION,
  type AlternateTemplateType,
  BLOG_CATEGORY_HANDLE_RE,
  type AudienceRule,
  type BlockInstance,
  type FontId,
  type GlobalSettings,
  type SectionInstance,
  type SectionType,
  type SettingField,
  type SettingValue,
  type Settings,
  type MotionSettings,
  type SectionVisibility,
  type Template,
  type TemplateId,
  type ThemeDocument,
} from "@/lib/theme-engine/types";

/** `blog` et `article` (lot 2) : absents des documents antérieurs, repris du document de repli au sanitize. */
export const TEMPLATE_IDS: TemplateId[] = ["home", "product", "collection", "catalog", "page", "cart", "search", "not_found", "blog", "article"];
export const FONT_IDS: FontId[] = ["geist", "inter-tight", "manrope", "dm-sans", "plus-jakarta", "outfit", "fraunces", "playfair", "cormorant", "space-grotesk", "system"];

const MAX_SECTIONS = 40;
const MAX_BLOCKS = 50;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* ───────────────────────── Primitives ───────────────────────── */

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Lien accepté (voir ./safe-link, partagé avec le Markdown des descriptions produit). */
export { safeLink };

/** Image : https, chemin interne (dont `/media/…`), média du bucket (STORAGE_PUBLIC_URL) ou data-URL héritée. */
export function safeImageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^https:\/\/[^\s<>"']{4,2000}$/i.test(s)) return s;
  if (/^\/(?!\/)[^\s<>"'\\]{1,300}$/.test(s)) return s;
  if (isStoredMediaUrl(s)) return s;
  // Ancien import de l'éditeur (avant le stockage des médias) : data-URL raster (jamais SVG), 300 Ko maximum.
  // LECTURE seule (rendu rétrocompatible) : ce module n'enregistre rien ; les écritures passent par
  // src/lib/theme/actions.ts, qui refuse toute data-URL absente du thème déjà en base (checkImageWrite).
  if (s.length <= 410_000 && /^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(s)) return s;
  return null;
}

function str(v: unknown, max = 2000): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function imageValue(v: unknown): { url: string; alt?: string } | null {
  const o = obj(v);
  const url = safeImageUrl(o ? o.url : v);
  if (!url) return null;
  const alt = o && typeof o.alt === "string" ? o.alt.slice(0, 200) : undefined;
  return alt ? { url, alt } : { url };
}

/* ───────────────────────── Réglages de section / bloc ───────────────────────── */

const DYNAMIC_TYPES = new Set<string>(DYNAMIC_SOURCE_FIELD_TYPES);

/** Valide une valeur selon son champ de schéma. `undefined` = valeur ignorée (le défaut s'appliquera). */
export function sanitizeFieldValue(field: SettingField, v: unknown): SettingValue | undefined {
  // Lot 4 §5 : source dynamique (grammaire fermée), seulement pour les champs compatibles ; résolue au rendu.
  if (isDynamicSource(v)) return DYNAMIC_TYPES.has(field.type) ? { $source: v.$source } : undefined;
  switch (field.type) {
    case "text":
      return str(v, field.maxLength ?? 300) ?? undefined;
    case "textarea":
      return str(v, field.maxLength ?? 2000) ?? undefined;
    case "richtext":
      return str(v, 5000) ?? undefined;
    case "number": {
      const n = num(v);
      if (n === null) return undefined;
      return clamp(n, field.min ?? -1e9, field.max ?? 1e9);
    }
    case "range": {
      const n = num(v);
      if (n === null) return undefined;
      return clamp(n, field.min, field.max);
    }
    case "checkbox":
      return typeof v === "boolean" ? v : undefined;
    case "select":
    case "segmented":
      if (typeof v !== "string") return undefined;
      // « Couleurs de la section » : les schémas globaux (`colors.schemes`) sont aussi permis, comme dans validate.ts ;
      // un identifiant inconnu est sans effet au rendu (`schemeVars` → couleurs par défaut).
      if (field.id === "scheme" && /^[a-z0-9-]{1,24}$/.test(v)) return v;
      return field.options.some((o) => o.value === v) ? v : undefined;
    case "color":
      return isHexColor(v) ? v : v === null || v === "" ? null : undefined;
    case "image":
      return v === null ? null : imageValue(v) ?? undefined;
    case "video":
      return v === null || v === "" ? null : typeof v === "string" && /^https:\/\/[^\s<>"']{4,500}$/i.test(v.trim()) ? v.trim() : undefined;
    case "url":
      return v === null || v === "" ? null : safeLink(v) ?? undefined;
    case "collection":
    case "product":
      return v === null || v === "" ? null : typeof v === "string" && ID_RE.test(v) ? v : undefined;
    case "product_list":
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && ID_RE.test(x)).slice(0, field.limit ?? 50) : undefined;
    case "menu":
      return typeof v === "string" && HANDLE_RE.test(v) ? v : undefined;
    case "blog_category": {
      // Rétrocompatible avec l'ancien champ texte de « Derniers articles » (adresse saisie à la main) : normalisée.
      if (typeof v !== "string") return undefined;
      const h = v.trim().toLowerCase();
      return h === "" || BLOG_CATEGORY_HANDLE_RE.test(h) ? h : undefined;
    }
    case "font":
      return typeof v === "string" && (FONT_IDS as string[]).includes(v) ? v : undefined;
    default:
      return undefined;
  }
}

/** Valeurs par défaut d'une liste de champs (schéma). */
export function fieldDefaults(fields: SettingField[]): Settings {
  const out: Settings = {};
  for (const f of fields) {
    if (f.type === "header" || f.type === "paragraph") continue;
    if ("default" in f && f.default !== undefined) out[f.id] = f.default as SettingValue;
  }
  return out;
}

/** Réglages validés : défauts du schéma + valeurs valides fournies. Clés inconnues ignorées. */
export function sanitizeSettings(fields: SettingField[], raw: unknown): Settings {
  const out = fieldDefaults(fields);
  const o = obj(raw);
  if (!o) return out;
  for (const f of fields) {
    if (f.type === "header" || f.type === "paragraph") continue;
    if (!(f.id in o)) continue;
    const v = sanitizeFieldValue(f, o[f.id]);
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}

export function sanitizeSection(raw: unknown, fallbackId?: string): SectionInstance | null {
  const o = obj(raw);
  if (!o) return null;
  const type = o.type as SectionType;
  const schema = typeof type === "string" ? SECTION_SCHEMAS[type] : undefined;
  if (!schema) return null;
  const id = typeof o.id === "string" && ID_RE.test(o.id) ? o.id : fallbackId && ID_RE.test(fallbackId) ? fallbackId : null;
  if (!id) return null;
  const blocks: BlockInstance[] = [];
  const counts = new Map<string, number>();
  const max = Math.min(schema.maxBlocks ?? MAX_BLOCKS, MAX_BLOCKS);
  if (Array.isArray(o.blocks) && schema.blocks?.length) {
    for (const [i, b] of o.blocks.entries()) {
      if (blocks.length >= max) break;
      const bo = obj(b);
      if (!bo) continue;
      const bs = schema.blocks.find((s) => s.type === bo.type);
      if (!bs) continue;
      const n = counts.get(bs.type) ?? 0;
      if (bs.limit && n >= bs.limit) continue;
      counts.set(bs.type, n + 1);
      const bid = typeof bo.id === "string" && ID_RE.test(bo.id) ? bo.id : `${id}-b${i}`;
      blocks.push({ id: bid, type: bs.type, settings: sanitizeSettings(bs.settings, bo.settings), ...(bo.disabled === true ? { disabled: true } : {}) });
    }
  }
  const visibility = sanitizeVisibility(o.visibility);
  const animation = pick(o.animation, SECTION_ANIMATIONS, "inherit");
  return {
    id,
    type: schema.type,
    settings: sanitizeSettings(schema.settings, o.settings),
    blocks,
    ...(o.disabled === true ? { disabled: true } : {}),
    // Lot 4 : présents seulement s'ils l'étaient (et valides) — les documents antérieurs restent identiques.
    ...(visibility ? { visibility } : {}),
    ...("animation" in o && typeof o.animation === "string" && animation === o.animation ? { animation } : {}),
  };
}

/* ───────────────────────── Lot 4 : audiences ───────────────────────── */

function stringList<T extends string>(v: unknown, max: number, ok: (x: string) => x is T): T[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()))].filter(ok).slice(0, max);
}

function sanitizeAudienceRule(raw: unknown): AudienceRule | null {
  const o = obj(raw);
  if (!o) return null;
  const inList = <T extends string>(list: readonly T[]) => (x: string): x is T => (list as readonly string[]).includes(x);
  switch (o.type) {
    case "city": {
      const values = stringList(o.values, 50, (x): x is string => x.length > 0 && x.length <= 80);
      return values.length ? { type: "city", values } : null;
    }
    case "customer": {
      const values = stringList(o.values, 5, inList(AUDIENCE_CUSTOMER_SEGMENTS));
      return values.length ? { type: "customer", values } : null;
    }
    case "source": {
      const values = stringList(o.values, 7, inList(AUDIENCE_SOURCES));
      return values.length ? { type: "source", values } : null;
    }
    case "locale": {
      const values = stringList(o.values, 12, (x): x is string => /^[a-z]{2,3}$/.test(x));
      return values.length ? { type: "locale", values } : null;
    }
    case "device": {
      const values = stringList(o.values, 2, inList(AUDIENCE_DEVICES));
      return values.length ? { type: "device", values } : null;
    }
    case "schedule": {
      const hhmm = (x: unknown) => typeof x === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(x);
      const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
      return days.length && hhmm(o.from) && hhmm(o.to) ? { type: "schedule", days, from: o.from as string, to: o.to as string } : null;
    }
    default:
      return null;
  }
}

/** Visibilité par audience : règles inconnues ou invalides ignorées ; `null` si absente ou sans règle valide (section visible pour tous). */
export function sanitizeVisibility(raw: unknown): SectionVisibility | null {
  const o = obj(raw);
  if (!o) return null;
  const rules = Array.isArray(o.rules) ? o.rules.map(sanitizeAudienceRule).filter((r): r is AudienceRule => !!r).slice(0, MAX_VISIBILITY_RULES) : [];
  // Aucune règle exploitable : visible pour tous (jamais « masquée pour tous » par une règle corrompue).
  if (!rules.length) return null;
  return { match: pick(o.match, ["all", "any"] as const, "all"), mode: pick(o.mode, ["show", "hide"] as const, "show"), rules };
}

function sectionAllowed(type: SectionType, template: TemplateId): boolean {
  const s = SECTION_SCHEMAS[type];
  if (s.templates) return s.templates.includes(template);
  return s.category !== "Modèle";
}

export function sanitizeTemplate(raw: unknown, template: TemplateId, fallback: Template): Template {
  const o = obj(raw);
  const rawSections = o ? obj(o.sections) : null;
  if (!o || !rawSections || !Array.isArray(o.order)) return fallback;
  const sections: Record<string, SectionInstance> = {};
  const order: string[] = [];
  for (const id of o.order) {
    if (order.length >= MAX_SECTIONS) break;
    if (typeof id !== "string" || order.includes(id) || !(id in rawSections)) continue;
    const s = sanitizeSection(rawSections[id], id);
    if (!s || !sectionAllowed(s.type, template)) continue;
    // L'identifiant de la clé fait foi (l'éditeur s'y réfère pour la sélection).
    s.id = id;
    // Lot 4 : au-delà du plafond de sections personnalisées, la visibilité est ignorée (section visible pour tous).
    if (s.visibility && Object.values(sections).filter((x) => x.visibility).length >= MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE) delete s.visibility;
    sections[id] = s;
    order.push(id);
  }
  // Section obligatoire du modèle (main-product, main-collection…) : réinjectée si absente.
  for (const fid of fallback.order) {
    const fs = fallback.sections[fid];
    if (!fs || !SECTION_SCHEMAS[fs.type]?.required) continue;
    if (Object.values(sections).some((s) => s.type === fs.type)) continue;
    const id = sections[fid] ? `${fid}-main` : fid;
    sections[id] = { ...fs, id };
    order.unshift(id);
  }
  return { order, sections };
}

/* ───────────────────────── Réglages globaux ───────────────────────── */

export function sanitizeGlobalSettings(raw: unknown, fb: GlobalSettings): GlobalSettings {
  const o = obj(raw) ?? {};
  const c = obj(o.colors) ?? {};
  const hex = (k: keyof Omit<GlobalSettings["colors"], "schemes">) => (isHexColor(c[k]) ? (c[k] as string) : fb.colors[k]);
  const schemes = Array.isArray(c.schemes)
    ? c.schemes
        .map((s) => obj(s))
        .filter((s): s is Record<string, unknown> => !!s && typeof s.id === "string" && ID_RE.test(s.id) && isHexColor(s.background) && isHexColor(s.text))
        .slice(0, 8)
        .map((s) => {
          // Rôles avancés optionnels : conservés seulement si hex valide, sinon omis (→ dérivation au rendu).
          const opt: Record<string, string> = {};
          for (const k of ["surface", "border", "link", "secondaryButton", "secondaryButtonText"] as const) {
            if (isHexColor(s[k])) opt[k] = s[k] as string;
          }
          return {
            id: s.id as string,
            name: str(s.name, 40) ?? (s.id as string),
            background: s.background as string,
            text: s.text as string,
            primary: isHexColor(s.primary) ? (s.primary as string) : fb.colors.primary,
            primaryText: isHexColor(s.primaryText) ? (s.primaryText as string) : fb.colors.primaryText,
            ...opt,
          };
        })
    : fb.colors.schemes;

  const t = obj(o.typography) ?? {};
  const b = obj(o.buttons) ?? {};
  const cd = obj(o.cards) ?? {};
  const l = obj(o.layout) ?? {};
  const h = obj(o.header) ?? {};
  const ann = obj(h.announcement) ?? {};
  const f = obj(o.footer) ?? {};
  const soc = obj(f.social) ?? {};
  const p = obj(o.product) ?? {};
  const cart = obj(o.cart) ?? {};
  const social = obj(o.social) ?? {};
  const n = (v: unknown, min: number, max: number, def: number) => {
    const x = num(v);
    return x === null ? def : clamp(x, min, max);
  };
  const socialLink = (k: keyof GlobalSettings["footer"]["social"]) => {
    const v = soc[k];
    if (k === "whatsapp") return typeof v === "string" && /^\+?[0-9 ]{6,20}$/.test(v) ? v.replace(/\D/g, "") : undefined;
    const u = typeof v === "string" && /^https:\/\/[^\s<>"']{4,300}$/i.test(v) ? v : undefined;
    return u;
  };
  const socials: GlobalSettings["footer"]["social"] = {};
  for (const k of ["instagram", "facebook", "tiktok", "youtube", "whatsapp"] as const) {
    const v = "social" in f ? socialLink(k) : fb.footer.social[k];
    if (v) socials[k] = v;
  }

  return {
    colors: {
      background: hex("background"),
      surface: hex("surface"),
      text: hex("text"),
      muted: hex("muted"),
      primary: hex("primary"),
      primaryText: hex("primaryText"),
      accent: hex("accent"),
      border: hex("border"),
      schemes,
    },
    typography: (() => {
      const scale = n(t.scale, 0.85, 1.3, fb.typography.scale);
      return {
        heading: pick(t.heading, FONT_IDS, fb.typography.heading),
        body: pick(t.body, FONT_IDS, fb.typography.body),
        headingWeight: ([500, 600, 700, 800] as const).includes(t.headingWeight as 500) ? (t.headingWeight as 500 | 600 | 700 | 800) : fb.typography.headingWeight,
        scale,
        uppercaseButtons: bool(t.uppercaseButtons, fb.typography.uppercaseButtons),
        headingTracking: n(t.headingTracking, -0.05, 0.1, fb.typography.headingTracking ?? 0),
        headingTransform: pick(t.headingTransform, ["none", "uppercase", "small-caps"] as const, fb.typography.headingTransform ?? "none"),
        // Absent des documents antérieurs : le corps suivait l'échelle générale → on reprend `scale` (rendu inchangé).
        bodyScale: t.bodyScale == null ? clamp(scale, 0.9, 1.2) : n(t.bodyScale, 0.9, 1.2, clamp(scale, 0.9, 1.2)),
        bodyLeading: pick(t.bodyLeading, ["tight", "normal", "relaxed"] as const, fb.typography.bodyLeading ?? "normal"),
        headingLineHeight: pick(t.headingLineHeight, ["tight", "normal"] as const, fb.typography.headingLineHeight ?? "tight"),
      };
    })(),
    buttons: {
      radius: n(b.radius, 0, 999, fb.buttons.radius), // 999 = pilule (même borne que validate.ts)
      style: pick(b.style, ["solid", "outline", "soft"] as const, fb.buttons.style),
      shadow: bool(b.shadow, fb.buttons.shadow),
      borderWidth: n(b.borderWidth, 0, 3, fb.buttons.borderWidth ?? 1),
      size: pick(b.size, ["compact", "normal", "large"] as const, fb.buttons.size ?? "normal"),
    },
    cards: {
      radius: n(cd.radius, 0, 40, fb.cards.radius),
      imageRatio: pick(cd.imageRatio, ["square", "portrait", "landscape", "natural"] as const, fb.cards.imageRatio),
      showVendor: bool(cd.showVendor, fb.cards.showVendor),
      showSecondImage: bool(cd.showSecondImage, fb.cards.showSecondImage),
      quickAdd: bool(cd.quickAdd, fb.cards.quickAdd),
      border: bool(cd.border, fb.cards.border),
      showFavorite: bool(cd.showFavorite, fb.cards.showFavorite),
      saleBadge: pick(cd.saleBadge, ["percent", "text", "hidden"] as const, fb.cards.saleBadge ?? "percent"),
      style: pick(cd.style, ["standard", "overlay"] as const, fb.cards.style ?? "standard"),
      showNewBadge: bool(cd.showNewBadge, fb.cards.showNewBadge ?? false),
    },
    layout: {
      pageWidth: n(l.pageWidth, 1100, 1600, fb.layout.pageWidth),
      sectionSpacing: n(l.sectionSpacing, 0, 160, fb.layout.sectionSpacing),
      gutter: n(l.gutter, 8, 48, fb.layout.gutter),
    },
    header: {
      logo: "logo" in h ? imageValue(h.logo) : fb.header.logo,
      logoWidth: n(h.logoWidth, 40, 300, fb.header.logoWidth),
      layout: pick(h.layout, ["logo-left", "logo-center", "minimal"] as const, fb.header.layout),
      sticky: bool(h.sticky, fb.header.sticky),
      menu: typeof h.menu === "string" && HANDLE_RE.test(h.menu) ? h.menu : fb.header.menu,
      showSearch: bool(h.showSearch, fb.header.showSearch),
      showAccount: bool(h.showAccount, fb.header.showAccount),
      showCurrencyPicker: bool(h.showCurrencyPicker, fb.header.showCurrencyPicker ?? true),
      transparentOverHero: bool(h.transparentOverHero, fb.header.transparentOverHero ?? false),
      announcement: {
        enabled: bool(ann.enabled, fb.header.announcement.enabled),
        text: str(ann.text, 160) ?? fb.header.announcement.text,
        link: "link" in ann ? safeLink(ann.link) ?? undefined : fb.header.announcement.link,
        scheme: typeof ann.scheme === "string" && ID_RE.test(ann.scheme) ? ann.scheme : fb.header.announcement.scheme,
      },
    },
    footer: {
      menus: Array.isArray(f.menus) ? f.menus.filter((m): m is string => typeof m === "string" && HANDLE_RE.test(m)).slice(0, 4) : fb.footer.menus,
      showSocial: bool(f.showSocial, fb.footer.showSocial),
      social: socials,
      text: str(f.text, 500) ?? fb.footer.text,
      showPaymentIcons: bool(f.showPaymentIcons, fb.footer.showPaymentIcons),
      newsletter: bool(f.newsletter, fb.footer.newsletter),
    },
    product: {
      gallery: pick(p.gallery, ["stacked", "carousel", "thumbnails-left", "thumbnails-bottom", "grid-2"] as const, fb.product.gallery),
      variantPicker: pick(p.variantPicker, ["buttons", "dropdown", "swatches"] as const, fb.product.variantPicker),
      stickyAddToCart: bool(p.stickyAddToCart, fb.product.stickyAddToCart),
      showSku: bool(p.showSku, fb.product.showSku),
      showStock: bool(p.showStock, fb.product.showStock),
      showShareButtons: bool(p.showShareButtons, fb.product.showShareButtons),
    },
    cart: {
      type: pick(cart.type, ["drawer", "page"] as const, fb.cart.type),
      showNote: bool(cart.showNote, fb.cart.showNote),
      freeShippingBar: bool(cart.freeShippingBar, fb.cart.freeShippingBar),
    },
    social: {
      favicon: "favicon" in social ? imageValue(social.favicon) : fb.social.favicon,
      shareImage: "shareImage" in social ? imageValue(social.shareImage) : fb.social.shareImage,
    },
    // Lot 4 §2 : présent seulement s'il l'était (documents antérieurs inchangés) ; clés manquantes = DEFAULT_MOTION.
    ...(obj(o.motion) ? { motion: sanitizeMotion(obj(o.motion)!) } : {}),
  };
}

function sanitizeMotion(m: Record<string, unknown>): MotionSettings {
  return {
    preset: pick(m.preset, MOTION_PRESETS, DEFAULT_MOTION.preset),
    reveal: bool(m.reveal, DEFAULT_MOTION.reveal),
    parallax: bool(m.parallax, DEFAULT_MOTION.parallax),
    hoverZoom: bool(m.hoverZoom, DEFAULT_MOTION.hoverZoom),
  };
}

/** Lot 4 §6 : modèles alternatifs valides (suffixe, règles du modèle de base), 20 au total ; `undefined` si aucun. */
export function sanitizeAlternates(raw: unknown, fallback: ThemeDocument): ThemeDocument["alternates"] | undefined {
  const o = obj(raw);
  if (!o) return undefined;
  const out: NonNullable<ThemeDocument["alternates"]> = {};
  let count = 0;
  for (const type of ALTERNATE_TEMPLATE_TYPES as readonly AlternateTemplateType[]) {
    const bySuffix = obj(o[type]);
    if (!bySuffix) continue;
    const list: Record<string, Template> = {};
    for (const [suffix, tpl] of Object.entries(bySuffix)) {
      if (count >= MAX_ALTERNATE_TEMPLATES) break;
      if (!ALTERNATE_SUFFIX_RE.test(suffix) || !obj(tpl)) continue;
      list[suffix] = sanitizeTemplate(tpl, type, fallback.templates[type]);
      count++;
    }
    if (Object.keys(list).length) out[type] = list;
  }
  return count ? out : undefined;
}

/**
 * Validation défensive d'un document complet. Tout ce qui est inconnu, mal typé ou dangereux est ignoré
 * et remplacé par le document de repli (défaut du secteur ou migration de l'ancien thème).
 */
export function sanitizeThemeDocument(raw: unknown, fallback: ThemeDocument): ThemeDocument {
  // Vague 2 : un modèle « Recherche » encore basé sur `main-collection` est migré vers `main-search` (réglages repris).
  const o = obj(migrateSearchTemplate(raw));
  if (!o || o.version !== THEME_DOC_VERSION) return fallback;
  const tpl = obj(o.templates) ?? {};
  const templates = {} as Record<TemplateId, Template>;
  for (const id of TEMPLATE_IDS) templates[id] = sanitizeTemplate(tpl[id], id, fallback.templates[id]);
  const alternates = sanitizeAlternates(o.alternates, fallback);
  return {
    version: THEME_DOC_VERSION,
    preset: typeof o.preset === "string" && /^[a-z0-9-]{1,40}$/.test(o.preset) ? o.preset : fallback.preset,
    settings: sanitizeGlobalSettings(o.settings, fallback.settings),
    templates,
    ...(alternates ? { alternates } : {}),
    ...(typeof o.updatedAt === "string" && o.updatedAt.length <= 40 ? { updatedAt: o.updatedAt } : {}),
  };
}

/* ───────────────────────── Lecture typée des réglages (rendu) ───────────────────────── */

export const S = {
  str(s: Settings, k: string, def = ""): string {
    const v = s[k];
    return typeof v === "string" ? v : def;
  },
  num(s: Settings, k: string, def = 0): number {
    const v = s[k];
    return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : def;
  },
  bool(s: Settings, k: string, def = false): boolean {
    const v = s[k];
    return typeof v === "boolean" ? v : def;
  },
  img(s: Settings, k: string): { url: string; alt?: string } | null {
    return imageValue(s[k]);
  },
  link(s: Settings, k: string): string | null {
    return safeLink(s[k]);
  },
  list(s: Settings, k: string): string[] {
    const v = s[k];
    return Array.isArray(v) ? v : [];
  },
};

/* ───────────────────────── Couleurs et variables CSS ───────────────────────── */

export function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function relLum(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Texte lisible sur un fond donné : celui demandé s'il contraste assez (≥ 4,5), sinon noir ou blanc. */
export function readableOn(bg: string, preferred?: string): string {
  if (preferred && isHexColor(preferred) && contrastRatio(bg, preferred) >= 4.5) return preferred;
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#111412") ? "#ffffff" : "#111412";
}

export function rgba(hex: string, a: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ───────────────────────── Arrière-plan de section (image / dégradé + superposition) ───────────────────────── */

/** Mélange deux couleurs hex : `top` posée sur `base` à l'opacité `a` (0–1). */
function blendHex(base: string, top: string, a: number): string {
  const b = hexToRgb(base);
  const t = hexToRgb(top);
  const mix = (x: number, y: number) => Math.round(x * (1 - a) + y * a);
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(mix(b.r, t.r))}${to2(mix(b.g, t.g))}${to2(mix(b.b, t.b))}`;
}

/** Ton de texte à forcer sur un fond donné : clair si le fond est sombre, sombre sinon. */
function toneFor(bg: string): "light" | "dark" {
  return readableOn(bg) === "#ffffff" ? "light" : "dark";
}

const BG_POSITIONS: Record<string, string> = { top: "top center", center: "center", bottom: "bottom center" };

export type SectionBackground = {
  kind: "image" | "gradient";
  /** Style du calque de fond (image couvrante ou dégradé), posé DERRIÈRE le contenu. */
  layer: Record<string, string>;
  /** Image fixe au défilement (parallaxe léger) ; neutralisé sous prefers-reduced-motion via le CSS. */
  fixed: boolean;
  /** Voile de superposition (rgba) au-dessus du fond et sous le contenu, ou `null` si intensité nulle. */
  overlay: string | null;
  /** Ton de texte à forcer pour garder le contraste, ou `null` si indéterminé (on garde le schéma). */
  tone: "light" | "dark" | null;
};

/**
 * Résout le style d'arrière-plan d'une section à partir de ses réglages (helper `BACKGROUND`). Fonction PURE
 * (type → CSS), testée unitairement. Renvoie `null` quand `bg_type` vaut « Aucun » (ou image manquante) : repli
 * sans fond, l'existant est inchangé. Le ton (clair/sombre) réutilise la logique de contraste `readableOn`.
 */
export function resolveSectionBackground(s: Settings): SectionBackground | null {
  const type = S.str(s, "bg_type", "none");
  if (type !== "image" && type !== "gradient") return null;

  const overlayPct = Math.min(80, Math.max(0, S.num(s, "bg_overlay", 0)));
  const overlayColor = isHexColor(S.str(s, "bg_overlay_color", "#000000")) ? S.str(s, "bg_overlay_color", "#000000") : "#000000";
  const a = overlayPct / 100;
  const overlay = a > 0 ? rgba(overlayColor, a) : null;

  if (type === "image") {
    const img = S.img(s, "bg_image");
    if (!img) return null;
    const pos = BG_POSITIONS[S.str(s, "bg_position", "center")] ?? BG_POSITIONS.center;
    const layer: Record<string, string> = {
      backgroundImage: `url("${img.url}")`,
      backgroundSize: "cover",
      backgroundPosition: pos,
      backgroundRepeat: "no-repeat",
    };
    // Image : couleurs inconnues. On ne force le ton que si la superposition est franche (≥ 40 %),
    // sinon on laisse le schéma de section décider (pas de faux contraste).
    const tone = a >= 0.4 ? toneFor(blendHex("#808080", overlayColor, a)) : null;
    return { kind: "image", layer, fixed: S.bool(s, "bg_fixed", false), overlay, tone };
  }

  const from = isHexColor(S.str(s, "bg_gradient_from", "")) ? S.str(s, "bg_gradient_from", "") : "#1f2937";
  const to = isHexColor(S.str(s, "bg_gradient_to", "")) ? S.str(s, "bg_gradient_to", "") : "#111827";
  const angle = Math.min(360, Math.max(0, S.num(s, "bg_gradient_angle", 135)));
  const layer: Record<string, string> = { backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})` };
  // Fond déterminé : milieu du dégradé, puis superposition éventuelle → ton de texte lisible.
  const mid = blendHex(from, to, 0.5);
  const eff = a > 0 ? blendHex(mid, overlayColor, a) : mid;
  return { kind: "gradient", layer, fixed: false, overlay, tone: toneFor(eff) };
}

/** Variables de couleur à surcharger quand un fond impose un ton de texte (clair sur fond sombre, ou l'inverse). */
export function backgroundToneVars(tone: "light" | "dark"): Record<string, string> {
  const ink = tone === "light" ? "#ffffff" : "#111412";
  const against = tone === "light" ? "#111412" : "#ffffff";
  return {
    color: ink,
    "--c-ink": ink,
    "--c-ink-muted": `color-mix(in srgb, ${ink} 75%, ${against})`,
    "--c-ink-faint": `color-mix(in srgb, ${ink} 55%, ${against})`,
    "--c-line": `color-mix(in srgb, ${ink} 22%, transparent)`,
    "--c-line-strong": `color-mix(in srgb, ${ink} 40%, transparent)`,
    "--c-link": ink,
  };
}

/* ───────────────────────── Largeur de section (helper SECTION_WIDTH) ───────────────────────── */

/** Largeurs maximales du contenu interne par réglage `content_width`. « Standard » = largeur de page (défaut). */
const CONTENT_WIDTHS: Record<string, string> = {
  narrow: "720px",
  standard: "var(--store-page-width)",
  wide: "calc(var(--store-page-width) + 160px)",
};

export type SectionWidth = {
  /** Section en pleine largeur : le contenu s'étend aussi bord à bord (le fond l'est déjà via la mise en page). */
  full: boolean;
  /** Largeur maximale CSS du contenu interne (valeur de `--section-max`). */
  contentMax: string;
  /** Variable à poser sur la section ; `.sf-container` la lit (repli = largeur de page, soit le rendu actuel). */
  vars: Record<string, string>;
};

/**
 * Résout la largeur d'une section à partir de ses réglages (helper `SECTION_WIDTH`). Fonction PURE (réglages → CSS),
 * testée unitairement. Défauts « Contenu » + « Standard » → `var(--store-page-width)` : identique au rendu actuel
 * (le repli de `.sf-container` est déjà la largeur de page). « Pleine largeur » → contenu à 100 % (dans les marges).
 * Aucun `100vw` : les sections occupent déjà toute la largeur de `<main>`, donc le fond est déjà bord à bord et aucune
 * barre de défilement horizontale n'est introduite ; « Large » est borné par la fenêtre (`width:100%` de `.sf-container`).
 */
export function resolveSectionWidth(s: Settings): SectionWidth {
  const full = S.str(s, "section_width", "content") === "full";
  const contentMax = full ? "100%" : CONTENT_WIDTHS[S.str(s, "content_width", "standard")] ?? CONTENT_WIDTHS.standard;
  return { full, contentMax, vars: { "--section-max": contentMax } };
}

const SANS_FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SERIF_FALLBACK = "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";

/** Pile de polices pour un FontId (la variable est posée par next/font, sinon repli système). */
export function fontStack(id: FontId): string {
  switch (id) {
    case "geist":
      return `var(--font-geist), ${SANS_FALLBACK}`;
    case "system":
      return SANS_FALLBACK;
    case "fraunces":
    case "playfair":
    case "cormorant":
      return `var(--font-sf-${id}), ${SERIF_FALLBACK}`;
    default:
      return `var(--font-sf-${id}), var(--font-geist), ${SANS_FALLBACK}`;
  }
}

/** Variables CSS de la boutique (racine). Réécrit aussi les jetons Axi (--c-*) pour que les classes utilitaires suivent le thème. */
export function themeCssVars(s: GlobalSettings): Record<string, string> {
  const c = s.colors;
  const primaryText = readableOn(c.primary, c.primaryText);
  const accentText = readableOn(c.accent);
  const muted = contrastRatio(c.background, c.muted) >= 4.5 ? c.muted : readableOn(c.background) === "#ffffff" ? "#c9cdca" : "#4f5652";
  const cardRadius = s.cards.radius;
  const tg = s.typography;
  const bodyScale = tg.bodyScale ?? tg.scale;
  const bodyLeading = ({ tight: "1.4", normal: "1.6", relaxed: "1.8" } as const)[tg.bodyLeading ?? "normal"] ?? "1.6";
  const headingLeading = ({ tight: "1.05", normal: "1.15" } as const)[tg.headingLineHeight ?? "tight"] ?? "1.05";
  const tracking = tg.headingTracking ?? 0;
  // « MAJUSCULES » : léger interlettrage automatique quand l'interlettrage réglé est nul (lisibilité des capitales).
  const headingTracking = tg.headingTransform === "uppercase" && tracking === 0 ? 0.02 : tracking;
  return {
    "--c-canvas": c.background,
    "--c-canvas-deep": `color-mix(in srgb, ${c.text} 5%, ${c.background})`,
    "--c-surface": c.surface,
    "--c-surface-2": `color-mix(in srgb, ${c.text} 5%, ${c.surface})`,
    "--c-line": c.border,
    "--c-line-strong": `color-mix(in srgb, ${c.text} 22%, ${c.border})`,
    "--c-ink": c.text,
    "--c-ink-muted": muted,
    "--c-ink-faint": `color-mix(in srgb, ${muted} 80%, ${c.background})`,
    "--store-bg": c.background,
    "--store-text": c.text,
    "--store-primary": c.primary,
    "--store-primary-contrast": primaryText,
    "--store-primary-soft": rgba(c.primary, 0.08),
    "--store-primary-ring": rgba(c.primary, 0.22),
    "--store-accent": c.accent,
    "--store-accent-contrast": accentText,
    "--store-accent-soft": rgba(c.accent, 0.18),
    "--store-radius": `${s.buttons.radius}px`,
    "--store-card-radius": `${cardRadius}px`,
    "--store-media-radius": `${Math.max(0, cardRadius - 4)}px`,
    "--store-page-width": `${s.layout.pageWidth}px`,
    "--store-section-gap": `${s.layout.sectionSpacing}px`,
    "--store-gutter": `${s.layout.gutter}px`,
    "--store-font": fontStack(s.typography.body),
    "--store-font-heading": fontStack(s.typography.heading),
    "--store-heading-weight": String(s.typography.headingWeight),
    "--store-scale": String(s.typography.scale),
    "--store-body-scale": String(bodyScale),
    "--store-heading-tracking": `${headingTracking}em`,
    "--store-heading-transform": tg.headingTransform === "uppercase" ? "uppercase" : "none",
    "--store-heading-variant": tg.headingTransform === "small-caps" ? "small-caps" : "normal",
    "--store-heading-leading": headingLeading,
    "--store-body-leading": bodyLeading,
    "--store-btn-transform": s.typography.uppercaseButtons ? "uppercase" : "none",
    "--store-btn-shadow": s.buttons.shadow ? `0 10px 24px -12px ${rgba(c.primary, 0.6)}` : "none",
    "--store-btn-border": `${s.buttons.borderWidth ?? 1}px`,
    ...btnSizeVars(s.buttons.size),
    "--store-card-ring": s.cards.border ? "1px" : "0px",
  };
}

/** Gabarit des boutons par défaut (hauteur + padding horizontal), piloté par le réglage global « Taille ». */
function btnSizeVars(size: GlobalSettings["buttons"]["size"]): Record<string, string> {
  const map = {
    compact: { h: "40px", px: "18px" },
    normal: { h: "48px", px: "24px" },
    large: { h: "56px", px: "32px" },
  } as const;
  const v = map[size] ?? map.normal;
  return { "--store-btn-h": v.h, "--store-btn-px": v.px };
}

/** Schéma de couleur d'une section (« default », « surface », « inverse », « brand » ou schéma personnalisé). */
export function schemeVars(s: GlobalSettings, scheme: string | undefined): Record<string, string> | null {
  if (!scheme || scheme === "default") return null;
  const c = s.colors;
  let bg: string, text: string, primary: string, primaryText: string;
  let adv: GlobalSettings["colors"]["schemes"][number] | undefined;
  if (scheme === "surface") {
    bg = c.surface;
    text = c.text;
    primary = c.primary;
    primaryText = c.primaryText;
  } else if (scheme === "inverse") {
    bg = c.text;
    text = c.background;
    primary = c.background;
    primaryText = c.text;
  } else if (scheme === "brand") {
    bg = c.primary;
    text = readableOn(c.primary, c.primaryText);
    primary = c.accent;
    primaryText = readableOn(c.accent);
  } else {
    // Schéma personnalisé : les rôles avancés (facultatifs) surchargent la dérivation quand ils sont fournis.
    const custom = c.schemes.find((x) => x.id === scheme);
    if (!custom) return null;
    bg = custom.background;
    text = readableOn(custom.background, custom.text);
    primary = custom.primary;
    primaryText = custom.primaryText;
    adv = custom;
  }
  const muted = `color-mix(in srgb, ${text} 72%, ${bg})`;
  const vars: Record<string, string> = {
    "--c-canvas": bg,
    "--c-surface": adv?.surface ? adv.surface : `color-mix(in srgb, ${text} 6%, ${bg})`,
    "--c-surface-2": `color-mix(in srgb, ${text} 10%, ${bg})`,
    "--c-line": adv?.border ? adv.border : `color-mix(in srgb, ${text} 16%, ${bg})`,
    "--c-line-strong": `color-mix(in srgb, ${text} 30%, ${bg})`,
    "--c-ink": text,
    "--c-ink-muted": muted,
    "--c-ink-faint": `color-mix(in srgb, ${text} 60%, ${bg})`,
    "--c-link": adv?.link ? adv.link : text,
    "--store-primary": primary,
    "--store-primary-contrast": readableOn(primary, primaryText),
    "--store-primary-soft": rgba(primary, 0.12),
    backgroundColor: bg,
    color: text,
  };
  // Bouton secondaire : si fourni, bouton plein ; sinon repli « contour » (--store-secondary-ring par défaut dans le CSS).
  if (adv?.secondaryButton) {
    vars["--store-secondary"] = adv.secondaryButton;
    vars["--store-secondary-contrast"] = readableOn(adv.secondaryButton, adv.secondaryButtonText ?? undefined);
    vars["--store-secondary-ring"] = "none";
  }
  return vars;
}
