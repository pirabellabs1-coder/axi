/**
 * Forme du code gérant de la caisse — module PUR (client ET serveur, tests/pos-manager-code.test.ts).
 *
 * Séparé de `manager-code.ts` (`server-only` : base de données, HMAC, limitation de débit) pour que
 * l'écran de caisse puisse valider la saisie sans importer de code serveur. La VÉRIFICATION, elle,
 * n'existe que côté serveur : rien ici ne décide d'une autorisation.
 */

export const MANAGER_CODE_MIN_LENGTH = 4;
export const MANAGER_CODE_MAX_LENGTH = 6;
/** Essais erronés tolérés avant blocage temporaire du dépassement de plafond. */
export const MAX_MANAGER_CODE_ATTEMPTS = 5;
/** Durée du blocage après épuisement des essais (secondes). */
export const MANAGER_CODE_LOCK_SECONDS = 15 * 60;

/** Saisie normalisée : chiffres uniquement, 4 à 6 chiffres. `null` si la forme ne convient pas. */
export function normalizeManagerCode(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= MANAGER_CODE_MIN_LENGTH && digits.length <= MANAGER_CODE_MAX_LENGTH ? digits : null;
}

/** Faiblesse rédhibitoire d'un code à la DÉFINITION (message en français), ou `null` s'il convient. */
export function managerCodeWeakness(code: string): string | null {
  if (!normalizeManagerCode(code)) return `Le code du gérant comporte ${MANAGER_CODE_MIN_LENGTH} à ${MANAGER_CODE_MAX_LENGTH} chiffres.`;
  if (/^(\d)\1*$/.test(code)) return "Évitez un code fait d'un seul chiffre répété (0000, 1111…).";
  if ("0123456789".includes(code) || "9876543210".includes(code)) return "Évitez une suite de chiffres consécutifs (1234, 4321…).";
  return null;
}
