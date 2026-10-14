import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Jobs du lot 2 (API REST, équipe E) : `idempotency.purge` supprime les ApiIdempotencyKey expirées (expiresAt).
 * Chargé à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES). Programmé une fois par jour par
 * `scheduleIdempotencyPurge` (src/lib/api/idempotency.ts). Les clés expirées sont de toute façon ignorées à la lecture.
 */
export const handlers: JobHandlers = {
  "idempotency.purge": async () => {
    const { purgeIdempotencyKeys } = await import("./idempotency");
    await purgeIdempotencyKeys();
  },
};
