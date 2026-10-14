/** Signalements de boutiques : motifs et statuts (module pur, partagé client / serveur). */
export const REPORT_REASONS = ["fraud", "prohibited", "counterfeit", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  fraud: "Arnaque ou fraude",
  prohibited: "Produits interdits",
  counterfeit: "Contrefaçon",
  spam: "Spam ou contenu trompeur",
  other: "Autre motif",
};

export const REPORT_STATUSES = ["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  OPEN: "Ouvert",
  REVIEWING: "En examen",
  RESOLVED: "Traité",
  DISMISSED: "Rejeté",
};

export function reasonLabel(v: string): string {
  return (REPORT_REASON_LABEL as Record<string, string>)[v] ?? v;
}
