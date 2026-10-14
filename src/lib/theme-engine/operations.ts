/**
 * Opérations pures sur le document de thème (éditeur, IA, scores, MCP). Chaque fonction renvoie un NOUVEAU document
 * (partage structurel, jamais de mutation) et lève `ThemeOpError` (message en français) si l'opération est interdite.
 * Les ids existants ne changent jamais ; les nouveaux ids sont uniques dans le document (modèles alternatifs compris).
 *
 * Lot 4 : le paramètre `template` accepte une `TemplateKey` (`"product"` ou modèle alternatif `"product:luxe"`) ;
 * un `TemplateId` reste valide (rétrocompatible). `applyOperations` applique une liste sérialisable `ThemeOperation[]`
 * (liste blanche d'opérations et de chemins globaux), atomiquement, puis revalide le document.
 */
import { SECTION_SCHEMAS, sectionsForTemplate } from "./schemas";
import { buildSection, defaultsFor, fallbackTemplate, MAX_SECTIONS_PER_TEMPLATE } from "./editor-defaults";
import { allTemplates, canAddAlternate, getTemplateByKey, isAlternateSuffix, isAlternateType, parseTemplateKey, type TemplateKey } from "./alternates";
import { sectionVisibilitySchema, validateThemeDocument, type ThemeRefs, type ValidationIssue } from "./validate";
import { sanitizeSection } from "@/lib/storefront/theme-doc";
import {
  DEFAULT_MOTION,
  DYNAMIC_SOURCE_FIELD_TYPES,
  DYNAMIC_SOURCE_RE,
  MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE,
  SECTION_ANIMATIONS,
  type AlternateTemplateType,
  type BlockInstance,
  type SectionAnimation,
  type SectionInstance,
  type SectionType,
  type SectionVisibility,
  type SettingField,
  type SettingValue,
  type Settings,
  type Template,
  type TemplateId,
  type ThemeDocument,
} from "./types";

export type { TemplateKey } from "./alternates";

export class ThemeOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeOpError";
  }
}

export type IdFactory = (prefix: string) => string;

/* ───────────── Ids ───────────── */

function allIds(doc: ThemeDocument): Set<string> {
  const ids = new Set<string>();
  for (const { template: t } of allTemplates(doc)) {
    for (const s of Object.values(t.sections)) {
      ids.add(s.id);
      for (const b of s.blocks) ids.add(b.id);
    }
  }
  return ids;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

/** Fabrique d'ids uniques pour ce document (aléatoire, re-tirée en cas de collision). */
export function uniqueIdFactory(doc: ThemeDocument, random: () => string = randomSuffix): IdFactory {
  const used = allIds(doc);
  return (prefix) => {
    const base = prefix.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 24) || "item";
    let id = `${base}-${random()}`;
    for (let i = 0; used.has(id); i++) id = `${base}-${random()}${i}`;
    used.add(id);
    return id;
  };
}

/* ───────────── Accès ───────────── */

/** Type de base d'une clé de modèle (`"product:luxe"` → `"product"`). */
export function baseTemplate(template: TemplateKey): TemplateId {
  const k = parseTemplateKey(template);
  if (!k) throw new ThemeOpError("Modèle de page introuvable.");
  return k.base;
}

function getTemplate(doc: ThemeDocument, template: TemplateKey): Template {
  const t = getTemplateByKey(doc, template);
  if (!t) throw new ThemeOpError("Modèle de page introuvable.");
  return t;
}

function getSection(doc: ThemeDocument, template: TemplateKey, sectionId: string): SectionInstance {
  const s = getTemplate(doc, template).sections[sectionId];
  if (!s) throw new ThemeOpError("Section introuvable.");
  return s;
}

function withTemplate(doc: ThemeDocument, template: TemplateKey, next: Template): ThemeDocument {
  const k = parseTemplateKey(template);
  if (!k) throw new ThemeOpError("Modèle de page introuvable.");
  if (k.suffix === null) return { ...doc, templates: { ...doc.templates, [k.base]: next } };
  const type = k.base as AlternateTemplateType;
  return { ...doc, alternates: { ...doc.alternates, [type]: { ...doc.alternates?.[type], [k.suffix]: next } } };
}

function withSection(doc: ThemeDocument, template: TemplateKey, section: SectionInstance): ThemeDocument {
  const t = getTemplate(doc, template);
  return withTemplate(doc, template, { ...t, sections: { ...t.sections, [section.id]: section } });
}

function clampIndex(i: number, length: number): number {
  return Math.max(0, Math.min(length, Math.trunc(i)));
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(clampIndex(to, out.length), 0, item);
  return out;
}

/* ───────────── Règles ───────────── */

/** La section peut-elle être ajoutée à ce modèle (catégorie, unicité des sections obligatoires, plafond) ? */
export function canAddSection(doc: ThemeDocument, template: TemplateKey, type: SectionType): { ok: true } | { ok: false; reason: string } {
  const schema = SECTION_SCHEMAS[type];
  if (!schema) return { ok: false, reason: "Type de section inconnu." };
  if (!sectionsForTemplate(baseTemplate(template)).some((s) => s.type === type)) return { ok: false, reason: `« ${schema.name} » n'est pas disponible sur ce modèle de page.` };
  const t = getTemplate(doc, template);
  if (t.order.length >= MAX_SECTIONS_PER_TEMPLATE) return { ok: false, reason: `Maximum ${MAX_SECTIONS_PER_TEMPLATE} sections par page.` };
  if (schema.required && Object.values(t.sections).some((s) => s.type === type)) return { ok: false, reason: `« ${schema.name} » est déjà présente sur cette page.` };
  return { ok: true };
}

