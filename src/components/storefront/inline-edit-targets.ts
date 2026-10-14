/**
 * Lot 4 §8 : repérage des réglages éditables EN PLACE dans l'aperçu (module pur, testé).
 *
 * Les composants de section n'ont pas à être modifiés : à partir du document et de `SECTION_SCHEMAS`,
 * on connaît la liste des réglages texte / image d'une section ; `inline-edit.tsx` retrouve ensuite
 * l'élément du DOM qui affiche cette valeur et y pose les attributs `data-edit` de `editAttrs`
 * (donc UNIQUEMENT en aperçu, jamais dans le HTML public).
 */
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { isDynamicSource, type SectionInstance, type SettingField, type Settings } from "@/lib/theme-engine/types";
import type { EditKind } from "@/lib/theme-engine/edit-attrs";

export type InlineFieldTarget = {
  sectionId: string;
  blockId: string | null;
  settingId: string;
  kind: EditKind;
  /** Valeur affichée (texte) — sert à retrouver l'élément du DOM. */
  value: string;
  /** Liée à une source dynamique : non éditable en place (bulle d'explication). */
  dynamic: boolean;
  label: string;
  maxLength: number | null;
};

const TEXT_KINDS: Record<string, EditKind> = { text: "text", textarea: "textarea", richtext: "richtext" };

function fieldValue(settings: Settings, f: SettingField): { value: string; dynamic: boolean } | null {
  if (!("id" in f)) return null;
  const raw = settings[f.id];
  if (isDynamicSource(raw)) return { value: "", dynamic: true };
  if (typeof raw !== "string") {
    const def = "default" in f && typeof f.default === "string" ? f.default : "";
    return def ? { value: def, dynamic: false } : null;
  }
  return raw.trim() ? { value: raw, dynamic: false } : null;
}

/** Réglages texte éditables d'une section (réglages de la section puis des blocs actifs, dans l'ordre d'affichage). */
export function inlineTextTargets(section: SectionInstance): InlineFieldTarget[] {
  const schema = SECTION_SCHEMAS[section.type];
  if (!schema) return [];
  const out: InlineFieldTarget[] = [];
  const push = (blockId: string | null, settings: Settings, fields: SettingField[]) => {
    for (const f of fields) {
      const kind = TEXT_KINDS[f.type];
      const field = f as Extract<SettingField, { id: string }> & { maxLength?: number };
      if (!kind || !("id" in f)) continue;
      const v = fieldValue(settings, f);
      if (!v) continue;
      out.push({
        sectionId: section.id,
        blockId,
        settingId: field.id,
        kind,
        value: v.value,
        dynamic: v.dynamic,
        label: field.label ?? field.id,
        maxLength: typeof field.maxLength === "number" ? field.maxLength : null,
      });
    }
  };
  push(null, section.settings, schema.settings);
  for (const b of section.blocks) {
    if (b.disabled) continue;
    const bs = schema.blocks?.find((x) => x.type === b.type);
    if (bs) push(b.id, b.settings, bs.settings);
  }
  return out;
}

/**
 * Cible d'un dépôt d'image sur la section : premier réglage `image` de la section, sinon du premier bloc
 * qui en possède un. `null` si la section n'accepte aucune image.
 */
export function inlineImageTarget(section: SectionInstance): InlineFieldTarget | null {
  const schema = SECTION_SCHEMAS[section.type];
  if (!schema) return null;
  const sectionField = schema.settings.find((f) => f.type === "image");
  if (sectionField && "id" in sectionField) {
    return { sectionId: section.id, blockId: null, settingId: sectionField.id, kind: "image", value: "", dynamic: isDynamicSource(section.settings[sectionField.id]), label: sectionField.label, maxLength: null };
  }
  for (const b of section.blocks) {
    if (b.disabled) continue;
    const bs = schema.blocks?.find((x) => x.type === b.type);
    const f = bs?.settings.find((x) => x.type === "image");
    if (f && "id" in f) {
      return { sectionId: section.id, blockId: b.id, settingId: f.id, kind: "image", value: "", dynamic: isDynamicSource(b.settings[f.id]), label: f.label, maxLength: null };
    }
  }
  return null;
}

/** Texte normalisé pour comparer une valeur de réglage au contenu d'un élément du DOM. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Markdown simple (richtext) ramené à du texte brut, pour la comparaison avec le DOM. */
export function plainFromMarkdown(s: string): string {
  return normalizeText(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`>#]/g, "")
      .replace(/^\s*[-+]\s+/gm, ""),
  );
}
