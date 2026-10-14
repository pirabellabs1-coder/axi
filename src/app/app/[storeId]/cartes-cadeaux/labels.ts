import type { BadgeTone } from "@/components/ui/badge";
import type { GiftCardDisplayStatus } from "@/lib/giftcards/state";

export const STATUS_TONE: Record<GiftCardDisplayStatus, BadgeTone> = {
  ACTIVE: "success",
  EXHAUSTED: "neutral",
  DISABLED: "warning",
  EXPIRED: "danger",
};

export const SOURCE_LABELS: Record<"PURCHASE" | "MANUAL" | "REFUND" | "RETURN", string> = {
  PURCHASE: "Achat",
  MANUAL: "Création manuelle",
  REFUND: "Remboursement",
  RETURN: "Retour",
};

export const TX_LABELS: Record<"ISSUE" | "REDEEM" | "REVERSAL" | "ADJUST" | "EXPIRE" | "REACTIVATE", string> = {
  ISSUE: "Émission",
  REDEEM: "Utilisation",
  REVERSAL: "Recrédit",
  ADJUST: "Ajustement",
  EXPIRE: "Expiration",
  REACTIVATE: "Réactivation",
};
