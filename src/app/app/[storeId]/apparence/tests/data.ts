import "server-only";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { allTemplates } from "@/lib/theme-engine/alternates";
import { EDITABLE_TEMPLATES } from "@/lib/theme-engine/editor-defaults";
import type { SectionInstance, SettingField, ThemeDocument } from "@/lib/theme-engine/types";

/**
 * Lot 4 §13 : sections testables du thème PUBLIÉ, avec les champs de texte qu'une variante peut modifier.
 *
 * Volontairement limité aux champs texte, lien et bouton : c'est ce qu'on teste utilement (titre, promesse, libellé
 * d'appel à l'action), et cela interdit par construction qu'une variante touche un prix, un stock ou une donnée
 * client. La variante complète est reconstruite à partir de la section d'origine, puis revalidée par le moteur.
 */

export type VariantFieldDTO = { path: string; label: string; value: string; multiline: boolean };

export type SectionOptionDTO = {
  templateKey: string;
  templateLabel: string;
  sectionId: string;
  sectionName: string;
  fields: VariantFieldDTO[];
  /** Section obligatoire du modèle : la variante « masquée » n'est pas proposée. */
  required: boolean;
  /** Un test vivant occupe déjà cette section. */
  busy: boolean;
  /** Section d'origine (base de la variante, renvoyée telle quelle au serveur qui la revalide). */
  section: SectionInstance;
};

const TEXT_TYPES = new Set(["text", "textarea", "richtext", "url"]);
const MAX_FIELDS = 12;

function textFields(fields: readonly SettingField[], settings: Record<string, unknown>, prefix: string): VariantFieldDTO[] {
  const out: VariantFieldDTO[] = [];
  for (const f of fields) {
    if (!("id" in f) || !TEXT_TYPES.has(f.type)) continue;
    const raw = settings[f.id];
    if (raw !== undefined && typeof raw !== "string") continue; // source dynamique : non modifiable ici
    out.push({ path: `${prefix}${f.id}`, label: f.label, value: typeof raw === "string" ? raw : "", multiline: f.type === "textarea" || f.type === "richtext" });
  }
  return out;
}

const templateLabel = (base: string) => EDITABLE_TEMPLATES.find((t) => t.id === base)?.label ?? base;

export function sectionOptions(doc: ThemeDocument, busyKeys: Set<string>): SectionOptionDTO[] {
  const out: SectionOptionDTO[] = [];
  for (const { key, base, template } of allTemplates(doc)) {
    const suffix = key === base ? "" : ` · ${String(key).split(":")[1]}`;
    for (const sectionId of template.order) {
      const section = template.sections[sectionId];
      const schema = section ? SECTION_SCHEMAS[section.type] : null;
      if (!section || !schema || section.disabled) continue;
      const fields = textFields(schema.settings, section.settings as Record<string, unknown>, "s:");
      for (const block of section.blocks) {
        const bs = schema.blocks?.find((b) => b.type === block.type);
        if (!bs) continue;
        fields.push(...textFields(bs.settings, block.settings as Record<string, unknown>, `b:${block.id}:`));
      }
      out.push({
        templateKey: String(key),
        templateLabel: `${templateLabel(base)}${suffix}`,
        sectionId,
        sectionName: schema.name,
        fields: fields.slice(0, MAX_FIELDS),
        required: !!schema.required,
        busy: busyKeys.has(`${String(key)}|${sectionId}`),
        section,
      });
    }
  }
  return out;
}