/** Le bloc peut-il être ajouté (type connu, maxBlocks de la section, limit du bloc) ? */
export function canAddBlock(section: SectionInstance, blockType: string): { ok: true } | { ok: false; reason: string } {
  const schema = SECTION_SCHEMAS[section.type];
  const bs = schema?.blocks?.find((b) => b.type === blockType);
  if (!bs) return { ok: false, reason: "Ce bloc n'est pas disponible dans cette section." };
  if (schema.maxBlocks != null && section.blocks.length >= schema.maxBlocks) return { ok: false, reason: `Maximum ${schema.maxBlocks} blocs dans « ${schema.name} ».` };
  if (bs.limit != null && section.blocks.filter((b) => b.type === blockType).length >= bs.limit) return { ok: false, reason: `« ${bs.name} » : ${bs.limit} maximum dans cette section.` };
  return { ok: true };
}

export function isRequiredSection(section: SectionInstance): boolean {
  return !!SECTION_SCHEMAS[section.type]?.required;
}

/* ───────────── Sections ───────────── */

export function addSection(
  doc: ThemeDocument,
  template: TemplateKey,
  type: SectionType,
  opts: { index?: number; presetIndex?: number; ids?: IdFactory } = {},
): { doc: ThemeDocument; id: string } {
  const check = canAddSection(doc, template, type);
  if (!check.ok) throw new ThemeOpError(check.reason);
  const section = buildSection(type, opts.ids ?? uniqueIdFactory(doc), opts.presetIndex ?? 0);
  const t = getTemplate(doc, template);
  const order = t.order.slice();
  order.splice(clampIndex(opts.index ?? order.length, order.length), 0, section.id);
  return { doc: withTemplate(doc, template, { order, sections: { ...t.sections, [section.id]: section } }), id: section.id };
}

export function duplicateSection(doc: ThemeDocument, template: TemplateKey, sectionId: string, ids?: IdFactory): { doc: ThemeDocument; id: string } {
  const src = getSection(doc, template, sectionId);
  if (isRequiredSection(src)) throw new ThemeOpError("Cette section est unique sur la page et ne peut pas être dupliquée.");
  const t = getTemplate(doc, template);
  if (t.order.length >= MAX_SECTIONS_PER_TEMPLATE) throw new ThemeOpError(`Maximum ${MAX_SECTIONS_PER_TEMPLATE} sections par page.`);
  const nextId = ids ?? uniqueIdFactory(doc);
  const copy: SectionInstance = structuredClone(src);
  copy.id = nextId(src.type);
  copy.blocks = copy.blocks.map((b) => ({ ...b, id: nextId(b.type) }));
  const order = t.order.slice();
  order.splice(order.indexOf(sectionId) + 1, 0, copy.id);
  return { doc: withTemplate(doc, template, { order, sections: { ...t.sections, [copy.id]: copy } }), id: copy.id };
}

export function removeSection(doc: ThemeDocument, template: TemplateKey, sectionId: string): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  if (isRequiredSection(src)) throw new ThemeOpError("Cette section est obligatoire sur ce modèle de page.");
  const t = getTemplate(doc, template);
  const sections = { ...t.sections };
  delete sections[sectionId];
  return withTemplate(doc, template, { order: t.order.filter((id) => id !== sectionId), sections });
}

export function setSectionHidden(doc: ThemeDocument, template: TemplateKey, sectionId: string, hidden: boolean): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  if (hidden && isRequiredSection(src)) throw new ThemeOpError("Cette section est obligatoire et ne peut pas être masquée.");
  const next = { ...src };
  if (hidden) next.disabled = true;
  else delete next.disabled;
  return withSection(doc, template, next);
}

export function moveSection(doc: ThemeDocument, template: TemplateKey, sectionId: string, toIndex: number): ThemeDocument {
  const t = getTemplate(doc, template);
  const from = t.order.indexOf(sectionId);
  if (from < 0) throw new ThemeOpError("Section introuvable.");
  if (from === clampIndex(toIndex, t.order.length - 1)) return doc;
  return withTemplate(doc, template, { ...t, order: moveItem(t.order, from, toIndex) });
}

export function updateSectionSetting(doc: ThemeDocument, template: TemplateKey, sectionId: string, key: string, value: SettingValue): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  if (!SECTION_SCHEMAS[src.type].settings.some((f) => "id" in f && f.id === key)) throw new ThemeOpError("Réglage inconnu.");
  return withSection(doc, template, { ...src, settings: { ...src.settings, [key]: value } });
}

/** Remet les réglages de la section à leurs valeurs par défaut (les blocs sont conservés). */
export function resetSectionSettings(doc: ThemeDocument, template: TemplateKey, sectionId: string): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  return withSection(doc, template, { ...src, settings: defaultsFor(SECTION_SCHEMAS[src.type].settings) });
}

