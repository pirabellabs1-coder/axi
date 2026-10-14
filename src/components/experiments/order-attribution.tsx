import { cookies } from "next/headers";
import { after } from "next/server";
import { VISITOR_COOKIE } from "@/lib/experiments/assign";
import { readSignedVisitorId } from "@/lib/experiments/vid-signature";
import { recordOrderConversion } from "@/lib/experiments/service";

/**
 * Lot 4 §13 : conversion « commande » des tests A/B, comptée CÔTÉ SERVEUR à l'affichage de la confirmation.
 *
 * Aucune donnée n'est crue côté client : l'affectation est recalculée depuis le cookie `axi_vid`, et seuls les tests
 * que ce visiteur a réellement vus (mémoire d'exposition de 30 jours) sont attribués. L'écriture dans
 * `Order.attribution.experiments` est idempotente : recharger la page de confirmation ne compte pas deux fois.
 *
 * Le comptage a lieu dans `after()` : il ne retarde pas l'affichage de la commande et une erreur reste invisible.
 */
export async function ExperimentOrderAttribution({ store, orderId }: { store: { id: string; timezone: string }; orderId: string }) {
  // Cookie signé seulement (mineur n° 11) : une valeur forgée n'attribue aucune conversion.
  const visitorId = readSignedVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
  if (!visitorId) return null;
  after(async () => {
    try {
      await recordOrderConversion({ store: { id: store.id, timezone: store.timezone }, orderId, visitorId });
    } catch {
      /* mesure perdue : jamais bloquant pour l'acheteur */
    }
  });
  return null;
}
