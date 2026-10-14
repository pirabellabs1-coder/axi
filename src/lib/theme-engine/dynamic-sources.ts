/**
 * Lot 4 §5 : sources dynamiques (module PUR, client et serveur).
 *
 * Un réglage compatible peut valoir `{ "$source": "product.metafields.custom.matiere" }` au lieu d'une valeur fixe.
 *  - Grammaire FERMÉE (`DYNAMIC_SOURCE_RE`, types.ts) : propriétaires product, variant, collection, store, page, article.
 *    Aucun accès client ni commande : la grammaire ne les exprime pas, et `resolveSetting` ne lit que le contexte de rendu.
 *  - Champs personnalisés : seulement ceux dont la définition est `storefrontVisible` ET du bon propriétaire.
 *  - Matrice de compatibilité : `SOURCE_COMPATIBILITY` (type de champ de réglage ← nature de la donnée).
 *  - Résolution au rendu : `resolveSetting` / `resolveSettings` / `resolveSection`, valeur repassée par
 *    `sanitizeFieldValue` (aucune donnée ne contourne la validation d'un réglage saisi à la main).
 *    Valeur absente → défaut du champ ; si le réglage `hide_if_empty` vaut `true`, la section est masquée.
 */
import { safeLink, sanitizeFieldValue } from "@/lib/storefront/theme-doc";
import { formatMoney } from "@/lib/money";
import { SECTION_SCHEMAS } from "./schemas";
import { fieldDefault } from "./editor-defaults";
import { DYNAMIC_SOURCE_FIELD_TYPES, DYNAMIC_SOURCE_RE, isDynamicSource, type SectionInstance, type SettingField, type Settings, type SettingValue, type TemplateId } from "./types";

/* ───────────── Grammaire ───────────── */

export const SOURCE_OWNERS = ["product", "variant", "collection", "store", "page", "article"] as const;
export type SourceOwner = (typeof SOURCE_OWNERS)[number];
export const SOURCE_FIELDS = ["title", "vendor", "description", "type", "tags", "price", "compare_at_price", "image", "url"] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];

/** Propriétaire Prisma (`MetafieldOwner`) correspondant ; `CUSTOMER` et `ORDER` n'ont volontairement aucune entrée. */
export const OWNER_TO_METAFIELD_OWNER: Record<SourceOwner, "PRODUCT" | "VARIANT" | "COLLECTION" | "STORE" | "PAGE" | "BLOG_POST"> = {
  product: "PRODUCT",
  variant: "VARIANT",
  collection: "COLLECTION",
  store: "STORE",
  page: "PAGE",
  article: "BLOG_POST",
};

export type ParsedSource =
  | { owner: SourceOwner; kind: "field"; field: SourceField }
  | { owner: SourceOwner; kind: "metafield"; namespace: string; key: string };

/** Analyse une source ; `null` hors grammaire (aucune autre forme n'est jamais acceptée). */
export function parseSource(source: unknown): ParsedSource | null {
  if (typeof source !== "string" || source.length > 120 || !DYNAMIC_SOURCE_RE.test(source)) return null;
  const [owner, second, namespace, key] = source.split(".");
  if (second === "metafields") return { owner: owner as SourceOwner, kind: "metafield", namespace, key };
  return { owner: owner as SourceOwner, kind: "field", field: second as SourceField };
}

/* ───────────── Nature des données et compatibilité ───────────── */

/** Nature d'une donnée source (indépendante du stockage). */
export type SourceKind = "text" | "multi_line" | "rich_text" | "number" | "date" | "money" | "list" | "boolean" | "color" | "url" | "image" | "reference";

/** Types de `MetafieldDefinition.type` (lot 4 §5) → nature. */
export const METAFIELD_TYPE_KIND: Record<string, SourceKind> = {
  single_line_text: "text",
  multi_line_text: "multi_line",
  rich_text: "rich_text",
  integer: "number",
  decimal: "number",
  rating: "number",
  dimension: "number",
  weight: "number",
  boolean: "boolean",
  date: "date",
  color: "color",
  url: "url",
  image: "image",
  product_reference: "reference",
  collection_reference: "reference",
  list_single_line_text: "list",
  money: "money",
};

/** Nature des champs natifs. */
export const FIELD_KIND: Record<SourceField, SourceKind> = {
  title: "text",
  vendor: "text",
  description: "rich_text",
  type: "text",
  tags: "list",
  price: "money",
  compare_at_price: "money",
  image: "image",
  url: "url",
};