/** Remplace réglages et blocs par un préréglage du schéma (l'id de la section est conservé). */
export function applySectionPreset(doc: ThemeDocument, template: TemplateKey, sectionId: string, presetIndex: number, ids?: IdFactory): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  const schema = SECTION_SCHEMAS[src.type];
  if (!schema.presets[presetIndex]) throw new ThemeOpError("Préréglage introuvable.");
  const built = buildSection(src.type, ids ?? uniqueIdFactory(doc), presetIndex);
  return withSection(doc, template, { ...built, id: src.id, ...(src.disabled ? { disabled: true } : {}) });
}

/* ───────────── Blocs ───────────── */

function getBlockIndex(section: SectionInstance, blockId: string): number {
  const i = section.blocks.findIndex((b) => b.id === blockId);
  if (i < 0) throw new ThemeOpError("Bloc introuvable.");
  return i;
}

export function addBlock(
  doc: ThemeDocument,
  template: TemplateKey,
  sectionId: string,
  blockType: string,
  opts: { index?: number; ids?: IdFactory } = {},
): { doc: ThemeDocument; id: string } {
  const src = getSection(doc, template, sectionId);
  const check = canAddBlock(src, blockType);
  if (!check.ok) throw new ThemeOpError(check.reason);
  const bs = SECTION_SCHEMAS[src.type].blocks!.find((b) => b.type === blockType)!;
  const block: BlockInstance = { id: (opts.ids ?? uniqueIdFactory(doc))(blockType), type: blockType, settings: defaultsFor(bs.settings) };
  const blocks = src.blocks.slice();
  blocks.splice(clampIndex(opts.index ?? blocks.length, blocks.length), 0, block);
  return { doc: withSection(doc, template, { ...src, blocks }), id: block.id };
}

export function duplicateBlock(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string, ids?: IdFactory): { doc: ThemeDocument; id: string } {
  const src = getSection(doc, template, sectionId);
  const i = getBlockIndex(src, blockId);
  const check = canAddBlock(src, src.blocks[i].type);
  if (!check.ok) throw new ThemeOpError(check.reason);
  const copy: BlockInstance = { ...structuredClone(src.blocks[i]), id: (ids ?? uniqueIdFactory(doc))(src.blocks[i].type) };
  const blocks = src.blocks.slice();
  blocks.splice(i + 1, 0, copy);
  return { doc: withSection(doc, template, { ...src, blocks }), id: copy.id };
}

export function removeBlock(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  getBlockIndex(src, blockId);
  return withSection(doc, template, { ...src, blocks: src.blocks.filter((b) => b.id !== blockId) });
}

export function setBlockHidden(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string, hidden: boolean): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  const i = getBlockIndex(src, blockId);
  const next = { ...src.blocks[i] };
  if (hidden) next.disabled = true;
  else delete next.disabled;
  const blocks = src.blocks.slice();
  blocks[i] = next;
  return withSection(doc, template, { ...src, blocks });
}

export function moveBlock(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string, toIndex: number): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  const from = getBlockIndex(src, blockId);
  if (from === clampIndex(toIndex, src.blocks.length - 1)) return doc;
  return withSection(doc, template, { ...src, blocks: moveItem(src.blocks, from, toIndex) });
}

export function updateBlockSetting(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string, key: string, value: SettingValue): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  const i = getBlockIndex(src, blockId);
  const block = src.blocks[i];
  const bs = SECTION_SCHEMAS[src.type].blocks?.find((b) => b.type === block.type);
  if (!bs?.settings.some((f) => "id" in f && f.id === key)) throw new ThemeOpError("Réglage inconnu.");
  const blocks = src.blocks.slice();
  blocks[i] = { ...block, settings: { ...block.settings, [key]: value } };
  return withSection(doc, template, { ...src, blocks });
}

export function resetBlockSettings(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  const i = getBlockIndex(src, blockId);
  const bs = SECTION_SCHEMAS[src.type].blocks?.find((b) => b.type === src.blocks[i].type);
  const blocks = src.blocks.slice();
  blocks[i] = { ...blocks[i], settings: defaultsFor(bs?.settings ?? []) };
  return withSection(doc, template, { ...src, blocks });
}

/* ───────────── Réglages globaux ───────────── */

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function getAtPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Écrit `value` au chemin pointé (`colors.primary`, `header.announcement.text`) en recopiant chaque niveau. */
export function setAtPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  if (keys.some((k) => !k || FORBIDDEN_KEYS.has(k))) throw new ThemeOpError("Chemin de réglage invalide.");
  const rec = (node: unknown, i: number): unknown => {
    const base = node && typeof node === "object" && !Array.isArray(node) ? (node as Record<string, unknown>) : {};
    if (i === keys.length - 1) return { ...base, [keys[i]]: value };
    return { ...base, [keys[i]]: rec(base[keys[i]], i + 1) };
  };
  return rec(obj, 0) as T;
}

export function updateGlobalSetting(doc: ThemeDocument, path: string, value: unknown): ThemeDocument {
  if (getAtPath(doc.settings, path.split(".").slice(0, -1).join(".") || "") === undefined && path.includes(".")) {
    throw new ThemeOpError("Réglage inconnu.");
  }
  return { ...doc, settings: setAtPath(doc.settings, path, value) };
}

/* ───────────── Lot 4 : animation, visibilité par audience ───────────── */

