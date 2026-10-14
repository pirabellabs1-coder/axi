"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, badIds, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { revokeCustomerSessions } from "./session";
import { WELCOME_MAX, saveAccountSettings } from "./settings";

/** Réglages marchand des comptes acheteurs : Paramètres, puis « Comptes clients ». */
const settingsSchema = z.object({
  storeId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  accountsEnabled: zBool,
  channel: z.enum(["store_whatsapp", "platform"], { error: "Canal invalide" }),
  welcomeText: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(WELCOME_MAX, `${WELCOME_MAX} caractères maximum`)),
});

export async function updateAccountSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(settingsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const sid = ctx.store.id;
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: sid }, data: { accountsEnabled: parsed.data.accountsEnabled } });
      await saveAccountSettings(sid, { channel: parsed.data.channel, welcomeText: parsed.data.welcomeText }, tx);
      await audit({ storeId: sid, actorId: ctx.user.id, action: "store.accounts_settings_updated", metadata: { accountsEnabled: parsed.data.accountsEnabled, channel: parsed.data.channel } }, tx);
    });
    revalidatePath(`/app/${sid}/parametres/comptes-clients`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, parsed.data.accountsEnabled ? "Comptes clients activés" : "Comptes clients désactivés");
  });
}

/** Fiche client : « Déconnecter tous les appareils » (customers.manage, audit customer.sessions_revoked). */
export async function revokeBuyerSessions(storeId: string, customerId: string): Promise<ActionResult<{ revoked: number }>> {
  return guard(async () => {
    const bad = badIds(storeId, customerId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "customers.manage");
    const sid = ctx.store.id;
    const customer = await db.customer.findFirst({ where: { id: customerId, storeId: sid }, select: { id: true } });
    if (!customer) return fail("Client introuvable");
    const revoked = await revokeCustomerSessions(sid, customer.id);
    await audit({ storeId: sid, actorId: ctx.user.id, action: "customer.sessions_revoked", target: customer.id, metadata: { sessions: revoked } });
    revalidatePath(`/app/${sid}/clients/${customer.id}`);
    return success({ revoked }, revoked ? `${revoked} appareil${revoked > 1 ? "s" : ""} déconnecté${revoked > 1 ? "s" : ""}` : "Aucune session active");
  });
}
