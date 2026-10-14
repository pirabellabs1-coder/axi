"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin/context";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { BUYER_KILL_SWITCH_KEY } from "@/lib/buyer/otp";
import { resetBuyerKillSwitchCache } from "@/lib/buyer/settings";

/**
 * Console plateforme (/admin/connecteurs-ia), lot 1 : arrêt d'urgence des comptes acheteurs.
 * `settings.manage`, audit `admin.buyer_accounts.kill_switch`. Effet (src/lib/buyer/**) : codes de connexion refusés
 * et écritures du compte bloquées sur toutes les boutiques ; les sessions existantes restent lisibles.
 * L'arrêt des cartes cadeaux est fourni par l'équipe C (src/lib/giftcards/admin-actions.ts).
 */
export async function setBuyerAccountsKillSwitch(enabled: boolean, message: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    const parsed = z.object({ enabled: z.boolean(), message: z.string().trim().max(240, "240 caractères maximum") }).safeParse({ enabled, message });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    await db.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: BUYER_KILL_SWITCH_KEY },
        create: { key: BUYER_KILL_SWITCH_KEY, value: parsed.data, updatedBy: user.id },
        update: { value: parsed.data, updatedBy: user.id },
      });
      await audit({ actorId: user.id, action: "admin.buyer_accounts.kill_switch", metadata: parsed.data }, tx);
    });
    resetBuyerKillSwitchCache();
    revalidatePath("/admin/connecteurs-ia");
    return success(undefined, parsed.data.enabled ? "Comptes acheteurs suspendus sur toute la plateforme" : "Comptes acheteurs réactivés");
  });
}
