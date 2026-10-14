import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { sanitizeFieldValue } from "@/lib/storefront/theme-doc";
import type { BlockInstance, SectionInstance, SettingField, Template, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { isDynamicSource } from "@/lib/theme-engine/types";

/**
 * Traduction du document de thème (lot 2 §1.1, ressource `THEME`). Module PUR : aucune base, aucun réseau.
 *
 * Règles (sécurité et rendu) :
 *  - SEULS les champs `text`, `textarea`, `richtext` des réglages de sections et de blocs sont traduisibles,
 *    plus `settings.header.announcement.text` et `settings.footer.text` ;
 *  - une valeur traduite ne remplace QUE une chaîne : URL, couleurs, identifiants, images, nombres, cases à
 *    cocher et sources dynamiques (`{ $source }`) ne sont jamais touchés ;
 *  - toute valeur traduite repasse par `sanitizeFieldValue` (même validation que le document d'origine) :
 *    une traduction trop longue est tronquée, une valeur non conforme est ignorée (source conservée) ;
 *  - fonction totale : un chemin inconnu, une section supprimée ou un champ devenu non textuel sont ignorés.
 */

const TEXT_FIELD_TYPES = new Set(["text", "textarea", "richtext"]);

/** Champs globaux traduisibles, avec leur validation. */
const GLOBAL_TEXT_FIELDS: { path: string; label: string; field: SettingField }[] = [
  { path: "settings.header.announcement.text", label: "Bandeau d'annonce", field: { type: "text", id: "text", label: "Bandeau d'annonce", maxLength: 200 } },
  { path: "settings.footer.text", label: "Texte du pied de page", field: { type: "textarea", id: "text", label: "Texte du pied de page", maxLength: 600 } },
];

export type ThemeTextField = {
  /** Chemin stocké dans `Translation.field`. */
  path: string;
  /** Libellé pour l'écran marchand (français). */
  label: string;
  /** Texte source actuel. */
  value: string;
  kind: "text" | "textarea" | "richtext";
};

function fieldOf(section: SectionInstance, block: BlockInstance | null, key: string): SettingField | undefined {
  const schema = SECTION_SCHEMAS[section.type];
  if (!schema) return undefined;
  const fields = block ? schema.blocks?.find((b) => b.type === block.type)?.settings : schema.settings;
  return fields?.find((f) => "id" in f && f.id === key);
}

function collectSettings(prefix: string, section: SectionInstance, block: BlockInstance | null, sectionName: string, out: ThemeTextField[]) {
  const target = block ?? section;
  for (const [key, value] of Object.entries(target.settings)) {
    if (typeof value !== "string" || !value.trim() || isDynamicSource(value)) continue;
    const field = fieldOf(section, block, key);
    if (!field || !("id" in field) || !TEXT_FIELD_TYPES.has(field.type)) continue;
    out.push({ path: `${prefix}.settings.${key}`, label: `${sectionName} · ${field.label}`, value, kind: field.type as ThemeTextField["kind"] });
  }
}

/** Champs textuels traduisibles du document publié, dans l'ordre des modèles (écran marchand et traduction IA). */
export function themeTextFields(doc: ThemeDocument): ThemeTextField[] {
  const out: ThemeTextField[] = [];
  for (const { path, label, field } of GLOBAL_TEXT_FIELDS) {
    const value = readGlobal(doc, path);
    if (typeof value === "string" && value.trim()) out.push({ path, label, value, kind: field.type as ThemeTextField["kind"] });
  }
  for (const [tid, template] of Object.entries(doc.templates ?? {}) as [TemplateId, Template][]) {
    if (!template?.sections) continue;
    for (const sid of template.order ?? Object.keys(template.sections)) {
      const section = template.sections[sid];
      if (!section) continue;
      const name = SECTION_SCHEMAS[section.type]?.name ?? section.type;
      const prefix = `templates.${tid}.sections.${sid}`;
      collectSettings(prefix, section, null, name, out);
      for (const block of section.blocks ?? []) collectSettings(`${prefix}.blocks.${block.id}`, section, block, name, out);
    }
  }
  return out;
}

function readGlobal(doc: ThemeDocument, path: string): unknown {
  if (path === "settings.header.announcement.text") return doc.settings?.header?.announcement?.text;
  if (path === "settings.footer.text") return doc.settings?.footer?.text;
  return undefined;
}

/** Chemin de réglage de section → parties utiles, ou null si le chemin n'a pas la forme attendue. */
function parseSectionPath(path: string): { template: string; section: string; block: string | null; key: string } | null {
  const parts = path.split(".");
  if (parts[0] !== "templates" || parts[2] !== "sections") return null;
  if (parts.length === 6 && parts[4] === "settings") return { template: parts[1]!, section: parts[3]!, block: null, key: parts[5]! };
  if (parts.length === 8 && parts[4] === "blocks" && parts[6] === "settings") return { template: parts[1]!, section: parts[3]!, block: parts[5]!, key: parts[7]! };
  return null;
}

/**
 * Applique les traductions (chemin → texte) à un document de thème et renvoie un NOUVEAU document.
 * Le document d'entrée n'est jamais modifié ; seules les chaînes des champs textuels sont remplacées.
 */
export function localizeThemeDocument(doc: ThemeDocument, translations: Record<string, string>): ThemeDocument {
  const entries = Object.entries(translations).filter(([, v]) => typeof v === "string" && v.trim() !== "");
  if (entries.length === 0) return doc;

  let settings = doc.settings;
  const templates: Record<string, Template> = { ...(doc.templates ?? {}) };
  const touchedTemplates = new Set<string>();

  for (const [path, raw] of entries) {
    /* Réglages globaux (bandeau d'annonce, pied de page) */
    const global = GLOBAL_TEXT_FIELDS.find((g) => g.path === path);
    if (global) {
      const current = readGlobal(doc, path);
      if (typeof current !== "string") continue; // champ absent du document : rien à traduire
      const value = sanitizeFieldValue(global.field, raw);
      if (typeof value !== "string" || !value.trim()) continue;
      if (path === "settings.header.announcement.text") {
        settings = { ...settings, header: { ...settings.header, announcement: { ...settings.header.announcement, text: value } } };
      } else {
        settings = { ...settings, footer: { ...settings.footer, text: value } };
      }
      continue;
    }

    /* Réglages de sections et de blocs */
    const parsed = parseSectionPath(path);
    if (!parsed) continue;
    const template = templates[parsed.template];
    const section = template?.sections?.[parsed.section];
    if (!template || !section) continue;

    const block = parsed.block ? (section.blocks ?? []).find((b) => b.id === parsed.block) ?? null : null;
    if (parsed.block && !block) continue;
    const holder = block ?? section;
    const current = holder.settings[parsed.key];
    // On ne remplace QUE une chaîne existante (jamais une URL, une couleur, une image ou une source dynamique).
    if (typeof current !== "string" || isDynamicSource(current)) continue;
    const field = fieldOf(section, block, parsed.key);
    if (!field || !("id" in field) || !TEXT_FIELD_TYPES.has(field.type)) continue;
    const value = sanitizeFieldValue(field, raw);
    if (typeof value !== "string" || !value.trim()) continue;

    const nextSection: SectionInstance = block
      ? { ...section, blocks: (section.blocks ?? []).map((b) => (b.id === block.id ? { ...b, settings: { ...b.settings, [parsed.key]: value } } : b)) }
      : { ...section, settings: { ...section.settings, [parsed.key]: value } };
    templates[parsed.template] = { ...template, sections: { ...template.sections, [parsed.section]: nextSection } };
    touchedTemplates.add(parsed.template);
  }

  if (settings === doc.settings && touchedTemplates.size === 0) return doc;
  return { ...doc, settings, templates: templates as ThemeDocument["templates"] };
}
