"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { normalizePhone } from "@/lib/utils";
import { getCountry } from "@/config/site";
import { PLANS } from "@/config/plans";
import { encryptSecret } from "@/lib/crypto";
import { audit } from "@/lib/audit";

const waSchema = z.object({
  storeId: z.string(),
  whatsappNumber: z.string().trim().min(6, "Numéro WhatsApp requis"),
  whatsappOrdering: zBool,
});

/** Numéro WhatsApp + activation de la commande sur WhatsApp. */
export async function updateWhatsapp(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(waSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const country = getCountry(ctx.store.country);
    const wa = normalizePhone(parsed.data.whatsappNumber, country.dialCode);
    if (!wa) return fail("Numéro WhatsApp invalide pour ce pays.", { whatsappNumber: ["Numéro invalide"] });
    await db.store.update({ where: { id: ctx.store.id }, data: { whatsappNumber: wa, whatsappOrdering: parsed.data.whatsappOrdering } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "store.whatsapp_updated" });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, "WhatsApp enregistré");
  });
}

const cloudSchema = z.object({
  storeId: z.string(),
  // Identifiants Meta : numériques uniquement.
  phoneNumberId: z.string().trim().regex(/^\d{5,32}$/, "Identifiant du numéro invalide (chiffres uniquement)"),
  wabaId: z.string().trim().regex(/^\d{5,32}$/, "Identifiant WABA invalide (chiffres uniquement)"),
  token: zOptionalString,
});

/**
 * Enregistre les identifiants WhatsApp Business API (Meta Cloud API).
 * Le token est chiffré au repos et jamais renvoyé. L'intégration passe en « pending » :
 * la validation réelle (webhook signé, numéro vérifié chez Meta) est un point d'intégration du porteur.
 */
export async function saveWhatsappCloud(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(cloudSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "integrations.manage");
    if (!PLANS[ctx.planId].features.whatsappApi) {
      return fail(`L'API WhatsApp officielle est incluse à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis la page Abonnement.`);
    }

    const existing = await db.integration.findUnique({ where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } } });
    if (!parsed.data.token && !existing?.secretsEncrypted) return fail("Le jeton d'accès (token) est requis lors de la première configuration.", { token: ["Requis"] });

    const phoneNumberId = parsed.data.phoneNumberId;
    // M2 : un numéro Meta n'appartient qu'à une boutique (colonne unique Integration.phoneNumberId).
    const taken = await db.integration.findUnique({ where: { phoneNumberId }, select: { storeId: true } });
    if (taken && taken.storeId !== ctx.store.id) {
      return fail("Ce numéro WhatsApp est déjà connecté à une autre boutique Axi. Contactez le support si vous en êtes le titulaire.", { phoneNumberId: ["Déjà utilisé"] });
    }
    const config: Prisma.InputJsonValue = { phoneNumberId, wabaId: parsed.data.wabaId };
    const secrets = parsed.data.token ? encryptSecret(JSON.stringify({ token: parsed.data.token })) : existing!.secretsEncrypted;
    // Changement de numéro ou de jeton : nouvelle validation par la plateforme (statut « pending »).
    const sameNumber = existing?.phoneNumberId === phoneNumberId;
    const keepActive = existing?.status === "active" && sameNumber && !parsed.data.token;
    try {
      await db.integration.upsert({
        where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } },
        create: { storeId: ctx.store.id, kind: "whatsapp_cloud", status: "pending", phoneNumberId, config, secretsEncrypted: secrets },
        update: { config, phoneNumberId, secretsEncrypted: secrets, status: keepActive ? "active" : "pending", lastError: null },
      });
    } catch (e) {
      // Course : le même numéro enregistré au même instant par une autre boutique.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return fail("Ce numéro WhatsApp est déjà connecté à une autre boutique Axi.", { phoneNumberId: ["Déjà utilisé"] });
      }
      throw e;
    }
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "integration.whatsapp_cloud.saved", metadata: { phoneNumberId: parsed.data.phoneNumberId } });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    return success(undefined, "Identifiants enregistrés. La connexion sera validée par la plateforme.");
  });
}

export async function disconnectWhatsappCloud(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "integrations.manage");
    await db.integration.deleteMany({ where: { storeId: ctx.store.id, kind: "whatsapp_cloud" } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "integration.whatsapp_cloud.removed" });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    return success(undefined, "Connexion supprimée");
  });
}
