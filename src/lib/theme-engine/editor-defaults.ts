/**
 * Valeurs par défaut utilisées par l'éditeur de thème (module pur, client et serveur).
 *
 * `defaultsFor(fields)` construit les réglages par défaut d'un schéma ; `fallbackThemeDocument(preset)` fournit un
 * document complet quand le moteur de rendu (`defaults.ts` : `defaultThemeDocument(sector)`) n'est pas disponible.
 */
import { SECTION_SCHEMAS } from "./schemas";
import type { FontId, GlobalSettings, SectionInstance, SectionType, SettingField, Settings, SettingValue, Template, TemplateId, ThemeDocument } from "./types";
import { THEME_DOC_VERSION } from "./types";

export const TEMPLATE_IDS: TemplateId[] = ["home", "product", "collection", "catalog", "page", "cart", "search", "not_found", "blog", "article"];

/** Modèles ajoutés après la v2 (lot 2 : blog) : absents des documents antérieurs, complétés par `completeLateTemplates`. */
export const LATE_TEMPLATE_IDS: TemplateId[] = ["blog", "article"];

/** Modèles de page proposés dans le sélecteur de l'éditeur (ordre d'affichage). */
export const EDITABLE_TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: "home", label: "Accueil" },
  { id: "product", label: "Produit" },
  { id: "collection", label: "Collection" },
  { id: "catalog", label: "Catalogue" },
  { id: "page", label: "Page" },
  { id: "cart", label: "Panier" },
  // Vague 2 : modèle « Recherche » (section `main-search`), migré depuis l'ancien modèle à base de `main-collection`.
  { id: "search", label: "Recherche" },
  // Lot 2 D (blog) : liste des articles et article (modèles alternatifs d'article : `article:<suffixe>`).
  { id: "blog", label: "Blog" },
  { id: "article", label: "Article" },
];

export const FONT_OPTIONS: { value: FontId; label: string }[] = [
  { value: "geist", label: "Geist (moderne)" },
  { value: "inter-tight", label: "Inter Tight" },
  { value: "manrope", label: "Manrope" },
  { value: "dm-sans", label: "DM Sans" },
  { value: "plus-jakarta", label: "Plus Jakarta Sans" },
  { value: "outfit", label: "Outfit" },
  { value: "space-grotesk", label: "Space Grotesk" },
  { value: "fraunces", label: "Fraunces (serif)" },
  { value: "playfair", label: "Playfair Display (serif)" },
  { value: "cormorant", label: "Cormorant (serif élégant)" },
  { value: "system", label: "Police du système" },
];
export const FONT_IDS = FONT_OPTIONS.map((f) => f.value) as [FontId, ...FontId[]];

/** Nombre maximum de sections par modèle de page. */
export const MAX_SECTIONS_PER_TEMPLATE = 25;

/** Valeur par défaut d'un champ de réglage (null = non renseigné). */
export function fieldDefault(field: SettingField): SettingValue | undefined {
  switch (field.type) {
    case "header":
    case "paragraph":
      return undefined;
    case "text":
    case "textarea":
    case "richtext":
      return field.default ?? "";
    case "url":
      return field.default ?? "";
    case "video":
      return "";
    case "number":
      return field.default ?? field.min ?? 0;
    case "range":
      return field.default;
    case "checkbox":
      return field.default ?? false;
    case "select":
    case "segmented":
      return field.default ?? field.options[0]?.value ?? "";
    case "color":
      return field.default ?? null;
    case "font":
      return field.default ?? "geist";
    case "menu":
    case "blog_category":
      return field.default ?? "";
    case "product_list":
      return [];
    case "image":
    case "collection":
    case "product":
      return null;
  }
}

