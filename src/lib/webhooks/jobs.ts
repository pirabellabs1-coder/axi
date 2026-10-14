import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Jobs du lot 2 (webhooks, équipe E) : `webhook.fanout` { storeId, eventId, event, data, createdAt } crée une
 * WebhookDelivery par point abonné ; `webhook.deliver` { deliveryId } envoie (signature, SSRF, relances).
 * Chargé à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES). Détail : src/lib/webhooks/service.ts.
 */
export const handlers: JobHandlers = {
  "webhook.fanout": async (p) => {
    const { fanoutEvent } = await import("./service");
    await fanoutEvent({ storeId: String(p.storeId ?? ""), eventId: String(p.eventId ?? ""), event: String(p.event ?? ""), data: p.data ?? {}, createdAt: typeof p.createdAt === "string" ? p.createdAt : undefined });
  },
  "webhook.deliver": async (p) => {
    if (typeof p.deliveryId !== "string" || !p.deliveryId) return;
    const { deliverWebhook } = await import("./service");
    await deliverWebhook(p.deliveryId);
  },
};
