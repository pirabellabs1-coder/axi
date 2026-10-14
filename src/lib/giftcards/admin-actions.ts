"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin/context";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { GIFTCARDS_KILL_SWITCH_KEY } from "./kill-switch";

/**
 * Console plateforme : arrêt d'urgence des cartes cadeaux (`settings.manage`, audit `admin.giftcards.kill_switch`).
 * Effet : utilisation au checkout et vérification publique suspendues sur toutes les boutiques.
 * À brancher dans la console d'arrêt d'urgence (/admin/connecteurs-ia), hors périmètre de l'équipe C.
 */
export async function setGiftCardsKillSwitch(enabled: boolean, message: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    const parsed = z.object({ enabled: z.boolean(), message: z.string().trim().max(240, "240 caractères maximum") }).safeParse({ enabled, message });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    await db.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: GIFTCARDS_KILL_SWITCH_KEY },
        create: { key: GIFTCARDS_KILL_SWITCH_KEY, value: parsed.data, updatedBy: user.id },
        update: { value: parsed.data, updatedBy: user.id },
      });
      await audit({ actorId: user.id, action: "admin.giftcards.kill_switch", metadata: parsed.data }, tx);
    });
    revalidatePath("/admin/connecteurs-ia");
    return success(undefined, parsed.data.enabled ? "Cartes cadeaux suspendues sur toute la plateforme" : "Cartes cadeaux réactivées");
  });
}
