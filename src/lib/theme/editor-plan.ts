/**
 * Règles de plan des fonctions lot 4 de l'éditeur de thème (module pur, testé : tests/theme-editor-lot4.test.ts).
 * Contrôle serveur à l'enregistrement du brouillon et à la publication (`lot4PlanIssue`, appelé par `parseDocument`) :
 * un document ne peut pas AUGMENTER le nombre de modèles alternatifs par type au-delà du plan, ni ajouter des règles
 * d'audience non incluses ; ce qui existait déjà (plan rétrogradé) est conservé tel quel.
 */
import { AUDIENCE_RULES_BY_PLAN, PLANS, type AudienceRuleType, type PlanId } from "@/config/plans";
import { ALTERNATE_TEMPLATE_TYPES, type AlternateTemplateType, type ThemeDocument } from "@/lib/theme-engine/types";

export type EditorLot4Rules = {
  motionPresets: boolean;
  qualityScores: boolean;
  /** 0 = non inclus ; null = illimité (plafond global 20). */
  alternatesPerType: number | null;
  /** 0 = non inclus ; null = illimité. */
  savedSections: number | null;
  premiumSections: boolean;
  audienceRules: AudienceRuleType[];
  metafields: boolean;
};

export function editorLot4Rules(planId: PlanId): EditorLot4Rules {
  const p = PLANS[planId];
  return {
    motionPresets: p.features.motionPresets,
    qualityScores: p.features.qualityScores,
    alternatesPerType: p.features.alternateTemplates ? p.limits.alternateTemplatesPerType : 0,
    savedSections: p.features.savedSections ? p.limits.savedSections : 0,
    premiumSections: p.features.premiumSections,
    audienceRules: p.features.audiencePersonalization ? AUDIENCE_RULES_BY_PLAN[planId] : [],
    metafields: p.features.metafields,
  };
}

export const ALTERNATES_UPSELL = "Les modèles alternatifs sont inclus à partir du plan Business.";
export const AUDIENCE_UPSELL = "La personnalisation par audience est incluse à partir du plan Business (règle « client ») et complète à partir du plan Scale.";

function alternateCounts(doc: ThemeDocument): Record<AlternateTemplateType, number> {
  return Object.fromEntries(ALTERNATE_TEMPLATE_TYPES.map((t) => [t, Object.keys(doc.alternates?.[t] ?? {}).length])) as Record<AlternateTemplateType, number>;
}

/** Nombre de règles d'audience dont le type n'est pas inclus dans le plan. */
export function disallowedAudienceRules(doc: ThemeDocument, allowed: readonly AudienceRuleType[]): number {
  let n = 0;
  const templates = [...Object.values(doc.templates), ...Object.values(doc.alternates ?? {}).flatMap((m) => Object.values(m ?? {}))];
  for (const t of templates) for (const s of Object.values(t.sections)) for (const r of s.visibility?.rules ?? []) if (!allowed.includes(r.type)) n++;
  return n;
}

/**
 * Message d'erreur si `next` dépasse le plan par rapport aux documents déjà enregistrés (`previous` : brouillon et
 * publié, valides ou null). null = conforme.
 */
export function lot4PlanIssue(planId: PlanId, next: ThemeDocument, previous: (ThemeDocument | null)[]): string | null {
  const rules = editorLot4Rules(planId);
  const prev = previous.filter((d): d is ThemeDocument => !!d);
  const counts = alternateCounts(next);
  for (const type of ALTERNATE_TEMPLATE_TYPES) {
    const before = Math.max(0, ...prev.map((d) => alternateCounts(d)[type]));
    if (rules.alternatesPerType != null && counts[type] > rules.alternatesPerType && counts[type] > before) {
      return rules.alternatesPerType === 0 ? ALTERNATES_UPSELL : `Votre plan inclut ${rules.alternatesPerType} modèles alternatifs par type de page.`;
    }
  }
  const bad = disallowedAudienceRules(next, rules.audienceRules);
  if (bad > 0 && bad > Math.max(0, ...prev.map((d) => disallowedAudienceRules(d, rules.audienceRules)))) return AUDIENCE_UPSELL;
  return null;
}
