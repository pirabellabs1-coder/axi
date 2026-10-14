/**
 * Logique PURE de la revue admin des applications (importable dans les tests — pas de `server-only`).
 * Décide la transition de statut selon la décision de l'administrateur et le statut courant.
 */
import type { AppStatus } from "@prisma/client";

export type ReviewAction = "publish" | "reject" | "suspend";

export type ReviewOutcome = { status: AppStatus; listed: boolean };

/**
 * Résultat d'une décision de revue, ou null si la transition est interdite depuis le statut courant :
 *  - publish  : IN_REVIEW → PUBLISHED, listée (visible au catalogue) ;
 *  - reject   : IN_REVIEW → DRAFT (renvoyée au développeur, non listée) ;
 *  - suspend  : PUBLISHED ou IN_REVIEW → SUSPENDED, délistée.
 */
export function reviewOutcome(action: ReviewAction, current: AppStatus): ReviewOutcome | null {
  switch (action) {
    case "publish":
      return current === "IN_REVIEW" ? { status: "PUBLISHED", listed: true } : null;
    case "reject":
      return current === "IN_REVIEW" ? { status: "DRAFT", listed: false } : null;
    case "suspend":
      return current === "PUBLISHED" || current === "IN_REVIEW" ? { status: "SUSPENDED", listed: false } : null;
    default:
      return null;
  }
}
