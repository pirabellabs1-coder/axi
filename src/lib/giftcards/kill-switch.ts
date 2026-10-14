import "server-only";
import { db, type Tx } from "@/lib/db";

/**
 * Arrêt d'urgence plateforme des cartes cadeaux (`PlatformSetting` `giftcards.kill_switch`, valeur `{ enabled, message }`).
 * Effet : utilisation au checkout et vérification publique du solde suspendues. L'émission des cartes déjà payées,
 * les recrédits (annulation, remboursement) et la gestion marchande restent possibles (obligation envers l'acheteur).
 * Lecture sans cache : la valeur est consultée dans la transaction de commande, une requête par commande avec carte.
 */
export const GIFTCARDS_KILL_SWITCH_KEY = "giftcards.kill_switch";
export type GiftCardsKillSwitch = { enabled: boolean; message: string };

export const GIFTCARDS_SUSPENDED_MESSAGE = "Les cartes cadeaux sont momentanément indisponibles. Réessayez plus tard ou choisissez un autre moyen de paiement.";

export async function getGiftCardsKillSwitch(client: Tx | typeof db = db): Promise<GiftCardsKillSwitch> {
  const row = await client.platformSetting.findUnique({ where: { key: GIFTCARDS_KILL_SWITCH_KEY } });
  const v = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Partial<GiftCardsKillSwitch>) : null;
  return { enabled: v?.enabled === true, message: typeof v?.message === "string" ? v.message : "" };
}