/** Champs natifs disponibles par propriétaire (le reste est refusé même s'il respecte la grammaire). */
export const OWNER_FIELDS: Record<SourceOwner, readonly SourceField[]> = {
  product: ["title", "vendor", "description", "type", "tags", "price", "compare_at_price", "image", "url"],
  variant: ["title", "price", "compare_at_price", "image", "url"],
  collection: ["title", "description", "image", "url"],
  store: ["title", "description", "image", "url"],
  page: ["title", "description", "url"],
  article: ["title", "description", "tags", "image", "url"],
};

export type DynamicFieldType = (typeof DYNAMIC_SOURCE_FIELD_TYPES)[number];

/** Matrice §5 : type de champ de réglage ← natures acceptées. */
export const SOURCE_COMPATIBILITY: Record<DynamicFieldType, readonly SourceKind[]> = {
  text: ["text", "number", "date", "money", "list"],
  textarea: ["text", "multi_line", "number", "date", "money", "list"],
  richtext: ["rich_text", "multi_line", "text"],
  image: ["image"],
  url: ["url", "reference"],
  color: ["color"],
};

export function isDynamicFieldType(t: string): t is DynamicFieldType {
  return (DYNAMIC_SOURCE_FIELD_TYPES as readonly string[]).includes(t);
}

/** Définition de champ personnalisé telle que fournie par l'équipe Données (sous-ensemble de `MetafieldDefinition`). */
export type MetafieldDefinitionLike = {
  ownerType: string;
  namespace: string;
  key: string;
  type: string;
  name?: string;
  storefrontVisible: boolean;
};

function findDefinition(p: Extract<ParsedSource, { kind: "metafield" }>, defs: readonly MetafieldDefinitionLike[]): MetafieldDefinitionLike | undefined {
  const owner = OWNER_TO_METAFIELD_OWNER[p.owner];
  return defs.find((d) => d.ownerType === owner && d.namespace === p.namespace && d.key === p.key);
}

/** Nature d'une source, ou `null` si inconnue / non publique (définition absente ou `storefrontVisible: false`). */
export function sourceKind(source: string, defs: readonly MetafieldDefinitionLike[] = []): SourceKind | null {
  const p = parseSource(source);
  if (!p) return null;
  if (p.kind === "field") return OWNER_FIELDS[p.owner].includes(p.field) ? FIELD_KIND[p.field] : null;
  const d = findDefinition(p, defs);
  if (!d || !d.storefrontVisible) return null;
  return METAFIELD_TYPE_KIND[d.type] ?? null;
}

/** Propriétaires disponibles dans le contexte d'un modèle (le magasin l'est partout). */
export function ownersForTemplate(template: TemplateId): SourceOwner[] {
  switch (template) {
    case "product":
      return ["product", "variant", "store"];
    case "collection":
    case "catalog":
      return ["collection", "store"];
    case "page":
      return ["page", "store"];
    case "article":
      return ["article", "store"];
    default:
      return ["store"];
  }
}

/**
 * Contrôle complet d'une liaison (éditeur ET action serveur avant enregistrement) : grammaire, champ natif existant,
 * définition publique du bon propriétaire, compatibilité de nature, propriétaire disponible sur le modèle.
 */
export function checkBinding(
  fieldType: string,
  source: string,
  opts: { definitions?: readonly MetafieldDefinitionLike[]; template?: TemplateId } = {},
): { ok: true; kind: SourceKind } | { ok: false; reason: string } {
  if (!isDynamicFieldType(fieldType)) return { ok: false, reason: "Ce réglage ne peut pas être connecté à une donnée." };
  const p = parseSource(source);
  if (!p) return { ok: false, reason: "Source dynamique invalide." };
  if (opts.template && !ownersForTemplate(opts.template).includes(p.owner)) return { ok: false, reason: "Cette donnée n'est pas disponible sur ce modèle de page." };
  const kind = sourceKind(source, opts.definitions ?? []);
  if (!kind) return { ok: false, reason: p.kind === "metafield" ? "Champ personnalisé introuvable ou non visible sur la boutique." : "Donnée indisponible pour cet élément." };
  if (!SOURCE_COMPATIBILITY[fieldType].includes(kind)) return { ok: false, reason: "Cette donnée n'est pas compatible avec ce réglage." };
  return { ok: true, kind };
}

const FIELD_LABELS: Record<SourceField, string> = {
  title: "Titre",
  vendor: "Marque",
  description: "Description",
  type: "Type",
  tags: "Étiquettes",
  price: "Prix",
  compare_at_price: "Prix barré",
  image: "Image",
  url: "Lien",
};
const OWNER_LABELS: Record<SourceOwner, string> = { product: "Produit", variant: "Variante", collection: "Collection", store: "Boutique", page: "Page", article: "Article" };

export type SourceOption = { source: string; label: string; group: string; kind: SourceKind };

