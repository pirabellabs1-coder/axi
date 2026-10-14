"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zRawId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { readPwaConfig } from "./config";

/**
 * Réglages de la boutique installable (lot 4 §14), côté marchand.
 * Capacité `theme.manage`, plan `pwa` contrôlé côté serveur, filtre `storeId` systématique.
 * Les icônes sont produites côté client (canvas) puis téléversées par l'API média : ici on ne reçoit
 * que des URL, revalidées par la liste blanche de `readPwaConfig`.
 */

const settingsSchema = z.object({
  storeId: zRawId,
  enabled: zBool,
  prompt: zBool,
  name: z.string().trim().max(60, "60 caractères maximum").optional(),
  shortName: z.string().trim().max(12, "12 caractères maximum").optional(),
  icon192: z.string().trim().max(500, "Adresse trop longue").optional(),
  icon512: z.string().trim().max(500, "Adresse trop longue").optional(),
  offlineText: z.string().trim().max(200, "200 caractères maximum").optional(),
});

export async function savePwaSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(settingsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "theme.manage");
    if (!PLANS[ctx.planId].features.pwa) {
      return fail(`La boutique installable est incluse à partir du plan Starter. Changez de plan : /app/${ctx.store.id}/abonnement`);
    }
    const next = readPwaConfig({
      enabled: parsed.data.enabled,
      prompt: parsed.data.prompt,
      name: parsed.data.name,
      shortName: parsed.data.shortName,
      icon192: parsed.data.icon192,
      icon512: parsed.data.icon512,
      offlineText: parsed.data.offlineText,
    });
    if (next.enabled && (!next.icon192 || !next.icon512)) {
      return fail("Ajoutez une image : les icônes 192 et 512 sont nécessaires pour que la boutique soit installable.");
    }
    await db.store.update({ where: { id: ctx.store.id }, data: { pwaConfig: next as unknown as Prisma.InputJsonValue } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "pwa.settings_saved", metadata: { enabled: next.enabled, prompt: next.prompt } });
    revalidatePath(`/app/${ctx.store.id}/apparence/pwa`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, next.enabled ? "Boutique installable activée." : "Réglages enregistrés.");
  });
}
