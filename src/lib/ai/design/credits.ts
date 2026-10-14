import "server-only";
import { db } from "@/lib/db";

/**
 * Lot 4 §9 : coûts en crédits IA du générateur et de l'assistant, et crédits OFFERTS à la boutique.
 *
 * Débit AVANT l'appel, remboursement en cas d'échec ou de sortie invalide (voir `actions.ts`).
 * Le kit de marque (§7) et l'édition en place (§8) sont gratuits : ils n'apparaissent pas ici.
 */
export const DESIGN_CREDITS = {
  /** Générer 3 directions (texte seul). */
  generate: 10,
  /** Générer 3 directions avec analyse des photos (≤ 6). */
  generateWithPhotos: 15,
  /** Régénérer une direction. */
  regenerate: 4,
  /** Réécrire les textes d'une section. */
  rewriteSection: 1,
  /** Une instruction de l'assistant de design (§10). */
  assistant: 2,
} as const;

export function generationCost(photoCount: number): number {
  return photoCount > 0 ? DESIGN_CREDITS.generateWithPhotos : DESIGN_CREDITS.generate;
}

/** Crédits offerts à la création de la boutique : une génération complète accessible à tous, plan Gratuit compris. */
export const ONBOARDING_GIFT_CREDITS = 20;
export const ONBOARDING_GIFT_DAYS = 30;
export const ONBOARDING_GIFT_REASON = "onboarding_gift";

/** Débit limité : 5 générations par heure et par boutique (§9). */
export const GENERATION_RATE = { limit: 5, windowSec: 3600 };

/**
 * Accorde les 20 crédits IA offerts, UNE SEULE FOIS par boutique (verrou consultatif + contrôle d'existence),
 * avec 30 jours de validité. Appelé paresseusement à l'ouverture du générateur : aucune dépendance au
 * code de création de boutique. Renvoie le nombre de crédits accordés (0 si déjà offerts).
 */
export async function grantOnboardingGift(storeId: string, now = new Date()): Promise<number> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credits:gift:${storeId}`}))`;
      const exists = await tx.creditLedger.findFirst({ where: { storeId, type: "AI", reason: ONBOARDING_GIFT_REASON }, select: { id: true } });
      if (exists) return 0;
      await tx.creditLedger.create({
        data: {
          storeId,
          type: "AI",
          delta: ONBOARDING_GIFT_CREDITS,
          reason: ONBOARDING_GIFT_REASON,
          reference: `gift:${storeId}`,
          expiresAt: new Date(now.getTime() + ONBOARDING_GIFT_DAYS * 86_400_000),
        },
      });
      return ONBOARDING_GIFT_CREDITS;
    },
    // Machine de développement chargée : le verrou consultatif peut attendre plus que le défaut de 5 s.
    { timeout: 15_000, maxWait: 15_000 },
  );
}

/** Variante tolérante : une erreur transitoire de base ne doit jamais empêcher l'affichage d'une page. */
export async function grantOnboardingGiftSafe(storeId: string, now = new Date()): Promise<number> {
  try {
    return await grantOnboardingGift(storeId, now);
  } catch (e) {
    console.error("[credits] onboarding_gift", e);
    return 0;
  }
}
