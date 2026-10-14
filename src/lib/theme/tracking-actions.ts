"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";

/** Champ vide = suppression de l'identifiant. Espaces retirés, GA en majuscules. */
const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const trackingSchema = z.object({
  storeId: z.string(),
  metaPixelId: z.preprocess(
    (v) => empty(typeof v === "string" ? v.replace(/\s+/g, "") : v),
    z.string().regex(/^\d{10,20}$/, "L'identifiant du Pixel Meta contient 10 à 20 chiffres.").nullable(),
  ),
  gaMeasurementId: z.preprocess(
    (v) => empty(typeof v === "string" ? v.trim().toUpperCase() : v),
    z.string().regex(/^G-[A-Z0-9]{4,16}$/, "Format attendu : G-XXXXXXX (lettres et chiffres après « G- »).").nullable(),
  ),
});

/** Identifiants de mesure publicitaire (Pixel Meta, Google Analytics 4). Fonctionnalité `pixels` (Business et plus). */
export async function updateTracking(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(trackingSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, metaPixelId, gaMeasurementId } = parsed.data;
    const ctx = await requireStore(storeId, "store.settings");
    if (!PLANS[ctx.planId].features.pixels) return fail("La mesure publicitaire (Pixel Meta et Google Analytics) est incluse à partir du plan Business.");
    await db.store.update({ where: { id: ctx.store.id }, data: { metaPixelId, gaMeasurementId } });
    await audit({
      storeId: ctx.store.id,
      actorId: ctx.user.id,
      action: "store.tracking_updated",
      metadata: { metaPixelId, gaMeasurementId, previous: { metaPixelId: ctx.store.metaPixelId, gaMeasurementId: ctx.store.gaMeasurementId } },
    });
    revalidatePath(`/app/${ctx.store.id}/parametres`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, metaPixelId || gaMeasurementId ? "Mesure publicitaire enregistrée" : "Identifiants de mesure retirés");
  });
}
