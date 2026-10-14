/**
 * Lot 4 §13 : règles PURES des tests A/B de sections (lecture défensive, application au document, limites de plan).
 *
 * Interdits structurels :
 *  - une variante ne peut pas changer un prix (elle ne porte qu'une `SectionInstance` validée par le moteur) ;
 *  - une section obligatoire du modèle ne peut pas être masquée (la variante « masquée » retombe sur la section
 *    actuelle plutôt que de casser la page) ;
 *  - un seul test actif par section (vérifié par l'action serveur, en base).
 */
import { PLANS, type PlanId } from "@/config/plans";
import { parseTemplateKey, getTemplateByKey, type TemplateKey } from "@/lib/theme-engine/alternates";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import type { AlternateTemplateType, SectionInstance, Template, ThemeDocument } from "@/lib/theme-engine/types";
import { VARIANT_KEYS, type VariantKey, type VariantKind } from "./assign";

export type ExperimentVariant = { key: VariantKey; weight: number; kind: VariantKind; section: SectionInstance | null };

export const VARIANT_KIND_LABELS: Record<VariantKind, string> = {
  current: "Section actuelle",
  section: "Variante de la section",
  hidden: "Section masquée",
};

export function variantLabel(v: { key: VariantKey; kind: VariantKind }): string {
  return `${v.key} · ${VARIANT_KIND_LABELS[v.kind]}`;
}

/* ───────────── Lecture défensive de la colonne `variants` ───────────── */

function isKind(v: unknown): v is VariantKind {
  return v === "current" || v === "section" || v === "hidden";
}

/** Variantes stockées → variantes utilisables. Retourne [] si la donnée est inexploitable. */
export function parseVariants(raw: unknown): ExperimentVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: ExperimentVariant[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, VARIANT_KEYS.length)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === "string" && (VARIANT_KEYS as readonly string[]).includes(o.key) ? (o.key as VariantKey) : null;
    if (!key || seen.has(key)) continue;
    const kind = isKind(o.kind) ? o.kind : o.section ? "section" : "current";
    const weight = typeof o.weight === "number" && Number.isFinite(o.weight) ? Math.max(0, Math.min(100, Math.round(o.weight))) : 0;
    const section = kind === "section" && o.section && typeof o.section === "object" ? (o.section as SectionInstance) : null;
    if (kind === "section" && !section) continue;
    seen.add(key);
    out.push({ key, weight, kind, section });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Forme sérialisable (colonne JSON). */
export function serializeVariants(variants: readonly ExperimentVariant[]): unknown {
  return variants.map((v) => ({ key: v.key, weight: v.weight, kind: v.kind, section: v.kind === "section" ? v.section : null }));
}

/* ───────────── Application au document ───────────── */

function withTemplate(doc: ThemeDocument, key: TemplateKey, next: Template): ThemeDocument {
  const k = parseTemplateKey(key);
  if (!k) return doc;
  if (k.suffix === null) return { ...doc, templates: { ...doc.templates, [k.base]: next } };
  const type = k.base as AlternateTemplateType;
  return { ...doc, alternates: { ...doc.alternates, [type]: { ...doc.alternates?.[type], [k.suffix]: next } } };
}

/** La section existe-t-elle (et est-elle rendue) dans ce modèle du document ? */
export function sectionIsPresent(doc: ThemeDocument, key: TemplateKey, sectionId: string): boolean {
  const t = getTemplateByKey(doc, key);
  return !!t && t.order.includes(sectionId) && !!t.sections[sectionId] && !t.sections[sectionId].disabled;
}

/**
 * Applique la variante au document (copie). La variante A (« section actuelle ») ne change rien.
 * Renvoie le document inchangé si la section est absente : un thème programmé qui ne contient pas la section
 * suspend donc naturellement le test.
 */
export function applyVariant(doc: ThemeDocument, key: TemplateKey, sectionId: string, variant: ExperimentVariant): ThemeDocument {
  const t = getTemplateByKey(doc, key);
  const current = t?.sections[sectionId];
  if (!t || !current) return doc;
  if (variant.kind === "current") return doc;
  if (variant.kind === "hidden") {
    if (SECTION_SCHEMAS[current.type]?.required) return doc; // section obligatoire : jamais masquée
    // Retrait de l'ordre ET de la table des sections : le document reste valide (il peut être enregistré tel quel).
    const sections = { ...t.sections };
    delete sections[sectionId];
    return withTemplate(doc, key, { order: t.order.filter((id) => id !== sectionId), sections });
  }
  if (!variant.section) return doc;
  // L'identifiant et le type restent ceux de la section d'origine (ordre et registre de rendu inchangés).
  const next: SectionInstance = { ...variant.section, id: sectionId, type: current.type };
  return withTemplate(doc, key, { order: t.order, sections: { ...t.sections, [sectionId]: next } });
}

/**
 * Valide une section de variante en la plaçant seule dans une copie du document : elle passe exactement les mêmes
 * contrôles que l'éditeur (liste blanche de réglages, liens et images sûrs, taille).
 */
export function validateVariantSection(doc: ThemeDocument, key: TemplateKey, section: unknown): { ok: true; section: SectionInstance } | { ok: false; error: string } {
  const k = parseTemplateKey(key);
  if (!k) return { ok: false, error: "Modèle de page inconnu." };
  if (!section || typeof section !== "object") return { ok: false, error: "Variante illisible." };
  const raw = section as SectionInstance;
  const probe: ThemeDocument = {
    ...doc,
    alternates: undefined,
    templates: { ...doc.templates, [k.base]: { order: [raw.id], sections: { [raw.id]: raw } } },
  };
  const v = validateThemeDocument(probe);
  if (!v.ok) return { ok: false, error: v.errors[0]?.message ?? "Variante invalide." };
  const checked = v.doc.templates[k.base].sections[raw.id];
  return checked ? { ok: true, section: checked } : { ok: false, error: "Variante invalide." };
}

/* ───────────── Limites de plan ───────────── */

/** Nombre de tests simultanés (0 = non inclus, null = illimité). */
export function experimentAllowance(planId: PlanId): number | null {
  const p = PLANS[planId];
  return p.features.abTests ? p.limits.concurrentExperiments : 0;
}

export const EXPERIMENTS_UPSELL = "Les tests A/B de sections sont inclus à partir du plan Scale.";

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  RUNNING: "En cours",
  PAUSED: "En pause",
  COMPLETED: "Terminé",
};

export const STATUS_TONES: Record<string, "neutral" | "success" | "warning" | "info"> = {
  DRAFT: "neutral",
  RUNNING: "success",
  PAUSED: "warning",
  COMPLETED: "info",
};
