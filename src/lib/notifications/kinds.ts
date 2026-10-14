/**
 * Types de notifications internes du commerçant (fonctions pures, partagées client / serveur).
 * Les notifications sont des lignes `Notification` au canal « inapp », statut SENT.
 */
export type NotifKind =
  | "order.new"
  | "payment.verify"
  | "payment.failed"
  | "stock.low"
  | "stock.oversold"
  | "review.new"
  | "messages.unread"
  | "credits"
  | "invoice.due"
  | "automation"
  | "campaign"
  | "other";

/** Déduit le type d'une notification depuis son gabarit (y compris les gabarits historiques). */
export function kindOf(template: string): NotifKind {
  if (template.startsWith("notif.")) {
    const k = template.slice(6) as NotifKind;
    return KIND_LABELS[k] ? k : "other";
  }
  if (template.startsWith("credits.")) return "credits";
  if (template.startsWith("campaign.")) return "campaign";
  if (template.startsWith("payment.")) return "payment.verify";
  if (template.startsWith("automation")) return "automation";
  return "other";
}

export const KIND_LABELS: Record<NotifKind, string> = {
  "order.new": "Nouvelle commande",
  "payment.verify": "Paiement",
  "payment.failed": "Paiement échoué",
  "stock.low": "Stock bas",
  "stock.oversold": "Survente",
  "review.new": "Avis client",
  "messages.unread": "Messages",
  credits: "Crédits",
  "invoice.due": "Facture",
  automation: "Automatisation",
  campaign: "Campagne",
  other: "Information",
};

export type FeedItem = { id: string; kind: NotifKind; title: string; text: string; href: string | null; createdAt: string; unread: boolean };