/** Réglages par défaut d'une liste de champs, surchargés par `overrides` (clés connues seulement). */
export function defaultsFor(fields: SettingField[], overrides?: Settings): Settings {
  const out: Settings = {};
  for (const f of fields) {
    if (!("id" in f)) continue;
    const d = fieldDefault(f);
    if (d !== undefined) out[f.id] = d;
    if (overrides && f.id in overrides) out[f.id] = overrides[f.id];
  }
  return out;
}

/* ───────────── Document de secours ───────────── */

type PresetLike = { id: string; config: { primary: string; accent: string; font: "sans" | "display" | "serif"; radius: "sharp" | "soft" | "round" } };

const FONT_BY_LEGACY: Record<PresetLike["config"]["font"], FontId> = { sans: "geist", display: "space-grotesk", serif: "fraunces" };
const RADIUS_BY_LEGACY: Record<PresetLike["config"]["radius"], number> = { sharp: 2, soft: 10, round: 999 };

function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111111" : "#ffffff";
}

export function fallbackGlobalSettings(preset?: PresetLike): GlobalSettings {
  const primary = preset?.config.primary ?? "#0d3b2e";
  const accent = preset?.config.accent ?? "#b8f06a";
  const font = preset ? FONT_BY_LEGACY[preset.config.font] : "geist";
  const radius = preset ? RADIUS_BY_LEGACY[preset.config.radius] : 10;
  return {
    colors: {
      background: "#ffffff",
      surface: "#f6f6f3",
      text: "#141414",
      muted: "#5c5c5c",
      primary,
      primaryText: readableOn(primary),
      accent,
      border: "#e4e4df",
      schemes: [
        { id: "inverse", name: "Inversé", background: "#141414", text: "#ffffff", primary: "#ffffff", primaryText: "#141414" },
        { id: "brand", name: "Couleur de marque", background: primary, text: readableOn(primary), primary: accent, primaryText: readableOn(accent) },
      ],
    },
    typography: { heading: font, body: "geist", headingWeight: 700, scale: 1, uppercaseButtons: false, headingTracking: 0, headingTransform: "none", bodyScale: 1, bodyLeading: "normal", headingLineHeight: "tight" },
    buttons: { radius: Math.min(radius, 999), style: "solid", shadow: false, borderWidth: 1, size: "normal" },
    cards: { radius: Math.min(radius, 24), imageRatio: "portrait", showVendor: false, showSecondImage: true, quickAdd: true, border: false, showFavorite: false, saleBadge: "percent", style: "standard", showNewBadge: false },
    layout: { pageWidth: 1280, sectionSpacing: 48, gutter: 16 },
    header: {
      logo: null,
      logoWidth: 120,
      layout: "logo-left",
      sticky: true,
      menu: "main",
      showSearch: true,
      showAccount: true,
      showCurrencyPicker: true,
      transparentOverHero: false,
      announcement: { enabled: false, text: "", link: "", scheme: "brand" },
    },
    footer: { menus: ["footer"], showSocial: true, social: {}, text: "", showPaymentIcons: true, newsletter: false },
    product: { gallery: "thumbnails-left", variantPicker: "buttons", stickyAddToCart: true, showSku: false, showStock: true, showShareButtons: true },
    cart: { type: "drawer", showNote: true, freeShippingBar: false },
    social: { favicon: null, shareImage: null },
  };
}

/** Instancie une section depuis son préréglage, avec des ids fournis par `nextId`. */
export function buildSection(type: SectionType, nextId: (prefix: string) => string, presetIndex = 0): SectionInstance {
  const schema = SECTION_SCHEMAS[type];
  const preset = schema.presets[presetIndex] ?? schema.presets[0];
  return {
    id: nextId(type),
    type,
    settings: defaultsFor(schema.settings, preset?.settings),
    blocks: (preset?.blocks ?? []).map((b) => {
      const bs = schema.blocks?.find((x) => x.type === b.type);
      return { id: nextId(b.type), type: b.type, settings: defaultsFor(bs?.settings ?? [], b.settings) };
    }),
  };
}

