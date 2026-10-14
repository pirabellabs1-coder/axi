import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyStore } from "@/lib/notifications/service";
import { findLevelDiscrepancies, type LevelDiscrepancy } from "./levels";

/**
 * Réconciliation quotidienne de l'invariant « stock agrégé = Σ niveaux » (lot 3 §1.1).
 * AUCUNE correction automatique : un écart est un signal (bogue ou écriture hors chemin), il est
 * notifié au commerçant et audité. La correction se fait par un comptage (inventaire tournant).
 */

/** Nombre d'écarts cités dans la notification. */
const SAMPLE = 5;

export function discrepancyMessage(rows: readonly LevelDiscrepancy[]): string {
  const sample = rows
    .slice(0, SAMPLE)
    .map((r) => `${r.name} : stock ${r.aggregate}, dépôts ${r.levelsSum}${r.inTransit ? ` + ${r.inTransit} en transit` : ""}`)
    .join(" ; ");
  const more = rows.length > SAMPLE ? ` (+${rows.length - SAMPLE} autre${rows.length - SAMPLE > 1 ? "s" : ""})` : "";
  return `${rows.length} article${rows.length > 1 ? "s" : ""} dont le stock total ne correspond pas à la somme des dépôts. ${sample}${more}. Lancez un inventaire pour corriger.`;
}

export async function reconcileStore(storeId: string): Promise<{ discrepancies: number }> {
  const rows = await findLevelDiscrepancies(storeId);
  if (!rows.length) return { discrepancies: 0 };
  const day = new Date().toISOString().slice(0, 10);
  await notifyStore(storeId, {
    kind: "other",
    key: `inventory:reconcile:${day}`,
    title: "Écart de stock entre dépôts",
    text: discrepancyMessage(rows),
    href: `/app/${storeId}/depots`,
  });
  await audit({
    storeId,
    action: "inventory.reconcile",
    metadata: { count: rows.length, items: rows.slice(0, 20).map((r) => ({ productId: r.productId, variantId: r.variantId, aggregate: r.aggregate, levelsSum: r.levelsSum })) },
  });
  return { discrepancies: rows.length };
}

/** Balayage de toutes les boutiques actives (job quotidien `inventory.reconcile` sans `storeId`). */
export async function reconcileAllStores(): Promise<{ stores: number; discrepancies: number }> {
  const stores = await db.store.findMany({ where: { status: { not: "SUSPENDED" }, locations: { some: {} } }, select: { id: true } });
  let discrepancies = 0;
  for (const s of stores) {
    const r = await reconcileStore(s.id);
    discrepancies += r.discrepancies;
  }
  return { stores: stores.length, discrepancies };
}