export function setSectionAnimation(doc: ThemeDocument, template: TemplateKey, sectionId: string, animation: SectionAnimation): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  if (!(SECTION_ANIMATIONS as readonly string[]).includes(animation)) throw new ThemeOpError("Animation inconnue.");
  const next = { ...src };
  if (animation === "inherit") delete next.animation;
  else next.animation = animation;
  return withSection(doc, template, next);
}

/**
 * Visibilité par audience (§12). `null` (ou aucune règle) = visible pour tous. Interdite sur les sections obligatoires
 * (fiche produit, panier…) : on ne masque jamais un prix par audience. Plafond : 30 sections personnalisées par modèle.
 * Le contrôle de plan (Business : règle `customer` seulement) est fait par l'action serveur (`disallowedRuleTypes`, audience.ts).
 */
export function setSectionVisibility(doc: ThemeDocument, template: TemplateKey, sectionId: string, visibility: SectionVisibility | null): ThemeDocument {
  const src = getSection(doc, template, sectionId);
  const next = { ...src };
  if (visibility == null || !Array.isArray(visibility.rules) || !visibility.rules.length) {
    delete next.visibility;
    return withSection(doc, template, next);
  }
  if (isRequiredSection(src)) throw new ThemeOpError("Cette section est obligatoire : elle reste visible pour tous.");
  const parsed = sectionVisibilitySchema.safeParse(visibility);
  if (!parsed.success) throw new ThemeOpError(parsed.error.issues[0]?.message ?? "Règle d'audience invalide.");
  const t = getTemplate(doc, template);
  const personalized = Object.values(t.sections).filter((s) => s.visibility && s.id !== sectionId).length;
  if (personalized >= MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE) throw new ThemeOpError(`${MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE} sections personnalisées par audience maximum par page.`);
  next.visibility = parsed.data as SectionVisibility;
  return withSection(doc, template, next);
}

/* ───────────── Lot 4 : sources dynamiques ───────────── */

const DYNAMIC_TYPES = new Set<string>(DYNAMIC_SOURCE_FIELD_TYPES);

function settingFieldOf(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string | null | undefined, key: string): { section: SectionInstance; blockIndex: number; field: SettingField } {
  const section = getSection(doc, template, sectionId);
  const schema = SECTION_SCHEMAS[section.type];
  let fields: SettingField[] = schema.settings;
  let blockIndex = -1;
  if (blockId) {
    blockIndex = getBlockIndex(section, blockId);
    fields = schema.blocks?.find((b) => b.type === section.blocks[blockIndex].type)?.settings ?? [];
  }
  const field = fields.find((f) => "id" in f && f.id === key);
  if (!field) throw new ThemeOpError("Réglage inconnu.");
  return { section, blockIndex, field };
}

function writeSetting(doc: ThemeDocument, template: TemplateKey, section: SectionInstance, blockIndex: number, key: string, value: SettingValue): ThemeDocument {
  if (blockIndex < 0) return withSection(doc, template, { ...section, settings: { ...section.settings, [key]: value } });
  const blocks = section.blocks.slice();
  blocks[blockIndex] = { ...blocks[blockIndex], settings: { ...blocks[blockIndex].settings, [key]: value } };
  return withSection(doc, template, { ...section, blocks });
}

/**
 * Lie un réglage à une source dynamique (`product.title`, `product.metafields.custom.matiere`…). Contrôles ici :
 * grammaire fermée et type de champ compatible (DYNAMIC_SOURCE_FIELD_TYPES). La compatibilité fine (type du champ
 * personnalisé, `storefrontVisible`) est vérifiée par `checkBinding` (dynamic-sources.ts), côté éditeur et serveur.
 */
export function bindDynamicSource(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string | null | undefined, key: string, source: string): ThemeDocument {
  const { section, blockIndex, field } = settingFieldOf(doc, template, sectionId, blockId, key);
  if (!DYNAMIC_TYPES.has(field.type)) throw new ThemeOpError("Ce réglage ne peut pas être connecté à une donnée.");
  if (typeof source !== "string" || source.length > 120 || !DYNAMIC_SOURCE_RE.test(source)) throw new ThemeOpError("Source dynamique invalide.");
  return writeSetting(doc, template, section, blockIndex, key, { $source: source });
}

/** Retire la liaison : le réglage reprend sa valeur par défaut. Sans liaison : document inchangé. */
export function unbindDynamicSource(doc: ThemeDocument, template: TemplateKey, sectionId: string, blockId: string | null | undefined, key: string): ThemeDocument {
  const { section, blockIndex, field } = settingFieldOf(doc, template, sectionId, blockId, key);
  const current = blockIndex < 0 ? section.settings[key] : section.blocks[blockIndex].settings[key];
  if (!current || typeof current !== "object" || !("$source" in current)) return doc;
  const def = defaultsFor([field])[key];
  return writeSetting(doc, template, section, blockIndex, key, def === undefined ? null : def);
}

/* ───────────── Lot 4 : modèles alternatifs ───────────── */

function cloneTemplateWithNewIds(t: Template, nextId: IdFactory): Template {
  const order: string[] = [];
  const sections: Record<string, SectionInstance> = {};
  for (const sid of t.order) {
    const s = t.sections[sid];
    if (!s) continue;
    const copy: SectionInstance = structuredClone(s);
    copy.id = nextId(s.type);
    copy.blocks = copy.blocks.map((b) => ({ ...b, id: nextId(b.type) }));
    sections[copy.id] = copy;
    order.push(copy.id);
  }
  return { order, sections };
}

