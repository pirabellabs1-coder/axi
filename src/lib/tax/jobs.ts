import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Taxes et factures : aucun type de job dédié. L'émission automatique est accrochée au job existant
 * `payment.succeeded` (mis en file dans la transaction qui passe la commande à PAID, sur les trois chemins :
 * commande payée à la création, confirmation manuelle, webhook de passerelle).
 */
export const handlers: JobHandlers = {};

/** Appelé par le gestionnaire `payment.succeeded` (src/lib/jobs.ts). Idempotent ; une erreur relance le job. */
export async function onPaymentSucceeded(payload: Record<string, unknown>): Promise<void> {
  const orderId = typeof payload.orderId === "string" ? payload.orderId : null;
  if (!orderId) return;
  const { autoIssueInvoiceForOrder } = await import("./invoice");
  await autoIssueInvoiceForOrder(orderId);
}
