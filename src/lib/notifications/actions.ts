"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, success, zBool, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { markSeen, updateStorePrefs } from "./prefs";

/** Marque le flux comme lu pour le membre courant (appelé à l'ouverture du centre de notifications). */
export async function markNotificationsSeen(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.view");
    await markSeen(ctx.store.id, ctx.user.id);
    return success();
  });
}

const prefsSchema = z.object({
  storeId: z.string().min(8).max(64),
  dailyReport: zBool,
  lowStockThreshold: z.coerce.number().int("Nombre entier attendu").min(0, "0 minimum").max(1000, "1 000 maximum"),
});

export async function updateNotificationPrefs(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(prefsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    await updateStorePrefs(ctx.store.id, { dailyReport: parsed.data.dailyReport, lowStockThreshold: parsed.data.lowStockThreshold });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "notifications.prefs_updated", metadata: { dailyReport: parsed.data.dailyReport, lowStockThreshold: parsed.data.lowStockThreshold } });
    revalidatePath(`/app/${ctx.store.id}/notifications`);
    return success(undefined, "Préférences enregistrées");
  });
}