function checkAlternate(doc: ThemeDocument, type: AlternateTemplateType, suffix: string, perTypeLimit?: number | null) {
  const check = canAddAlternate(doc, type, suffix, { perTypeLimit });
  if (!check.ok) throw new ThemeOpError(check.reason);
}

/** Crée `alternates[type][suffix]` à partir des sections par défaut du type (`fallbackTemplate`), ids neufs. */
export function addAlternate(doc: ThemeDocument, type: AlternateTemplateType, suffix: string, opts: { perTypeLimit?: number | null; ids?: IdFactory } = {}): { doc: ThemeDocument; key: TemplateKey } {
  checkAlternate(doc, type, suffix, opts.perTypeLimit);
  const tpl = fallbackTemplate(type, opts.ids ?? uniqueIdFactory(doc));
  return { doc: withTemplate(doc, `${type}:${suffix}`, tpl), key: `${type}:${suffix}` };
}

/** Duplique le modèle par défaut (`from = null`) ou un alternatif existant sous un nouveau suffixe (ids neufs). */
export function duplicateAlternate(
  doc: ThemeDocument,
  type: AlternateTemplateType,
  from: string | null,
  suffix: string,
  opts: { perTypeLimit?: number | null; ids?: IdFactory } = {},
): { doc: ThemeDocument; key: TemplateKey } {
  if (!isAlternateType(type)) throw new ThemeOpError("Ce type de page n'accepte pas de modèle alternatif.");
  const src = from == null ? doc.templates[type] : doc.alternates?.[type]?.[from];
  if (!src) throw new ThemeOpError("Modèle à dupliquer introuvable.");
  checkAlternate(doc, type, suffix, opts.perTypeLimit);
  const tpl = cloneTemplateWithNewIds(src, opts.ids ?? uniqueIdFactory(doc));
  return { doc: withTemplate(doc, `${type}:${suffix}`, tpl), key: `${type}:${suffix}` };
}

/**
 * Supprime un modèle alternatif. Les objets qui l'utilisaient retombent sur le modèle par défaut au rendu ;
 * l'action serveur remet leur `templateSuffix` à null (avec audit).
 */
export function removeAlternate(doc: ThemeDocument, type: AlternateTemplateType, suffix: string): ThemeDocument {
  if (!isAlternateType(type) || !doc.alternates?.[type]?.[suffix]) throw new ThemeOpError("Modèle alternatif introuvable.");
  const byType = { ...doc.alternates[type] };
  delete byType[suffix];
  const alternates = { ...doc.alternates };
  if (Object.keys(byType).length) alternates[type] = byType;
  else delete alternates[type];
  const next = { ...doc };
  if (Object.keys(alternates).length) next.alternates = alternates;
  else delete next.alternates;
  return next;
}

/** Renomme un modèle alternatif (l'action serveur met à jour les `templateSuffix` des objets liés). */
export function renameAlternate(doc: ThemeDocument, type: AlternateTemplateType, from: string, to: string): ThemeDocument {
  const src = isAlternateType(type) ? doc.alternates?.[type]?.[from] : undefined;
  if (!src) throw new ThemeOpError("Modèle alternatif introuvable.");
  if (from === to) return doc;
  if (!isAlternateSuffix(to)) throw new ThemeOpError("Nom de modèle : minuscules, chiffres et tirets (24 caractères maximum).");
  if (doc.alternates?.[type]?.[to]) throw new ThemeOpError("Un modèle porte déjà ce nom.");
  // Ordre d'insertion conservé : le modèle renommé garde sa place.
  const byType = Object.fromEntries(Object.entries(doc.alternates![type]!).map(([k, v]) => (k === from ? [to, v] : [k, v])));
  return { ...doc, alternates: { ...doc.alternates, [type]: byType } };
}

/* ───────────── Lot 4 : sections enregistrées ───────────── */

function stripMissingRefs(fields: SettingField[], settings: Settings, refs: ThemeRefs): Settings {
  const out = { ...settings };
  for (const f of fields) {
    if (!("id" in f)) continue;
    const v = out[f.id];
    if ((f.type === "collection" && typeof v === "string" && v && !refs.collectionIds.has(v)) || (f.type === "product" && typeof v === "string" && v && !refs.productIds.has(v))) out[f.id] = null;
    if (f.type === "product_list" && Array.isArray(v)) out[f.id] = v.filter((x) => refs.productIds.has(x));
    if (f.type === "menu" && refs.menuHandles && typeof v === "string" && v && !refs.menuHandles.has(v)) out[f.id] = "";
  }
  return out;
}

/**
 * Insère une section enregistrée (`SavedSection.payload` : SectionInstance sans id) ou un élément de bibliothèque.
 * La charge est revalidée défensivement (sanitize), reçoit des ids neufs, et ses références absentes de la boutique
 * (`refs`, chargées par le serveur) sont retirées. Contrôles d'ajout identiques à `addSection`.
 */