function isSectionType(t: string): t is SectionType {
  return Object.prototype.hasOwnProperty.call(SECTION_SCHEMAS, t);
}

/**
 * Section principale d'un modèle du lot 2 (`main-blog`, `main-article`), livrée par l'équipe Blog dans `schemas.ts` :
 * incluse dans les défauts dès que son schéma existe, sans autre modification de ce fichier.
 */
export function lateMainSections(template: TemplateId): SectionType[] {
  const main = template === "blog" ? "main-blog" : template === "article" ? "main-article" : null;
  return main && isSectionType(main) ? [main] : [];
}

const HOME_SECTIONS: SectionType[] = ["announcement-bar", "hero-banner", "collection-list", "featured-collection", "multicolumn", "testimonials", "faq", "whatsapp-cta"];
const TEMPLATE_SECTIONS: Record<TemplateId, SectionType[]> = {
  home: HOME_SECTIONS,
  product: ["main-product", "product-recommendations"],
  collection: ["main-collection"],
  catalog: ["main-collection"],
  page: ["main-page"],
  cart: ["main-cart", "product-recommendations"],
  search: ["main-search"],
  not_found: ["rich-text"],
  blog: [...lateMainSections("blog"), "newsletter"],
  article: [...lateMainSections("article"), "featured-collection"],
};

/** Générateur d'ids déterministe par document (évite toute collision entre modèles). */
export function sequentialIds(seed = 0): (prefix: string) => string {
  let n = seed;
  return (prefix) => `${prefix.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${(++n).toString(36)}`;
}

export function fallbackThemeDocument(preset?: PresetLike): ThemeDocument {
  const nextId = sequentialIds();
  const templates = {} as Record<TemplateId, Template>;
  for (const t of TEMPLATE_IDS) {
    const sections: Record<string, SectionInstance> = {};
    const order: string[] = [];
    for (const type of TEMPLATE_SECTIONS[t]) {
      const s = buildSection(type, nextId);
      sections[s.id] = s;
      order.push(s.id);
    }
    templates[t] = { order, sections };
  }
  return { version: THEME_DOC_VERSION, preset: preset?.id ?? "general", settings: fallbackGlobalSettings(preset), templates };
}

/** Modèle de secours d'un type (sections de `TEMPLATE_SECTIONS`, identifiants déterministes). */
export function fallbackTemplate(template: TemplateId, nextId: (prefix: string) => string = sequentialIds()): Template {
  const sections: Record<string, SectionInstance> = {};
  const order: string[] = [];
  for (const type of TEMPLATE_SECTIONS[template]) {
    const s = buildSection(type, nextId);
    sections[s.id] = s;
    order.push(s.id);
  }
  return { order, sections };
}

/* ───────────── Rétrocompatibilité des modèles tardifs (lot 2) ───────────── */

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Réinjecte (en tête) les sections obligatoires absentes d'un modèle tardif ; renvoie l'entrée telle quelle si rien ne manque. */
function withRequiredSections(template: TemplateId, raw: unknown): unknown {
  const t = rec(raw);
  const sections = t ? rec(t.sections) : null;
  if (!t || !sections || !Array.isArray(t.order)) return raw; // forme invalide : la validation la signale
  const required = Object.values(SECTION_SCHEMAS).filter((s) => s.required && s.templates?.includes(template));
  const missing = required.filter((r) => !Object.values(sections).some((s) => rec(s)?.type === r.type));
  if (!missing.length) return raw;
  const taken = new Set<string>(Object.keys(sections));
  for (const s of Object.values(sections)) for (const b of (rec(s)?.blocks as unknown[] | undefined) ?? []) if (typeof rec(b)?.id === "string") taken.add(rec(b)!.id as string);
  const nextId = (prefix: string) => {
    let n = 0;
    let id: string;
    do id = `${prefix.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-auto-${++n}`;
    while (taken.has(id));
    taken.add(id);
    return id;
  };
  const out = { ...t, order: [...t.order], sections: { ...sections } };
  for (const r of [...missing].reverse()) {
    const s = buildSection(r.type, nextId);
    out.sections[s.id] = s;
    out.order.unshift(s.id);
  }
  return out;
}

