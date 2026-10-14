import "server-only";
import type { JobHandlers } from "@/lib/jobs";
import { reconcileAllStores, reconcileStore } from "./reconcile";

/**
 * Jobs de l'inventaire (lot 3) : réconciliation quotidienne de l'invariant « stock agrégé = Σ niveaux
 * + en transit ». Sans `storeId`, toutes les boutiques pourvues de dépôts sont balayées.
 */
export const handlers: JobHandlers = {
  "inventory.reconcile": async (payload, job) => {
    const storeId = typeof payload.storeId === "string" ? payload.storeId : job.storeId;
    if (storeId) await reconcileStore(storeId);
    else await reconcileAllStores();
  },
};