export function insertSavedSection(
  doc: ThemeDocument,
  template: TemplateKey,
  payload: unknown,
  opts: { index?: number; ids?: IdFactory; refs?: ThemeRefs } = {},
): { doc: ThemeDocument; id: string } {
  const clean = sanitizeSection(payload, "saved");
  if (!clean) throw new ThemeOpError("Section enregistrée illisible ou d'un type inconnu.");
  const check = canAddSection(doc, template, clean.type);
  if (!check.ok) throw new ThemeOpError(check.reason);
  const nextId = opts.ids ?? uniqueIdFactory(doc);
  const schema = SECTION_SCHEMAS[clean.type];
  const section: SectionInstance = {
    ...clean,
    id: nextId(clean.type),
    settings: opts.refs ? stripMissingRefs(schema.settings, clean.settings, opts.refs) : clean.settings,
    blocks: clean.blocks.map((b) => {
      const bs = schema.blocks?.find((x) => x.type === b.type);
      return { ...b, id: nextId(b.type), settings: opts.refs && bs ? stripMissingRefs(bs.settings, b.settings, opts.refs) : b.settings };
    }),
  };
  if (schema.required) {
    delete section.disabled;
    delete section.visibility;
  }
  const t = getTemplate(doc, template);
  if (section.visibility && Object.values(t.sections).filter((s) => s.visibility).length >= MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE) delete section.visibility;
  const order = t.order.slice();
  order.splice(clampIndex(opts.index ?? order.length, order.length), 0, section.id);
  return { doc: withTemplate(doc, template, { order, sections: { ...t.sections, [section.id]: section } }), id: section.id };
}

/* ───────────── Lot 4 : liste sérialisable d'opérations (IA, scores, éditeur, MCP) ───────────── */

/**
 * Chemins de réglages globaux modifiables par `updateGlobalSetting` dans `applyOperations` (liste blanche).
 * Tout autre chemin (`__proto__`, `colors`, clé inventée…) est refusé.
 */
export const GLOBAL_SETTING_PATHS: readonly string[] = [
  ...["background", "surface", "text", "muted", "primary", "primaryText", "accent", "border", "schemes"].map((k) => `colors.${k}`),
  ...["heading", "body", "headingWeight", "scale", "uppercaseButtons"].map((k) => `typography.${k}`),
  ...["radius", "style", "shadow"].map((k) => `buttons.${k}`),
  ...["radius", "imageRatio", "showVendor", "showSecondImage", "quickAdd", "border", "showFavorite", "saleBadge", "style", "showNewBadge"].map((k) => `cards.${k}`),
  ...["pageWidth", "sectionSpacing", "gutter"].map((k) => `layout.${k}`),
  ...["logo", "logoWidth", "layout", "sticky", "menu", "showSearch", "showAccount", "showCurrencyPicker"].map((k) => `header.${k}`),
  ...["enabled", "text", "link", "scheme"].map((k) => `header.announcement.${k}`),
  ...["menus", "showSocial", "text", "showPaymentIcons", "newsletter"].map((k) => `footer.${k}`),
  ...["instagram", "facebook", "tiktok", "youtube", "whatsapp"].map((k) => `footer.social.${k}`),
  ...["gallery", "variantPicker", "stickyAddToCart", "showSku", "showStock", "showShareButtons"].map((k) => `product.${k}`),
  ...["type", "showNote", "freeShippingBar"].map((k) => `cart.${k}`),
  ...["favicon", "shareImage"].map((k) => `social.${k}`),
  ...["preset", "reveal", "parallax", "hoverZoom"].map((k) => `motion.${k}`),
];
const GLOBAL_PATH_SET = new Set(GLOBAL_SETTING_PATHS);

/** Union sérialisable (JSON) des opérations. `template` : TemplateKey (`"home"`, `"product:luxe"`). */
export type ThemeOperation =
  | { op: "addSection"; template: TemplateKey; type: SectionType; index?: number; presetIndex?: number }
  | { op: "duplicateSection"; template: TemplateKey; sectionId: string }
  | { op: "removeSection"; template: TemplateKey; sectionId: string }
  | { op: "moveSection"; template: TemplateKey; sectionId: string; index: number }
  | { op: "setSectionHidden"; template: TemplateKey; sectionId: string; hidden: boolean }
  | { op: "updateSectionSetting"; template: TemplateKey; sectionId: string; key: string; value: SettingValue }
  | { op: "resetSectionSettings"; template: TemplateKey; sectionId: string }
  | { op: "applySectionPreset"; template: TemplateKey; sectionId: string; presetIndex: number }
  | { op: "setSectionAnimation"; template: TemplateKey; sectionId: string; animation: SectionAnimation }
  | { op: "setSectionVisibility"; template: TemplateKey; sectionId: string; visibility: SectionVisibility | null }
  | { op: "addBlock"; template: TemplateKey; sectionId: string; type: string; index?: number }
  | { op: "duplicateBlock"; template: TemplateKey; sectionId: string; blockId: string }
  | { op: "removeBlock"; template: TemplateKey; sectionId: string; blockId: string }
  | { op: "moveBlock"; template: TemplateKey; sectionId: string; blockId: string; index: number }
  | { op: "setBlockHidden"; template: TemplateKey; sectionId: string; blockId: string; hidden: boolean }
  | { op: "updateBlockSetting"; template: TemplateKey; sectionId: string; blockId: string; key: string; value: SettingValue }
  | { op: "resetBlockSettings"; template: TemplateKey; sectionId: string; blockId: string }
  | { op: "bindDynamicSource"; template: TemplateKey; sectionId: string; blockId?: string | null; key: string; source: string }
  | { op: "unbindDynamicSource"; template: TemplateKey; sectionId: string; blockId?: string | null; key: string }
  | { op: "updateGlobalSetting"; path: string; value: unknown }
  | { op: "addAlternate"; type: AlternateTemplateType; suffix: string }
  | { op: "duplicateAlternate"; type: AlternateTemplateType; from: string | null; suffix: string }
  | { op: "removeAlternate"; type: AlternateTemplateType; suffix: string }
  | { op: "renameAlternate"; type: AlternateTemplateType; from: string; to: string }
  | { op: "insertSavedSection"; template: TemplateKey; section: unknown; index?: number };