/** Sources proposées par le sélecteur « Connecter une donnée » pour un champ, sur un modèle donné. */
export function compatibleSources(fieldType: string, template: TemplateId, definitions: readonly MetafieldDefinitionLike[] = []): SourceOption[] {
  if (!isDynamicFieldType(fieldType)) return [];
  const accepted = SOURCE_COMPATIBILITY[fieldType];
  const out: SourceOption[] = [];
  for (const owner of ownersForTemplate(template)) {
    for (const f of OWNER_FIELDS[owner]) {
      if (accepted.includes(FIELD_KIND[f])) out.push({ source: `${owner}.${f}`, label: FIELD_LABELS[f], group: OWNER_LABELS[owner], kind: FIELD_KIND[f] });
    }
    for (const d of definitions) {
      if (d.ownerType !== OWNER_TO_METAFIELD_OWNER[owner] || !d.storefrontVisible) continue;
      const source = `${owner}.metafields.${d.namespace}.${d.key}`;
      const kind = METAFIELD_TYPE_KIND[d.type];
      if (!kind || !accepted.includes(kind) || !DYNAMIC_SOURCE_RE.test(source)) continue;
      out.push({ source, label: d.name || `${d.namespace}.${d.key}`, group: `${OWNER_LABELS[owner]} · champs personnalisés`, kind });
    }
  }
  return out;
}

/* ───────────── Contexte de rendu ───────────── */

/** Valeur publique d'un champ personnalisé (chargée côté serveur, définitions `storefrontVisible` uniquement). */
export type PublicMetafield = { type: string; value: unknown; storefrontVisible: boolean };

/** Données publiques d'un objet du contexte de rendu (aucune donnée client ou commande n'y a sa place). */
export type SourceEntity = {
  title?: string | null;
  vendor?: string | null;
  description?: string | null;
  type?: string | null;
  tags?: string[] | null;
  price?: number | null;
  compare_at_price?: number | null;
  image?: { url: string; alt?: string } | null;
  url?: string | null;
  /** Clé `namespace.key`. */
  metafields?: Record<string, PublicMetafield>;
};

export type DynamicRenderContext = Partial<Record<SourceOwner, SourceEntity | null>> & {
  currency?: string;
  formatMoney?: (amount: number) => string;
  formatDate?: (iso: string) => string;
  /** Référence (product_reference / collection_reference) → lien interne de la boutique, ou null si introuvable. */
  resolveReference?: (type: "product_reference" | "collection_reference", id: string) => string | null;
};

type Raw = { kind: SourceKind; value: unknown; metafieldType?: string };

function readRaw(p: ParsedSource, ctx: DynamicRenderContext): Raw | null {
  const entity = ctx[p.owner];
  if (!entity) return null;
  if (p.kind === "field") {
    if (!OWNER_FIELDS[p.owner].includes(p.field)) return null;
    return { kind: FIELD_KIND[p.field], value: entity[p.field] };
  }
  const mf = entity.metafields?.[`${p.namespace}.${p.key}`];
  // Défense en profondeur : une valeur non publique n'est jamais exposée, même si le chargeur l'a transmise par erreur.
  if (!mf || mf.storefrontVisible !== true) return null;
  const kind = METAFIELD_TYPE_KIND[mf.type];
  return kind ? { kind, value: mf.value, metafieldType: mf.type } : null;
}

function defaultFormatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (o && typeof o.value === "number" && Number.isFinite(o.value)) return o.value;
  if (o && typeof o.amount === "number" && Number.isFinite(o.amount)) return o.amount;
  return null;
}

/** Donnée brute → texte affichable (null si vide). */
function asText(raw: Raw, ctx: DynamicRenderContext): string | null {
  const v = raw.value;
  switch (raw.kind) {
    case "text":
    case "multi_line":
    case "rich_text":
      return typeof v === "string" && v.trim() ? v : null;
    case "number": {
      const n = numberOf(v);
      if (n === null) return null;
      const unit = v && typeof v === "object" && typeof (v as { unit?: unknown }).unit === "string" ? ` ${(v as { unit: string }).unit.slice(0, 8)}` : "";
      return `${new Intl.NumberFormat("fr-FR").format(n)}${unit}`;
    }
    case "money": {
      const n = numberOf(v);
      if (n === null) return null;
      return ctx.formatMoney ? ctx.formatMoney(n) : formatMoney(n, ctx.currency ?? "XOF");
    }
    case "date":
      return typeof v === "string" && v ? (ctx.formatDate ?? defaultFormatDate)(v) || null : null;
    case "list":
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).join(", ") || null : null;
    default:
      return null;
  }
}

