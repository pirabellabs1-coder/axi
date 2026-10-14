import "server-only";
import { hmacSha256, requireAppSecret, safeEqual } from "@/lib/crypto";
import { formatSignedVid, isVisitorId, splitSignedVid, VID_SIGNATURE_LENGTH } from "./assign";

/**
 * Signature de l'identifiant visiteur `axi_vid` (correctif mineur n° 11).
 *
 * Le cookie décide de la variante de test affichée et sert de clé de dédoublonnage des statistiques.
 * Non signé, il était librement forgeable : un script pouvait envoyer des milliers d'identifiants
 * distincts à `POST /api/s/{slug}/events` et fabriquer la « victoire » d'une variante — une décision
 * commerciale prise sur des chiffres faux. La valeur du cookie est donc désormais `<id>.<hmac>`, et
 * seules les valeurs signées par CE serveur sont acceptées.
 *
 * Le secret ne sort jamais du serveur : la valeur signée est calculée au rendu et posée par l'îlot
 * client (comme avant), qui ne fait que recopier ce que le serveur lui donne.
 */

export function signVisitorId(id: string): string {
  return hmacSha256(requireAppSecret(), `axi-vid:${id}`).slice(0, VID_SIGNATURE_LENGTH);
}

/** Valeur de cookie à poser pour cet identifiant. */
export function signedVisitorCookie(id: string): string {
  return formatSignedVid(id, signVisitorId(id));
}

/**
 * Identifiant visiteur d'une valeur de cookie, ou `null` si elle n'est pas signée par ce serveur.
 * Un cookie non signé (visiteur d'avant ce correctif, ou valeur forgée) est REJETÉ : le visiteur
 * reçoit simplement un nouvel identifiant signé au prochain rendu.
 */
export function readSignedVisitorId(value: unknown): string | null {
  const parts = splitSignedVid(value);
  if (!parts || !isVisitorId(parts.id)) return null;
  return safeEqual(signVisitorId(parts.id), parts.signature) ? parts.id : null;
}
