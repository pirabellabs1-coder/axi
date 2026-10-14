import type { ConversationStage, ConversationStatus, MessageStatus } from "@prisma/client";

/** Libellés partagés serveur / client (aucune dépendance serveur ici). */

export const STAGES: ConversationStage[] = ["NEW", "INTERESTED", "ORDERING", "PAID", "LOST"];

export const STAGE_LABELS: Record<ConversationStage, string> = {
  NEW: "Nouveau",
  INTERESTED: "Intéressé",
  ORDERING: "Commande",
  PAID: "Payé",
  LOST: "Perdu",
};

export const STAGE_TONES: Record<ConversationStage, "neutral" | "info" | "sun" | "success" | "danger"> = {
  NEW: "neutral",
  INTERESTED: "info",
  ORDERING: "sun",
  PAID: "success",
  LOST: "danger",
};

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: "Ouverte",
  PENDING: "En attente",
  CLOSED: "Fermée",
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  RECEIVED: "Reçu",
  QUEUED: "En file d'envoi",
  SENT: "Envoyé",
  DELIVERED: "Distribué",
  READ: "Lu",
  FAILED: "Échec de l'envoi",
  LINK_ONLY: "À envoyer depuis WhatsApp",
};

export const INBOX_FILTERS = [
  { key: "", label: "Toutes" },
  { key: "non-lues", label: "Non lues" },
  { key: "a-moi", label: "À moi" },
  { key: "non-attribuees", label: "Non attribuées" },
  { key: "fermees", label: "Fermées" },
] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number]["key"];

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_LABELS = 8;