export type ThemeOperationName = ThemeOperation["op"];

export const THEME_OPERATION_NAMES = [
  "addSection", "duplicateSection", "removeSection", "moveSection", "setSectionHidden", "updateSectionSetting", "resetSectionSettings", "applySectionPreset",
  "setSectionAnimation", "setSectionVisibility", "addBlock", "duplicateBlock", "removeBlock", "moveBlock", "setBlockHidden", "updateBlockSetting",
  "resetBlockSettings", "bindDynamicSource", "unbindDynamicSource", "updateGlobalSetting", "addAlternate", "duplicateAlternate", "removeAlternate",
  "renameAlternate", "insertSavedSection",
] as const satisfies readonly ThemeOperationName[];
const OP_NAMES = new Set<string>(THEME_OPERATION_NAMES);

/** Opérations destructrices : le MCP et l'IA demandent une confirmation (§21). */
export const DESTRUCTIVE_OPERATIONS: readonly ThemeOperationName[] = ["removeSection", "removeBlock", "removeAlternate", "resetSectionSettings", "resetBlockSettings", "applySectionPreset"];

export function isThemeOperationName(v: unknown): v is ThemeOperationName {
  return typeof v === "string" && OP_NAMES.has(v);
}

export type ApplyOptions = {
  ids?: IdFactory;
  /** Plafond du nombre d'opérations (MCP : 20). Défaut 100. */
  maxOps?: number;
  /** Opérations autorisées (sous-ensemble de la liste blanche, ex. scores sans suppression). */
  allow?: readonly ThemeOperationName[];
  /** Revalidation stricte du document final (défaut true). */
  validate?: boolean;
  /** Références de la boutique (collections, produits, menus) : vérifiées à la revalidation et retirées des sections insérées. */
  refs?: ThemeRefs;
  /** Limite du plan pour `addAlternate` / `duplicateAlternate` (`limits.alternateTemplatesPerType`, `null` = illimité). */
  alternatesPerType?: number | null;
};

export type ApplyResult =
  | { ok: true; doc: ThemeDocument; created: string[] }
  | { ok: false; error: string; index: number; issues?: ValidationIssue[] };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function idArg(v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new ThemeOpError("Identifiant invalide.");
  return v;
}

function keyArg(v: unknown): TemplateKey {
  if (!parseTemplateKey(v)) throw new ThemeOpError("Modèle de page introuvable.");
  return v as TemplateKey;
}

function intArg(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1000) throw new ThemeOpError("Position invalide.");
  return v;
}

function blockArg(v: unknown): string | null {
  return v == null ? null : idArg(v);
}

function altTypeArg(v: unknown): AlternateTemplateType {
  if (!isAlternateType(v)) throw new ThemeOpError("Ce type de page n'accepte pas de modèle alternatif.");
  return v;
}

function suffixArg(v: unknown): string {
  if (!isAlternateSuffix(v)) throw new ThemeOpError("Nom de modèle : minuscules, chiffres et tirets (24 caractères maximum).");
  return v;
}

function setGlobal(doc: ThemeDocument, path: unknown, value: unknown): ThemeDocument {
  if (typeof path !== "string" || !GLOBAL_PATH_SET.has(path)) throw new ThemeOpError("Réglage global non modifiable.");
  // `motion` est facultatif (documents antérieurs) : matérialisé avec les valeurs par défaut avant écriture.
  const base = path.startsWith("motion.") && !doc.settings.motion ? { ...doc, settings: { ...doc.settings, motion: { ...DEFAULT_MOTION } } } : doc;
  return updateGlobalSetting(base, path, value);
}