/* ───────────── Migration du modèle « Recherche » (vague 2) ───────────── */

/** Réglages repris de l'ancienne section `main-collection` du modèle recherche vers `main-search`. */
const SEARCH_CARRIED_SETTINGS = ["show_filters", "show_sort", "per_page", "columns"] as const;

/**
 * Le modèle `search` utilisait la section « Collection » (`main-collection`) ; il a sa propre section
 * `main-search` depuis la vague 2. Un document enregistré avant la migration est complété AU CHARGEMENT :
 * la section `main-collection` du modèle recherche est remplacée, à la même position, par `main-search` avec ses
 * réglages compatibles (filtres, tri, produits par page, colonnes). Aucun brouillon n'est invalidé ; un document
 * déjà migré (ou une forme inattendue) est renvoyé tel quel.
 */
export function migrateSearchTemplate(input: unknown): unknown {
  const doc = rec(input);
  const templates = doc ? rec(doc.templates) : null;
  if (!doc || !templates) return input;
  if (!isSectionType("main-search")) return input; // schéma pas encore livré : rien à migrer
  const cur = templates.search;
  const t = rec(cur);
  const sections = t ? rec(t.sections) : null;
  if (!t || !sections || !Array.isArray(t.order)) return input;
  const entries = Object.entries(sections);
  if (entries.some(([, v]) => rec(v)?.type === "main-search")) return input; // déjà migré
  const legacy = entries.find(([, v]) => rec(v)?.type === "main-collection");
  if (!legacy) return input; // ni ancienne ni nouvelle section : `sanitizeTemplate` / la validation réinjecteront le défaut
  const [legacyId, legacyRaw] = legacy;
  const old = rec(legacyRaw) ?? {};
  const oldSettings = rec(old.settings) ?? {};
  const carried: Record<string, unknown> = {};
  for (const k of SEARCH_CARRIED_SETTINGS) if (oldSettings[k] !== undefined) carried[k] = oldSettings[k];
  const taken = new Set(Object.keys(sections));
  let id = "main-search";
  let n = 0;
  while (taken.has(id)) id = `main-search-${++n}`;
  const built = buildSection("main-search", () => id);
  const section = { ...built, settings: { ...built.settings, ...carried } };
  const out = { ...t, order: t.order.map((x) => (x === legacyId ? id : x)), sections: { ...sections, [id]: section } };
  delete (out.sections as Record<string, unknown>)[legacyId];
  if (!out.order.includes(id)) out.order = [id, ...out.order.filter((x) => x !== legacyId)];
  return { ...doc, templates: { ...templates, search: out } };
}

/**
 * Complète un document brut avant validation : modèles tardifs (`blog`, `article`) absents → défaut ; présents mais sans
 * leur section obligatoire (document enregistré avant la livraison de `main-blog` / `main-article`) → section réinjectée ;
 * modèle `search` encore basé sur `main-collection` → migré vers `main-search` (vague 2).
 * Ne touche jamais aux autres modèles ; renvoie l'entrée inchangée (même référence) si rien n'est à compléter.
 */
export function completeLateTemplates(input: unknown): unknown {
  const migrated = migrateSearchTemplate(input);
  const doc = rec(migrated);
  const templates = doc ? rec(doc.templates) : null;
  if (!doc || !templates) return migrated;
  let next: Record<string, unknown> | null = null;
  for (const tid of LATE_TEMPLATE_IDS) {
    const cur = templates[tid];
    const fixed = cur === undefined ? fallbackTemplate(tid) : withRequiredSections(tid, cur);
    if (fixed !== cur) (next ??= { ...templates })[tid] = fixed;
  }
  return next ? { ...doc, templates: next } : migrated;
}
