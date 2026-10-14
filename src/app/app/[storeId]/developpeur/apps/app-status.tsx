import type { AppStatus } from "@prisma/client";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/** Libellé et teinte du statut d'une application (portail développeur et revue admin). */
export const APP_STATUS_META: Record<AppStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  IN_REVIEW: { label: "En revue", tone: "info" },
  PUBLISHED: { label: "Publiée", tone: "success" },
  SUSPENDED: { label: "Suspendue", tone: "danger" },
};

export function AppStatusBadge({ status }: { status: AppStatus }) {
  const m = APP_STATUS_META[status];
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}
