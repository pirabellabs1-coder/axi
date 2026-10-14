/**
 * Panneau « Qualité » : logique pure (testée). Les scores et corrections viennent de quality.ts (T1) ;
 * ici : application d'une correction au document (une seule entrée d'historique), cible d'un problème dans l'éditeur,
 * libellés, et lien des corrections hors document.
 */
import { parseTemplateKey } from "@/lib/theme-engine/alternates";
import { applyOperations, type ApplyResult } from "@/lib/theme-engine/operations";
import { isDocumentFix, type Issue, type QualityCategory } from "@/lib/theme-engine/quality";
import type { ThemeRefs } from "@/lib/theme-engine/validate";
import type { TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import type { Selection } from "./types";

export const CATEGORY_LABELS: Record<QualityCategory, string> = {
  accessibility: "Accessibilité",
  performance: "Performance",
  seo: "SEO",
  conversion: "Conversion",
};

export const CATEGORY_ORDER: QualityCategory[] = ["accessibility", "performance", "seo", "conversion"];

export const SEVERITY_LABELS = { error: "Important", warning: "À améliorer", tip: "Conseil" } as const;

export function scoreBand(score: number): { label: string; tone: "good" | "medium" | "low" } {
  if (score >= 90) return { label: "Bon", tone: "good" };
  if (score >= 60) return { label: "À améliorer", tone: "medium" };
  return { label: "Faible", tone: "low" };
}

/** Score global affiché sur l'onglet : moyenne arrondie des 4 catégories. */
export function overallScore(scores: Record<QualityCategory, number>): number {
  return Math.round(CATEGORY_ORDER.reduce((n, c) => n + scores[c], 0) / CATEGORY_ORDER.length);
}

/** Applique la correction d'un problème (opérations du moteur, document revalidé). */
export function applyIssueFix(doc: ThemeDocument, issue: Issue, refs?: ThemeRefs): ApplyResult | null {
  if (!isDocumentFix(issue.fix)) return null;
  return applyOperations(doc, issue.fix, { refs });
}

/** Où aller dans l'éditeur pour voir le problème. */
export function issueDestination(issue: Issue): { template: TemplateId; alternate: string | null; selection: Selection } | null {
  const t = issue.target;
  if (!t) return null;
  if (t.global) {
    const group = t.global.startsWith("header") ? "header" : t.global.startsWith("footer") ? "footer" : t.global.split(".")[0];
    return { template: "home", alternate: null, selection: { kind: "global", group } };
  }
  const k = t.template ? parseTemplateKey(t.template) : null;
  if (!k) return null;
  const selection: Selection = t.sectionId ? (t.blockId ? { kind: "block", sectionId: t.sectionId, blockId: t.blockId } : { kind: "section", id: t.sectionId }) : null;
  return { template: k.base, alternate: k.suffix, selection };
}

/** Lien de l'espace marchand pour une correction hors document (null : pas d'écran dédié). */
export function actionHref(issue: Issue, storeId: string): string | null {
  const f = issue.fix;
  if (!f || isDocumentFix(f)) return null;
  switch (f.action) {
    case "open_product":
      return `/app/${storeId}/produits/${encodeURIComponent(f.productId)}`;
    case "ai_alt":
      return f.productIds.length === 1 ? `/app/${storeId}/produits/${encodeURIComponent(f.productIds[0])}` : `/app/${storeId}/produits`;
    case "ai_seo":
      return f.target === "store_description" ? `/app/${storeId}/parametres` : f.target === "collections" ? `/app/${storeId}/collections` : `/app/${storeId}/produits`;
    case "compress_image":
      return null;
  }
}
