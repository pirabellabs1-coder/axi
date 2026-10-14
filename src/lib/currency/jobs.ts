import "server-only";
import type { JobHandlers } from "@/lib/jobs";

/**
 * Jobs du lot 2 (devises, équipe C) : `fx.refresh` (quotidien) : taux BCE + parités fixes BCEAO dans ExchangeRate.
 * Chargé à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES). Une erreur (réseau, fichier illisible) fait échouer le
 * job (retenté puis DEAD) : les anciens taux restent, et deviennent inaffichables au-delà de 72 h (repli boutique).
 */
export const handlers: JobHandlers = {
  "fx.refresh": async () => {
    const { refreshPlatformRates } = await import("./rates");
    const r = await refreshPlatformRates();
    console.info(`[fx.refresh] ${r.updated} taux mis à jour (BCE ${r.date ?? "désactivée"})`);
  },
};
