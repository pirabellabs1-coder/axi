/**
 * Lot 4 §8 : contrôle d'une valeur reçue de l'aperçu (module PUR, testé : tests/preview-messages-inline.test.ts).
 * L'aperçu propose, l'éditeur décide : type du champ, longueur maximale du schéma, source dynamique.
 */
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { isDynamicSource, type SettingField, type TemplateId, type ThemeDocument } from "@/lib/theme-engine/types";
import type { InlineTarget } from "@/lib/theme-engine/preview-messages";

export type InlineCheck = { ok: true; value: string; field: SettingField } | { ok: false; message: string };

function fieldsOf(doc: ThemeDocument, template: TemplateId, target: InlineTarget): { fields: SettingField[]; settings: Record<string, unknown> } | null {
  const section = doc.templates[template]?.sections[target.sectionId];
  if (!section) return null;
  const schema = SECTION_SCHEMAS[section.type];
  if (!schema) return null;
  if (!target.blockId) return { fields: schema.settings, settings: section.settings };
  const block = section.blocks.find((b) => b.id === target.blockId);
  if (!block) return null;
  const bs = schema.blocks?.find((x) => x.type === block.type);
  return bs ? { fields: bs.settings, settings: block.settings } : null;
}

export function checkInlineValue(doc: ThemeDocument, template: TemplateId, target: InlineTarget, value: string): InlineCheck {
  const found = fieldsOf(doc, template, target);
  if (!found) return { ok: false, message: "Cette section n'existe plus. Rechargez l'aperçu." };
  const field = found.fields.find((f) => "id" in f && f.id === target.settingId);
  if (!field) return { ok: false, message: "Ce texte n'est pas modifiable ici." };
  if (field.type !== "text" && field.type !== "textarea") return { ok: false, message: "Modifiez ce contenu dans le panneau « Réglages »." };
  if (isDynamicSource(found.settings[target.settingId])) return { ok: false, message: "Donnée du produit : modifiez le produit pour changer ce texte." };
  const max = typeof field.maxLength === "number" ? field.maxLength : field.type === "text" ? 200 : 2000;
  const clean = value.replace(/[\r\n]+/g, field.type === "text" ? " " : "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (clean.length > max) return { ok: false, message: `${max} caractères maximum pour « ${field.label} ».` };
  return { ok: true, value: clean, field };
}
