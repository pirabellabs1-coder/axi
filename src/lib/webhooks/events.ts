/** Catalogue des événements de webhook (lot 2 §4.1). Module pur, importable côté client. */
export const WEBHOOK_EVENTS = [
  "order.created",
  "order.updated",
  "order.status_changed",
  "order.paid",
  "order.refunded",
  "order.cancelled",
  "product.created",
  "product.updated",
  "product.deleted",
  "inventory.updated",
  "customer.created",
  "customer.updated",
  "return.created",
  "return.status_changed",
  "giftcard.issued",
  // Vague 2 : accès de téléchargement émis après paiement confirmé (jamais le jeton, jamais de lien)
  "digital.delivered",
  "app.ping",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_API_VERSION = "2026-10";

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "order.created": "Commande créée",
  "order.updated": "Commande modifiée",
  "order.status_changed": "Statut de commande changé",
  "order.paid": "Commande payée",
  "order.refunded": "Commande remboursée",
  "order.cancelled": "Commande annulée",
  "product.created": "Produit créé",
  "product.updated": "Produit modifié",
  "product.deleted": "Produit supprimé",
  "inventory.updated": "Stock mis à jour",
  "customer.created": "Client créé",
  "customer.updated": "Client modifié",
  "return.created": "Retour créé",
  "return.status_changed": "Statut de retour changé",
  "giftcard.issued": "Carte cadeau émise",
  "digital.delivered": "Fichiers numériques remis",
  "app.ping": "Test (ping)",
};

export function isWebhookEvent(v: string): v is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(v);
}
