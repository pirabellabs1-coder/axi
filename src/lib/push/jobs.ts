import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Jobs du lot 4 §19 (équipe CAN) : `push.send` { storeId, topic, title, body, url?, tag?, customerId?,
 * campaignId?, subscriptionIds? } envoie les notifications Web Push.
 * Chargé à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES).
 *
 * Contrôles à l'exécution : la boutique du job doit être celle de la charge utile, le plan doit inclure
 * `webPush`, le plafond mensuel doit rester disponible, et le sujet `marketing` exige le consentement PUSH.
 * Les 404 / 410 révoquent l'abonnement. Un envoi partiellement en échec ne fait pas échouer le job
 * (les notifications ne sont pas rejouées : un doublon serait plus gênant qu'un manque).
 */
export const handlers: JobHandlers = {
  "push.send": async (payload, job) => {
    const { parsePushJobPayload, planPushState, audience, recordDelivery } = await import("./service");
    const parsed = parsePushJobPayload(payload);
    if (!parsed) {
      console.error("[push] charge utile de job invalide", { jobId: job.id });
      return;
    }
    if (job.storeId && job.storeId !== parsed.storeId) {
      console.error("[push] boutique du job incohérente", { jobId: job.id });
      return;
    }
    const state = await planPushState(parsed.storeId);
    if (!state.enabled) return;
    if (state.remaining !== null && state.remaining <= 0) {
      console.error("[push] plafond mensuel atteint", { storeId: parsed.storeId, used: state.used });
      return;
    }
    const limit = state.remaining ?? undefined;
    const subs = await audience(parsed.storeId, { topic: parsed.topic, customerId: parsed.customerId, subscriptionIds: parsed.subscriptionIds, limit });
    if (!subs.length) return;
    const { deliver } = await import("./send");
    const report = await deliver(parsed.storeId, subs, { title: parsed.title, body: parsed.body, url: parsed.url, tag: parsed.tag, topic: parsed.topic });
    if (!report) {
      console.error("[push] clés VAPID absentes : notification non envoyée", { storeId: parsed.storeId });
      return;
    }
    await recordDelivery(parsed.storeId, parsed.topic, parsed.title, report, parsed.campaignId);
  },
};