/** Applique UNE opération (forme non fiable : chaque champ est revérifié). */
function applyOne(doc: ThemeDocument, o: Record<string, unknown>, opts: ApplyOptions, nextId: IdFactory, created: string[]): ThemeDocument {
  switch (o.op as ThemeOperationName) {
    case "addSection": {
      if (typeof o.type !== "string" || !Object.prototype.hasOwnProperty.call(SECTION_SCHEMAS, o.type)) throw new ThemeOpError("Type de section inconnu.");
      const r = addSection(doc, keyArg(o.template), o.type as SectionType, { index: o.index == null ? undefined : intArg(o.index), presetIndex: o.presetIndex == null ? 0 : intArg(o.presetIndex), ids: nextId });
      created.push(r.id);
      return r.doc;
    }
    case "duplicateSection": {
      const r = duplicateSection(doc, keyArg(o.template), idArg(o.sectionId), nextId);
      created.push(r.id);
      return r.doc;
    }
    case "removeSection":
      return removeSection(doc, keyArg(o.template), idArg(o.sectionId));
    case "moveSection":
      return moveSection(doc, keyArg(o.template), idArg(o.sectionId), intArg(o.index));
    case "setSectionHidden":
      return setSectionHidden(doc, keyArg(o.template), idArg(o.sectionId), o.hidden === true);
    case "updateSectionSetting":
      return updateSectionSetting(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.key), o.value as SettingValue);
    case "resetSectionSettings":
      return resetSectionSettings(doc, keyArg(o.template), idArg(o.sectionId));
    case "applySectionPreset":
      return applySectionPreset(doc, keyArg(o.template), idArg(o.sectionId), intArg(o.presetIndex), nextId);
    case "setSectionAnimation":
      return setSectionAnimation(doc, keyArg(o.template), idArg(o.sectionId), o.animation as SectionAnimation);
    case "setSectionVisibility":
      return setSectionVisibility(doc, keyArg(o.template), idArg(o.sectionId), (o.visibility ?? null) as SectionVisibility | null);
    case "addBlock": {
      const r = addBlock(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.type), { index: o.index == null ? undefined : intArg(o.index), ids: nextId });
      created.push(r.id);
      return r.doc;
    }
    case "duplicateBlock": {
      const r = duplicateBlock(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.blockId), nextId);
      created.push(r.id);
      return r.doc;
    }
    case "removeBlock":
      return removeBlock(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.blockId));
    case "moveBlock":
      return moveBlock(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.blockId), intArg(o.index));
    case "setBlockHidden":
      return setBlockHidden(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.blockId), o.hidden === true);
    case "updateBlockSetting":
      return updateBlockSetting(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.blockId), idArg(o.key), o.value as SettingValue);
    case "resetBlockSettings":
      return resetBlockSettings(doc, keyArg(o.template), idArg(o.sectionId), idArg(o.blockId));
    case "bindDynamicSource":
      return bindDynamicSource(doc, keyArg(o.template), idArg(o.sectionId), blockArg(o.blockId), idArg(o.key), o.source as string);
    case "unbindDynamicSource":
      return unbindDynamicSource(doc, keyArg(o.template), idArg(o.sectionId), blockArg(o.blockId), idArg(o.key));
    case "updateGlobalSetting":
      return setGlobal(doc, o.path, o.value);
    case "addAlternate": {
      const r = addAlternate(doc, altTypeArg(o.type), suffixArg(o.suffix), { perTypeLimit: opts.alternatesPerType, ids: nextId });
      created.push(r.key);
      return r.doc;
    }
    case "duplicateAlternate": {
      const r = duplicateAlternate(doc, altTypeArg(o.type), o.from == null ? null : suffixArg(o.from), suffixArg(o.suffix), { perTypeLimit: opts.alternatesPerType, ids: nextId });
      created.push(r.key);
      return r.doc;
    }
    case "removeAlternate":
      return removeAlternate(doc, altTypeArg(o.type), suffixArg(o.suffix));
    case "renameAlternate":
      return renameAlternate(doc, altTypeArg(o.type), suffixArg(o.from), suffixArg(o.to));
    case "insertSavedSection": {
      const r = insertSavedSection(doc, keyArg(o.template), o.section, { index: o.index == null ? undefined : intArg(o.index), ids: nextId, refs: opts.refs });
      created.push(r.id);
      return r.doc;
    }
    default:
      throw new ThemeOpError("Opération inconnue.");
  }
}

/**
 * Applique une liste d'opérations de façon ATOMIQUE : toutes ou aucune. En cas d'échec, `{ ok: false, index, error }`
 * et le document d'origine n'est pas modifié (aucune mutation). Par défaut, le document final est revalidé
 * (`validateThemeDocument`, avec `refs` si fournies) : une valeur hors schéma fait échouer l'ensemble.
 * Entrée non fiable acceptée (IA, MCP) : opérations hors liste blanche refusées.
 * Annulation côté éditeur : conserver le document d'avant dans l'historique (`pushHistory`), l'opération étant pure.
 */
export function applyOperations(doc: ThemeDocument, ops: unknown, opts: ApplyOptions = {}): ApplyResult {
  if (!Array.isArray(ops)) return { ok: false, error: "Liste d'opérations attendue.", index: -1 };
  const max = opts.maxOps ?? 100;
  if (ops.length > max) return { ok: false, error: `${max} opérations maximum.`, index: max };
  const allow = opts.allow ? new Set<string>(opts.allow) : null;
  const created: string[] = [];
  const nextId = opts.ids ?? uniqueIdFactory(doc);
  let cur = doc;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as Record<string, unknown> | null;
    if (!op || typeof op !== "object" || Array.isArray(op) || !isThemeOperationName(op.op)) return { ok: false, error: "Opération inconnue.", index: i };
    if (allow && !allow.has(op.op)) return { ok: false, error: "Opération non autorisée ici.", index: i };
    try {
      cur = applyOne(cur, op, opts, nextId, created);
    } catch (e) {
      return { ok: false, error: e instanceof ThemeOpError ? e.message : "Opération impossible.", index: i };
    }
  }
  if (opts.validate === false) return { ok: true, doc: cur, created };
  const v = validateThemeDocument(cur, { refs: opts.refs });
  if (!v.ok) return { ok: false, error: v.errors[0]?.message ?? "Document invalide.", index: ops.length, issues: v.errors };
  return { ok: true, doc: v.doc, created };
}