/** Convertit la donnée vers la forme attendue par le champ (avant sanitize). */
function toFieldValue(fieldType: DynamicFieldType, raw: Raw, ctx: DynamicRenderContext): unknown {
  if (!SOURCE_COMPATIBILITY[fieldType].includes(raw.kind)) return null;
  switch (fieldType) {
    case "image": {
      const v = raw.value;
      if (typeof v === "string") return { url: v };
      const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
      return o && typeof o.url === "string" ? { url: o.url, ...(typeof o.alt === "string" ? { alt: o.alt } : {}) } : null;
    }
    case "url": {
      if (raw.kind === "reference") {
        const id = typeof raw.value === "string" ? raw.value : null;
        const refType = raw.metafieldType === "collection_reference" ? "collection_reference" : "product_reference";
        return id && ctx.resolveReference ? ctx.resolveReference(refType, id) : null;
      }
      return typeof raw.value === "string" ? safeLink(raw.value) : null;
    }
    case "color":
      return typeof raw.value === "string" ? raw.value : null;
    default:
      return asText(raw, ctx);
  }
}

function isEmpty(v: SettingValue | undefined): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Résout une source pour un champ : valeur nettoyée, ou `null` si absente / incompatible / invalide. */
function resolveSourceFor(field: SettingField, source: string, ctx: DynamicRenderContext): SettingValue | null {
  if (!("id" in field) || !isDynamicFieldType(field.type)) return null;
  const p = parseSource(source);
  const raw = p ? readRaw(p, ctx) : null;
  if (!raw) return null;
  const clean = sanitizeFieldValue(field, toFieldValue(field.type, raw, ctx));
  return isEmpty(clean) ? null : (clean as SettingValue);
}

/**
 * Valeur d'un réglage pour le rendu. Valeur fixe : renvoyée telle quelle. Source dynamique : résolue dans `ctx`,
 * convertie, puis repassée par `sanitizeFieldValue(field, …)`. Absente ou invalide : défaut du champ.
 * `fields` = réglages du schéma (section ou bloc) ; sans champ correspondant, la source est ignorée (`undefined`).
 */
export function resolveSetting(settings: Settings, id: string, ctx: DynamicRenderContext, fields: readonly SettingField[]): SettingValue | undefined {
  const v = settings[id];
  if (!isDynamicSource(v)) return v;
  const field = fields.find((f) => "id" in f && f.id === id);
  if (!field || !("id" in field)) return undefined;
  return resolveSourceFor(field, v.$source, ctx) ?? fieldDefault(field);
}

/** Résout tous les réglages d'une liste ; `empty` = au moins une source liée sans valeur. Sans source : même objet. */
export function resolveSettings(settings: Settings, fields: readonly SettingField[], ctx: DynamicRenderContext): { settings: Settings; empty: boolean } {
  let empty = false;
  let out: Settings | null = null;
  for (const [id, v] of Object.entries(settings)) {
    if (!isDynamicSource(v)) continue;
    out ??= { ...settings };
    const field = fields.find((f) => "id" in f && f.id === id);
    const value = field ? resolveSourceFor(field, v.$source, ctx) : null;
    if (value === null) empty = true;
    const final = value ?? (field && "id" in field ? fieldDefault(field) : undefined);
    if (final === undefined) delete out[id];
    else out[id] = final;
  }
  return { settings: out ?? settings, empty };
}

/**
 * Résout une section (réglages et blocs) avant de la passer au composant de rendu (T3).
 * `hidden: true` si la section a un réglage `hide_if_empty` vrai et qu'une de ses sources est vide.
 * Sans aucune source : renvoie la MÊME section (aucune copie).
 */
export function resolveSection(section: SectionInstance, ctx: DynamicRenderContext): { section: SectionInstance; hidden: boolean } {
  const schema = SECTION_SCHEMAS[section.type];
  if (!schema) return { section, hidden: false };
  const top = resolveSettings(section.settings, schema.settings, ctx);
  let empty = top.empty;
  let changed = top.settings !== section.settings;
  const blocks = section.blocks.map((b) => {
    const bs = schema.blocks?.find((x) => x.type === b.type);
    if (!bs) return b;
    const r = resolveSettings(b.settings, bs.settings, ctx);
    empty ||= r.empty;
    if (r.settings === b.settings) return b;
    changed = true;
    return { ...b, settings: r.settings };
  });
  const hidden = empty && section.settings.hide_if_empty === true;
  return { section: changed ? { ...section, settings: top.settings, blocks } : section, hidden };
}

/** Le réglage est-il lié à une source ? (éditeur : pas d'édition en place, bulle « Donnée du produit ».) */
export function isBound(settings: Settings, id: string): boolean {
  return isDynamicSource(settings[id]);
}
