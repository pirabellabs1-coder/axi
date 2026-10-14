import { z } from "zod";

/** Segments de campagne (partagé client / serveur, sans dépendance serveur). */
export type SegmentKind = "all" | "loyal" | "inactive" | "new" | "tag";
export type CampaignSegment = { kind: SegmentKind; tag?: string; snapshot?: string[] };

export const SEGMENTS: { kind: SegmentKind; label: string; description: string }[] = [
  { kind: "all", label: "Tous les clients", description: "Tous les clients qui acceptent vos messages marketing." },
  { kind: "loyal", label: "Clients fidèles", description: "3 commandes ou plus." },
  { kind: "inactive", label: "Clients inactifs", description: "Aucune commande depuis plus de 60 jours." },
  { kind: "new", label: "Nouveaux clients", description: "Arrivés ces 30 derniers jours." },
  { kind: "tag", label: "Par étiquette", description: "Clients portant une étiquette précise." },
];

export const SEGMENT_LABEL: Record<SegmentKind, string> = Object.fromEntries(SEGMENTS.map((s) => [s.kind, s.label])) as Record<SegmentKind, string>;

export const MAX_RECIPIENTS = 1000;
export const MAX_CAMPAIGN_MESSAGE = 1000;
export const ATTRIBUTION_DAYS = 7;

export const segmentSchema = z.object({
  kind: z.enum(["all", "loyal", "inactive", "new", "tag"]),
  tag: z.string().trim().max(40).optional(),
  snapshot: z.array(z.string()).optional(),
});

export function parseSegment(raw: unknown): CampaignSegment {
  const r = segmentSchema.safeParse(raw);
  return r.success ? r.data : { kind: "all" };
}

export function describeSegment(s: CampaignSegment): string {
  return s.kind === "tag" && s.tag ? `Étiquette « ${s.tag} »` : SEGMENT_LABEL[s.kind];
}

/** Remplace les variables {prenom} et {boutique}. */
export function renderCampaignMessage(template: string, vars: { prenom: string; boutique: string }): string {
  return template.replace(/\{prenom\}/gi, () => vars.prenom || "").replace(/\{boutique\}/gi, () => vars.boutique);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
