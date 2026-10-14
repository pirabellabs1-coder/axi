/**
 * Lot 4 §6 : modèles alternatifs (module PUR, client et serveur).
 *
 * Un modèle alternatif est un `Template` rangé dans `doc.alternates[type][suffixe]` (types : produit, collection, page,
 * article). Il est choisi par le `templateSuffix` de l'objet (Product, Category, StorePage, BlogPost) :
 * rendu = `alternates[type][suffix] ?? templates[type]` (suffixe inconnu ou supprimé : retour silencieux au défaut).
 *
 * Clé de modèle (`TemplateKey`) : `"product"` (modèle par défaut) ou `"product:luxe"` (alternatif). C'est la même
 * forme que `issueKey` (validate.ts) et que la cible des opérations (`operations.ts`) et des scores (`quality.ts`).
 */
import {
  ALTERNATE_SUFFIX_RE,
  ALTERNATE_TEMPLATE_TYPES,
  MAX_ALTERNATE_TEMPLATES,
  type AlternateTemplateType,
  type Template,
  type TemplateId,
  type ThemeDocument,
} from "./types";

export type AlternateKey = `${AlternateTemplateType}:${string}`;
export type TemplateKey = TemplateId | AlternateKey;

const TEMPLATE_ID_SET = new Set<string>(["home", "product", "collection", "catalog", "page", "cart", "search", "not_found", "blog", "article"]);

export function isAlternateType(v: unknown): v is AlternateTemplateType {
  return typeof v === "string" && (ALTERNATE_TEMPLATE_TYPES as readonly string[]).includes(v);
}

export function isAlternateSuffix(v: unknown): v is string {
  return typeof v === "string" && ALTERNATE_SUFFIX_RE.test(v);
}

/** `templateKey("product")` → `"product"` ; `templateKey("product", "luxe")` → `"product:luxe"`. */
export function templateKey(type: TemplateId, suffix?: string | null): TemplateKey {
  if (suffix == null || suffix === "") return type;
  if (!isAlternateType(type) || !isAlternateSuffix(suffix)) throw new Error("Modèle alternatif invalide.");
  return `${type}:${suffix}`;
}

/** Analyse défensive d'une clé de modèle ; `null` si invalide. */
export function parseTemplateKey(key: unknown): { base: TemplateId; suffix: string | null } | null {
  if (typeof key !== "string" || key.length > 64) return null;
  const i = key.indexOf(":");
  if (i < 0) return TEMPLATE_ID_SET.has(key) ? { base: key as TemplateId, suffix: null } : null;
  const base = key.slice(0, i);
  const suffix = key.slice(i + 1);
  return isAlternateType(base) && isAlternateSuffix(suffix) ? { base, suffix } : null;
}

export function isTemplateKey(v: unknown): v is TemplateKey {
  return parseTemplateKey(v) !== null;
}

/** Modèle désigné par la clé, ou `null` s'il n'existe pas dans le document. */
export function getTemplateByKey(doc: ThemeDocument, key: TemplateKey | string): Template | null {
  const k = parseTemplateKey(key);
  if (!k) return null;
  if (k.suffix === null) return doc.templates[k.base] ?? null;
  return doc.alternates?.[k.base as AlternateTemplateType]?.[k.suffix] ?? null;
}

/**
 * Modèle à rendre pour un objet : `alternates[type][suffix] ?? templates[type]`.
 * `suffix` provient de la base (`templateSuffix`) : valeur invalide ou modèle supprimé → modèle par défaut.
 */
export function resolveTemplate(doc: ThemeDocument, type: TemplateId, suffix?: string | null): { template: Template; key: TemplateKey; suffix: string | null } {
  if (suffix && isAlternateType(type) && isAlternateSuffix(suffix)) {
    const alt = doc.alternates?.[type]?.[suffix];
    if (alt) return { template: alt, key: `${type}:${suffix}`, suffix };
  }
  return { template: doc.templates[type], key: type, suffix: null };
}

export type AlternateSummary = { type: AlternateTemplateType; suffix: string; key: AlternateKey; sections: number };

/** Modèles alternatifs du document, par type puis par suffixe (ordre d'insertion). */
export function listAlternates(doc: ThemeDocument, type?: AlternateTemplateType): AlternateSummary[] {
  const out: AlternateSummary[] = [];
  for (const t of ALTERNATE_TEMPLATE_TYPES) {
    if (type && t !== type) continue;
    for (const [suffix, tpl] of Object.entries(doc.alternates?.[t] ?? {})) out.push({ type: t, suffix, key: `${t}:${suffix}`, sections: tpl.order.length });
  }
  return out;
}

export function countAlternates(doc: ThemeDocument, type?: AlternateTemplateType): number {
  return listAlternates(doc, type).length;
}

/** Toutes les clés de modèle du document (modèles par défaut puis alternatifs). */
export function templateKeysOf(doc: ThemeDocument): TemplateKey[] {
  return [...(Object.keys(doc.templates) as TemplateId[]), ...listAlternates(doc).map((a) => a.key)];
}

/** Tous les modèles avec leur clé (pour parcourir le document : scores, références, ids). */
export function allTemplates(doc: ThemeDocument): { key: TemplateKey; base: TemplateId; template: Template }[] {
  const out: { key: TemplateKey; base: TemplateId; template: Template }[] = (Object.entries(doc.templates) as [TemplateId, Template][]).map(([k, t]) => ({ key: k, base: k, template: t }));
  for (const a of listAlternates(doc)) out.push({ key: a.key, base: a.type, template: doc.alternates![a.type]![a.suffix] });
  return out;
}

/**
 * Nom saisi par le commerçant → suffixe (`"Luxe Été"` → `"luxe-ete"`). `null` si rien d'exploitable.
 */
export function normalizeSuffix(input: string): string | null {
  const s = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return isAlternateSuffix(s) ? s : null;
}

/**
 * Peut-on créer `alternates[type][suffix]` ? Plafond global (20) toujours vérifié ; `perTypeLimit` = limite du plan
 * (`limits.alternateTemplatesPerType`, `null` = illimité, 0 = fonction indisponible), à fournir côté serveur.
 */
export function canAddAlternate(
  doc: ThemeDocument,
  type: AlternateTemplateType,
  suffix: string,
  opts: { perTypeLimit?: number | null } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!isAlternateType(type)) return { ok: false, reason: "Ce type de page n'accepte pas de modèle alternatif." };
  if (!isAlternateSuffix(suffix)) return { ok: false, reason: "Nom de modèle : minuscules, chiffres et tirets (24 caractères maximum)." };
  if (doc.alternates?.[type]?.[suffix]) return { ok: false, reason: "Un modèle porte déjà ce nom." };
  if (countAlternates(doc) >= MAX_ALTERNATE_TEMPLATES) return { ok: false, reason: `${MAX_ALTERNATE_TEMPLATES} modèles alternatifs maximum.` };
  const limit = opts.perTypeLimit;
  if (limit != null && countAlternates(doc, type) >= limit) {
    return { ok: false, reason: limit === 0 ? "Les modèles alternatifs ne sont pas inclus dans votre offre." : `${limit} modèles alternatifs maximum pour ce type de page avec votre offre.` };
  }
  return { ok: true };
}
