import type { CampaignStatus } from "@prisma/client";
import type { BadgeTone } from "@/components/ui/badge";

export const STATUS: Record<CampaignStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  SCHEDULED: { label: "Planifiée", tone: "info" },
  SENDING: { label: "En cours", tone: "sun" },
  SENT: { label: "Envoyée", tone: "success" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
};
