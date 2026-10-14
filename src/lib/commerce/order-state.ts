import type { OrderStatus, PaymentStatus } from "@prisma/client";

/**
 * Machine d'états commande — distincte de la machine d'états paiement (PaymentAttempt).
 * NEW → CONFIRMED | CANCELLED
 * CONFIRMED → PREPARING | CANCELLED
 * PREPARING → READY | CANCELLED
 * READY → OUT_FOR_DELIVERY | DELIVERED | CANCELLED
 * OUT_FOR_DELIVERY → DELIVERED | READY (échec de livraison, nouvelle tentative)
 * DELIVERED → REFUNDED
 * CANCELLED → (terminal) ; REFUNDED → (terminal)
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "READY"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Vague 2 — commande SANS EXPÉDITION (100 % numérique, service ou carte cadeau) : il n'y a ni préparation,
 * ni mise à disposition, ni départ en livraison. Après paiement confirmé, elle passe directement à
 * « Livrée / remise » (`DELIVERED`). Ces transitions SUPPLÉMENTAIRES ne sont ouvertes que lorsque l'appelant
 * déclare `{ intangible: true }` : le comportement historique des commandes physiques est inchangé.
 */
const INTANGIBLE_EXTRA: Partial<Record<OrderStatus, OrderStatus[]>> = {
  NEW: ["DELIVERED"],
  CONFIRMED: ["DELIVERED"],
  PREPARING: ["DELIVERED"],
};

export type TransitionOptions = { intangible?: boolean };

export function canTransition(from: OrderStatus, to: OrderStatus, opts: TransitionOptions = {}): boolean {
  if (TRANSITIONS[from].includes(to)) return true;
  return !!opts.intangible && (INTANGIBLE_EXTRA[from] ?? []).includes(to);
}

export function nextStatuses(from: OrderStatus, opts: TransitionOptions = {}): OrderStatus[] {
  const extra = opts.intangible ? (INTANGIBLE_EXTRA[from] ?? []).filter((s) => !TRANSITIONS[from].includes(s)) : [];
  return [...TRANSITIONS[from], ...extra];
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "Nouvelle",
  CONFIRMED: "Confirmée",
  PREPARING: "En préparation",
  READY: "Prête",
  OUT_FOR_DELIVERY: "En livraison",
  DELIVERED: "Livrée / remise",
  CANCELLED: "Annulée",
  REFUNDED: "Remboursée",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, "neutral" | "primary" | "accent" | "info" | "warning" | "danger" | "success" | "sun"> = {
  NEW: "accent",
  CONFIRMED: "info",
  PREPARING: "sun",
  READY: "primary",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
  REFUNDED: "warning",
};

export const ORDER_ACTION_LABELS: Record<OrderStatus, string> = {
  NEW: "Remettre en nouvelle",
  CONFIRMED: "Confirmer la commande",
  PREPARING: "Lancer la préparation",
  READY: "Marquer prête",
  OUT_FOR_DELIVERY: "Partie en livraison",
  DELIVERED: "Marquer livrée / remise",
  CANCELLED: "Annuler",
  REFUNDED: "Marquer remboursée",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "À encaisser",
  PENDING: "En attente de vérification",
  PAID: "Payée",
  PARTIALLY_REFUNDED: "Partiellement remboursée",
  REFUNDED: "Remboursée",
  FAILED: "Échec de paiement",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, "neutral" | "primary" | "accent" | "info" | "warning" | "danger" | "success" | "sun"> = {
  UNPAID: "neutral",
  PENDING: "sun",
  PAID: "success",
  PARTIALLY_REFUNDED: "warning",
  REFUNDED: "warning",
  FAILED: "danger",
};

/** Un statut est « actif » tant que la commande n'est pas terminée. */
export const ACTIVE_STATUSES: OrderStatus[] = ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
