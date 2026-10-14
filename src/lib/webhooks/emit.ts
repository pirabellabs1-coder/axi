import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { db, Tx } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import type { WebhookEvent } from "./events";

export type { WebhookEvent } from "./events";

/**
 * Contrat inter-équipes (lot 2 E) : à appeler DANS la transaction qui modifie la donnée.
 * Crée un job `webhook.fanout` { storeId, eventId, event, data, createdAt } ; si la transaction est annulée, aucun
 * événement ne part (outbox transactionnelle). Le fan-out crée ensuite une WebhookDelivery par point actif abonné.
 *
 * `data` : charge minimale et sérialisable en JSON (identifiants, statuts, montants). Les coordonnées personnelles
 * éventuelles sont filtrées au fan-out selon `includePersonalData` du point (voir `redactPersonalData`).
 *
 * `tx` : la transaction de l'écriture (recommandé). `db` est accepté pour une écriture déjà validée hors transaction
 * (au plus une perte d'événement si le processus s'arrête entre les deux écritures).
 *
 * Coût : une ligne `Job` par événement, même sans point de webhook (le fan-out sort immédiatement s'il n'y a
 * aucun abonné). On ne fait pas de lecture des points ici pour garder la transaction appelante courte.
 */
export async function emitDomainEvent(tx: Tx | typeof db, storeId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<{ eventId: string }> {
  const eventId = `evt_${randomUUID().replace(/-/g, "")}`;
  await enqueue(
    "webhook.fanout",
    { storeId, eventId, event, data: data as Prisma.InputJsonValue, createdAt: new Date().toISOString() },
    { storeId },
    tx,
  );
  return { eventId };
}
