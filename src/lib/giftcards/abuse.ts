import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit, rateLimitAll, type RateLimitResult } from "@/lib/rate-limit";

/**
 * Débits et détection d'abus des cartes cadeaux (§8 « Fraude cartes cadeaux ») :
 *  - 10 vérifications / 15 min / IP (page publique de solde, champ du checkout) ;
 *  - 5 échecs / panier (checkout : `cartKey` = id du panier ou clé d'idempotence) ;
 *  - alerte à 200 codes invalides / h / boutique (notification marchand + entrée d'audit visible de l'admin).
 */

export const GIFT_CARD_CHECKS_PER_IP = { limit: 10, windowSec: 15 * 60 };
export const GIFT_CARD_FAILURES_PER_CART = { limit: 5, windowSec: 60 * 60 };
export const GIFT_CARD_INVALID_ALERT = { limit: 200, windowSec: 60 * 60 };

/** Compte une vérification (IP, et IP par boutique). À appeler AVANT la recherche du code. */
export async function limitGiftCardCheck(p: { storeId: string; ip: string }): Promise<RateLimitResult> {
  return rateLimitAll([
    { key: `gc:check:ip:${p.ip}`, ...GIFT_CARD_CHECKS_PER_IP },
    { key: `gc:check:store:${p.storeId}:ip:${p.ip}`, ...GIFT_CARD_CHECKS_PER_IP },
  ]);
}

/** Le panier a-t-il épuisé ses essais ? Lecture seule (aucun incrément). */
export async function isGiftCardCartBlocked(cartKey: string, now = new Date()): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key: `gc:fail:cart:${cartKey}`.slice(0, 200) } });
  return !!row && row.resetAt.getTime() > now.getTime() && row.count >= GIFT_CARD_FAILURES_PER_CART.limit;
}

/** Enregistre un échec de code pour un panier (checkout). */
export async function recordGiftCardCartFailure(cartKey: string): Promise<RateLimitResult> {
  return rateLimit(`gc:fail:cart:${cartKey}`, GIFT_CARD_FAILURES_PER_CART.limit, GIFT_CARD_FAILURES_PER_CART.windowSec);
}

/**
 * Compte un code invalide pour la boutique ; au-delà de 200 / h, une alerte par heure (idempotente).
 * Ne lève jamais : la détection ne doit pas casser le parcours d'achat.
 */
export async function recordInvalidGiftCardAttempt(storeId: string, now = new Date()): Promise<void> {
  try {
    const rl = await rateLimit(`gc:invalid:store:${storeId}`, GIFT_CARD_INVALID_ALERT.limit, GIFT_CARD_INVALID_ALERT.windowSec);
    if (rl.ok) return;
    const hour = now.toISOString().slice(0, 13);
    const { notifyStore } = await import("@/lib/notifications/service");
    const created = await notifyStore(storeId, {
      kind: "other",
      key: `gc-invalid:${hour}`,
      title: "Tentatives suspectes sur vos cartes cadeaux",
      text: `Plus de ${GIFT_CARD_INVALID_ALERT.limit} codes de carte cadeau invalides ont été saisis en une heure sur votre boutique. Les essais sont limités automatiquement ; aucune action n'est requise sauf si cela persiste.`,
      href: `/app/${storeId}/cartes-cadeaux`,
    });
    if (created) await audit({ storeId, actorId: null, action: "giftcard.invalid_burst", metadata: { hour, threshold: GIFT_CARD_INVALID_ALERT.limit } });
  } catch (e) {
    console.error("[giftcards] recordInvalidGiftCardAttempt", e);
  }
}
