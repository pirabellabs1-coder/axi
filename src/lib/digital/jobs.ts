import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Gestionnaires de jobs des produits numériques (vague 2), chargés à la demande par src/lib/jobs.ts.
 *  - `digital.deliver { orderId }` : émission des accès de téléchargement après paiement confirmé
 *    (idempotente), notification de l'acheteur, puis clôture d'une commande sans expédition.
 *
 * Mise en file : `onPaymentSucceeded` ci-dessous, appelée par le gestionnaire du job `payment.succeeded`
 * (lui-même mis en file DANS la transaction qui passe la commande à PAID, sur les trois chemins).
 */
export const handlers: JobHandlers = {
  "digital.deliver": async (p) => {
    const orderId = typeof p.orderId === "string" ? p.orderId : null;
    if (!orderId) return;
    const { issueDigitalDeliveriesForOrder } = await import("./service");
    await issueDigitalDeliveriesForOrder(orderId);
  },
};

/**
 * Appelé par le gestionnaire `payment.succeeded` (src/lib/jobs.ts) : met en file `digital.deliver`
 * seulement si la commande contient une ligne numérique, ou s'il n'y a rien à expédier (clôture).
 * Idempotent : un job en double ne crée pas d'accès supplémentaire.
 */
export async function onPaymentSucceeded(payload: Record<string, unknown>): Promise<void> {
  const orderId = typeof payload.orderId === "string" ? payload.orderId : null;
  if (!orderId) return;
  const { db } = await import("@/lib/db");
  const order = await db.order.findUnique({ where: { id: orderId }, select: { storeId: true, items: { select: { kind: true, isGiftCard: true } } } });
  if (!order) return;
  const { summarizeCartKinds } = await import("./kinds");
  const summary = summarizeCartKinds(order.items);
  if (!summary.hasDigital && !summary.digitalOnly) return;
  const { enqueueDigitalDeliveryTx } = await import("./service");
  await enqueueDigitalDeliveryTx(db, order.storeId, orderId);
}
