import "server-only";
import { db } from "@/lib/db";
import { hmacSha256, requireAppSecret, safeEqual } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { MANAGER_CODE_LOCK_SECONDS, MANAGER_CODE_MAX_LENGTH, MANAGER_CODE_MIN_LENGTH, MAX_MANAGER_CODE_ATTEMPTS, normalizeManagerCode } from "./manager-code-shape";

/**
 * Code gérant de la caisse (correctif de sécurité, bloquant n° 1 de l'audit de la vague 3).
 *
 * AVANT : l'API acceptait un drapeau `managerOverride` dans le corps JSON. Un caissier STAFF pouvait
 * donc forger une remise de 100 % (marchandise gratuite) et l'historique de commande inscrivait
 * « validée par le gérant » : la preuve d'audit elle-même était falsifiée.
 *
 * MAINTENANT : un vrai code à 4-6 chiffres par boutique, défini par un rôle habilité (`store.settings`),
 * conservé en base sous forme d'EMPREINTE HMAC liée à la boutique (même approche que
 * `deliveryCodeFingerprint`), vérifié côté serveur avec compteur d'essais et limitation de débit.
 * `managerOverride` n'est vrai que si cette vérification a réussi.
 *
 * Choix assumés :
 *  - pas de colonne de compteur : les essais sont comptés dans la table `RateLimit` (clé par boutique),
 *    ce qui donne blocage temporaire ET limitation de débit avec une seule migration additive ;
 *  - tant qu'aucun code n'est défini, le dépassement de plafond est REFUSÉ (jamais accordé par défaut).
 */

// La FORME du code (longueurs, normalisation, faiblesses) vit dans un module pur partagé avec l'écran
// de caisse ; seule la vérification — base, HMAC, compteur d'essais — est ici.
export {
  MANAGER_CODE_MIN_LENGTH,
  MANAGER_CODE_MAX_LENGTH,
  MAX_MANAGER_CODE_ATTEMPTS,
  MANAGER_CODE_LOCK_SECONDS,
  normalizeManagerCode,
  managerCodeWeakness,
} from "./manager-code-shape";

/** Empreinte du code, liée à la boutique : un code n'est pas réutilisable dans une autre boutique. */
export function managerCodeFingerprint(storeId: string, code: string): string {
  return hmacSha256(requireAppSecret(), `pos-manager:${storeId}:${code}`);
}

export type ManagerCodeCheck =
  | { ok: true }
  | { ok: false; reason: "unset" | "format" | "mismatch" | "blocked"; error: string };

/**
 * Vérifie le code du gérant d'une boutique. Chaque appel consomme un essai (fenêtre glissante) :
 * `MAX_MANAGER_CODE_ATTEMPTS` essais, puis blocage de `MANAGER_CODE_LOCK_SECONDS`.
 * Un code correct ne « rend » pas les essais consommés : la fenêtre expire d'elle-même.
 */
export async function verifyManagerCode(storeId: string, raw: string | null | undefined): Promise<ManagerCodeCheck> {
  const store = await db.store.findUnique({ where: { id: storeId }, select: { posManagerCodeHash: true } });
  if (!store?.posManagerCodeHash) {
    return { ok: false, reason: "unset", error: "Aucun code gérant n'est défini pour cette boutique : demandez au gérant de le créer dans les réglages de la caisse." };
  }
  // Le compteur est consommé AVANT la comparaison : une rafale de codes ne peut pas être essayée.
  const attempt = await rateLimit(`pos:manager-code:${storeId}`, MAX_MANAGER_CODE_ATTEMPTS, MANAGER_CODE_LOCK_SECONDS);
  if (!attempt.ok) {
    return { ok: false, reason: "blocked", error: "Trop de codes erronés : le dépassement de plafond est bloqué quelques minutes." };
  }
  const code = normalizeManagerCode(raw);
  if (!code) {
    return { ok: false, reason: "format", error: `Le code du gérant comporte ${MANAGER_CODE_MIN_LENGTH} à ${MANAGER_CODE_MAX_LENGTH} chiffres.` };
  }
  if (!safeEqual(managerCodeFingerprint(storeId, code), store.posManagerCodeHash)) {
    return { ok: false, reason: "mismatch", error: "Code du gérant incorrect." };
  }
  return { ok: true };
}

/** Un code gérant est-il défini sur cette boutique ? (affichage des réglages, jamais le code lui-même). */
export async function hasManagerCode(storeId: string): Promise<{ set: boolean; setAt: Date | null }> {
  const store = await db.store.findUnique({ where: { id: storeId }, select: { posManagerCodeHash: true, posManagerCodeSetAt: true } });
  return { set: !!store?.posManagerCodeHash, setAt: store?.posManagerCodeSetAt ?? null };
}
