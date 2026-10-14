import type { ReturnStatus } from "@prisma/client";

/**
 * Machine d'états des retours — module PUR, seule source de vérité des transitions (spec lot 1 §4).
 *
 *   REQUESTED ──approuver──► APPROVED ──réception──► RECEIVED ──résoudre──► RESOLVED (terminal)
 *       │  └──refuser──► REJECTED (terminal)
 *       └──annuler (acheteur ou commerçant)──► CANCELLED ◄──annuler (commerçant)── APPROVED
 *   Création par le commerçant (retour en boutique) : directement APPROVED ou RECEIVED.
 */

export const RETURN_STATUSES: readonly ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "RESOLVED", "REJECTED", "CANCELLED"] as const;

const TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["RESOLVED"],
  RESOLVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export type ReturnActor = "customer" | "merchant" | "system";

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Transition autorisée pour un acteur : l'acheteur ne peut qu'annuler une demande encore en attente. */
export function canActorTransitionReturn(from: ReturnStatus, to: ReturnStatus, actor: ReturnActor): boolean {
  if (!canTransitionReturn(from, to)) return false;
  if (actor === "customer") return from === "REQUESTED" && to === "CANCELLED";
  return true;
}

export function nextReturnStatuses(from: ReturnStatus): readonly ReturnStatus[] {
  return TRANSITIONS[from];
}

export function isTerminalReturn(status: ReturnStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuts initiaux autorisés à la création : demande acheteur → REQUESTED ; commerçant → APPROVED ou RECEIVED. */
export function initialReturnStatusAllowed(status: ReturnStatus, actor: ReturnActor): boolean {
  if (actor === "customer") return status === "REQUESTED";
  return status === "APPROVED" || status === "RECEIVED";
}

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  REQUESTED: "Demandé",
  APPROVED: "Approuvé",
  RECEIVED: "Reçu",
  RESOLVED: "Résolu",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
};

export const RETURN_STATUS_TONE: Record<ReturnStatus, "neutral" | "primary" | "info" | "warning" | "danger" | "success" | "sun"> = {
  REQUESTED: "sun",
  APPROVED: "info",
  RECEIVED: "primary",
  RESOLVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

/** Texte acheteur (suivi et notifications). */
export const RETURN_STATUS_BUYER_TEXT: Record<ReturnStatus, string> = {
  REQUESTED: "Votre demande a été transmise à la boutique, qui va l'examiner.",
  APPROVED: "Votre retour est accepté. Suivez les instructions de la boutique pour lui remettre les articles.",
  RECEIVED: "La boutique a bien reçu vos articles et finalise votre retour.",
  RESOLVED: "Votre retour est terminé.",
  REJECTED: "La boutique n'a pas accepté votre demande de retour.",
  CANCELLED: "Cette demande de retour a été annulée.",
};

/** Statuts « à traiter » par le commerçant (compteur de la barre latérale). */
export const RETURN_PENDING_STATUSES: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED"];
