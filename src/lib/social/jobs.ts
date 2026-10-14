import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Jobs du lot 1 bis (équipe P2) : `social.sync` { syncId, force? } synchronise un SocialCatalogSync (catalogue
 * WhatsApp / Meta Commerce via l'API Graph de l'Integration whatsapp_cloud), incrémental par SocialCatalogItem.contentHash.
 * Chargé à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES).
 *
 * Les échecs d'appel à Meta sont absorbés par la ligne SocialCatalogSync (statut, erreur, backoff via nextSyncAt) :
 * le job se termine alors normalement, pour ne pas cumuler le backoff du worker et celui de la synchronisation.
 * Seule une erreur inattendue (base) fait échouer le job.
 */
export const handlers: JobHandlers = {
  "social.sync": async (payload, job) => {
    const syncId = typeof payload.syncId === "string" ? payload.syncId : "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(syncId)) return;
    const { runCatalogSync } = await import("./sync");
    await runCatalogSync(syncId, { force: payload.force === true, jobStoreId: job.storeId });
  },
};
