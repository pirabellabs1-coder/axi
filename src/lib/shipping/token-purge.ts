import "server-only";
import { db } from "@/lib/db";

/**
 * Purge des jetons de la page livreur (`/livraison/[token]`) — correctif mineur n° 6.
 *
 * Le jeton vaut accès, sans authentification, à l'adresse du client, à son prénom, au montant à encaisser
 * et au détail du colis. Il circule par WhatsApp et survit dans l'historique du téléphone du livreur.
 * Deux garde-fous complémentaires à l'expiration de 7 jours :
 *  - `revokeCourierToken` (action du commerçant) : coupe l'accès immédiatement ;
 *  - cette purge quotidienne : EFFACE le jeton des expéditions clôturées (livrées, retournées, annulées)
 *    dès qu'elles sont terminées depuis plus de `PURGE_AFTER_HOURS`. Le lien devient alors inconnu (404),
 *    il n'y a plus rien à fuiter.
 *
 * `Shipment.courierToken` est nullable et unique : le mettre à `null` est sûr et idempotent.
 */

/** Délai après clôture avant effacement du jeton (le livreur peut encore consulter son dernier tour). */
export const PURGE_AFTER_HOURS = 24;
const BATCH = 500;

export async function purgeFinishedCourierTokens(now: Date = new Date(), afterHours = PURGE_AFTER_HOURS): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - Math.max(0, afterHours) * 3_600_000);
  const rows = await db.shipment.findMany({
    where: {
      courierToken: { not: null },
      status: { in: ["DELIVERED", "RETURNED", "CANCELLED"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
    take: BATCH,
  });
  if (!rows.length) return { purged: 0 };
  const purged = await db.shipment.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    // L'expiration est ramenée à la date de purge : la page répond « expiré » même si un index traîne.
    data: { courierToken: null, courierTokenExpiresAt: now },
  });
  return { purged: purged.count };
}
