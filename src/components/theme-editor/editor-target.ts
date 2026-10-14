/**
 * Cible d'édition de l'éditeur (module pur, testé : tests/theme-editor-lot4.test.ts).
 *
 * L'éditeur édite un modèle par défaut (`product`) ou un modèle alternatif (`product:luxe`, lot 4 §6) :
 *  - les opérations du moteur reçoivent la clé de modèle (`targetKey`) ;
 *  - l'arbre, l'inspecteur et l'aperçu reçoivent une « vue » du document où `templates[type]` est le modèle édité
 *    (`projectTarget`) : ils lisent `doc.templates[template]` sans connaître les alternatifs, et l'aperçu affiche le
 *    modèle alternatif même pour un produit exemple qui ne l'utilise pas encore.
 */
import { canAddAlternate, normalizeSuffix, templateKey, type TemplateKey } from "@/lib/theme-engine/alternates";
import { ALTERNATE_TEMPLATE_TYPES, type AlternateTemplateType, type TemplateId, type ThemeDocument } from "@/lib/theme-engine/types";

export type EditTarget = { template: TemplateId; alternate: string | null };

export const ALTERNATE_TYPE_LABELS: Record<AlternateTemplateType, string> = {
  product: "Produit",
  collection: "Collection",
  page: "Page",
  article: "Article",
};

export function isAlternateType(t: TemplateId): t is AlternateTemplateType {
  return (ALTERNATE_TEMPLATE_TYPES as readonly string[]).includes(t);
}

/** Clé de modèle des opérations du moteur : `"product"` ou `"product:luxe"`. */
export function targetKey(target: EditTarget): TemplateKey {
  return target.alternate && isAlternateType(target.template) ? templateKey(target.template, target.alternate) : target.template;
}

/** Valeur du sélecteur de modèle (`"product"` ou `"product:luxe"`) → cible. */
export function parseTargetValue(v: string): EditTarget {
  const i = v.indexOf(":");
  return i < 0 ? { template: v as TemplateId, alternate: null } : { template: v.slice(0, i) as TemplateId, alternate: v.slice(i + 1) };
}

/** Suffixes d'un type, dans l'ordre de création. */
export function alternateSuffixes(doc: ThemeDocument, type: TemplateId): string[] {
  if (!isAlternateType(type)) return [];
  return Object.keys(doc.alternates?.[type] ?? {});
}

/** Cible valide dans ce document (modèle alternatif supprimé, par exemple par « annuler » → retour au défaut). */
export function normalizeTarget(doc: ThemeDocument, target: EditTarget): EditTarget {
  if (target.alternate && (!isAlternateType(target.template) || !doc.alternates?.[target.template]?.[target.alternate])) return { template: target.template, alternate: null };
  return target;
}

/** Vue du document où `templates[type]` est le modèle édité (même objet pour le modèle par défaut). */
export function projectTarget(doc: ThemeDocument, target: EditTarget): ThemeDocument {
  if (!target.alternate || !isAlternateType(target.template)) return doc;
  const alt = doc.alternates?.[target.template]?.[target.alternate];
  if (!alt) return doc;
  return { ...doc, templates: { ...doc.templates, [target.template]: alt } };
}

/** « Produit · Luxe été » → « luxe-ete » ; « » si rien d'exploitable. */
export function suffixFromName(name: string): string {
  return normalizeSuffix(name) ?? "";
}

/** Limite du plan : `alternateTemplatesPerType` (0 = non inclus, null = illimité). */
export type AlternateLimit = { perType: number | null; reason?: string };

/** Peut-on encore créer un modèle de ce type ? (pré-contrôle de l'interface ; le serveur revérifie). */
export function canCreateAlternate(doc: ThemeDocument, type: AlternateTemplateType, limit: AlternateLimit): { ok: true } | { ok: false; reason: string } {
  if (limit.perType === 0) return { ok: false, reason: limit.reason ?? "Les modèles alternatifs sont inclus à partir du plan Business." };
  // Suffixe fictif valide et libre : seules les limites sont testées ici.
  let probe = "nouveau";
  for (let i = 2; doc.alternates?.[type]?.[probe]; i++) probe = `nouveau-${i}`;
  return canAddAlternate(doc, type, probe, { perTypeLimit: limit.perType });
}

/** Message d'erreur du nom saisi, ou null. */
export function checkSuffix(doc: ThemeDocument, type: AlternateTemplateType, suffix: string): string | null {
  if (!suffix) return "Donnez un nom au modèle (lettres ou chiffres).";
  if (doc.alternates?.[type]?.[suffix]) return "Un modèle de ce type porte déjà ce nom.";
  const r = canAddAlternate({ ...doc, alternates: {} }, type, suffix);
  return r.ok ? null : r.reason;
}
