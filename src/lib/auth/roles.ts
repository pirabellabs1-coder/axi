import type { MembershipRole } from "@prisma/client";

/** Libellés de rôles — module pur, importable côté client. */
export const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: "Propriétaire",
  MANAGER: "Gestionnaire",
  STAFF: "Préparateur / livreur",
  SUPPORT: "Support (temporaire)",
};
