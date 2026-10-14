import "server-only";
import { db } from "@/lib/db";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Jobs du lot 4 (IA et marque, équipe T4) : `ai.generation_purge` supprime les `ThemeGeneration` expirées
 * (`expiresAt`, 7 jours). Chargé à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES).
 * Les candidats compilés contiennent des documents de thème complets : ils ne sont pas conservés
 * au-delà de la durée de vie de la proposition.
 */
export const handlers: JobHandlers = {
  "ai.generation_purge": async (_payload, job) => {
    const where = { expiresAt: { lt: new Date() }, ...(job.storeId ? { storeId: job.storeId } : {}) };
    const { count } = await db.themeGeneration.deleteMany({ where });
    if (count) console.info(`[ai.generation_purge] ${count} génération(s) supprimée(s)`);
  },
};
