/**
 * Annonces de la plateforme : audience et fenêtre d'affichage (module pur, testé).
 * Audiences : all | free | paid | zone:AFRICA | zone:WORLD | plan:STARTER…
 */
import type { PlanId, PricingZone } from "@/config/plans";

export const ANNOUNCEMENT_AUDIENCES = ["all", "free", "paid", "zone:AFRICA", "zone:WORLD", "plan:STARTER", "plan:BUSINESS", "plan:SCALE", "plan:ENTERPRISE"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  all: "Tous les marchands",
  free: "Sans plan (boutiques en pause)",
  paid: "Plans payants",
  "zone:AFRICA": "Zone Afrique (FCFA)",
  "zone:WORLD": "Zone Monde (EUR)",
  "plan:STARTER": "Plan Starter",
  "plan:BUSINESS": "Plan Business",
  "plan:SCALE": "Plan Scale",
  "plan:ENTERPRISE": "Plan Enterprise",
};

export const ANNOUNCEMENT_TONES = ["info", "success", "warning"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];
export const TONE_LABEL: Record<AnnouncementTone, string> = { info: "Information", success: "Nouveauté", warning: "Important" };

export function matchesAudience(audience: string, planId: PlanId, zone: PricingZone): boolean {
  if (audience === "all") return true;
  if (audience === "free") return planId === "FREE";
  if (audience === "paid") return planId !== "FREE";
  if (audience.startsWith("zone:")) return audience.slice(5) === zone;
  if (audience.startsWith("plan:")) return audience.slice(5) === planId;
  return false;
}

export function isLive(a: { active: boolean; startsAt: Date; endsAt: Date | null }, now = new Date()): boolean {
  return a.active && a.startsAt.getTime() <= now.getTime() && (!a.endsAt || a.endsAt.getTime() > now.getTime());
}

export function announcementState(a: { active: boolean; startsAt: Date; endsAt: Date | null }, now = new Date()): "live" | "scheduled" | "ended" | "paused" {
  if (!a.active) return "paused";
  if (a.endsAt && a.endsAt.getTime() <= now.getTime()) return "ended";
  if (a.startsAt.getTime() > now.getTime()) return "scheduled";
  return "live";
}
