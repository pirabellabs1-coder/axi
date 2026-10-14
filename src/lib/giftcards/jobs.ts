import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Gestionnaires de jobs des cartes cadeaux et avoirs, chargés à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES).
 *  - giftcard.issue { orderId }        : émission après paiement confirmé (idempotente) ;
 *  - giftcard.deliver { giftCardId, force? } : envoi au destinataire (e-mail ; sinon lien wa.me côté acheteur) ;
 *  - giftcard.expire_sweep              : ACTIVE → EXPIRED + filet de sécurité d'émission (quotidien) ;
 *  - tenders.unpaid_sweep               : commandes impayées > 72 h avec carte ou avoir débité (quotidien).
 * Planification quotidienne : `scheduleDailyGiftCardSweeps()` (src/lib/giftcards/schedule.ts), appelée par /api/jobs/run.
 */
export const handlers: JobHandlers = {
  "giftcard.issue": async (p) => {
    const orderId = typeof p.orderId === "string" ? p.orderId : null;
    if (!orderId) return;
    const { issueGiftCardsForOrder } = await import("./service");
    await issueGiftCardsForOrder(orderId);
  },
  "giftcard.deliver": async (p) => {
    const giftCardId = typeof p.giftCardId === "string" ? p.giftCardId : null;
    if (!giftCardId) return;
    const { deliverGiftCard } = await import("./service");
    await deliverGiftCard(giftCardId, { force: p.force === true });
  },
  "giftcard.expire_sweep": async () => {
    const { expireGiftCards, enqueueMissingGiftCardIssues } = await import("./service");
    await expireGiftCards();
    await enqueueMissingGiftCardIssues();
  },
  "tenders.unpaid_sweep": async () => {
    const { notifyUnpaidTenderOrders } = await import("./service");
    await notifyUnpaidTenderOrders();
  },
};
