"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ConsentChannel, ConsentPurpose } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zId, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { customerEventData } from "./events";

const customerSchema = z.object({
  storeId: zId,
  customerId: zId,
  name: z.string().trim().min(2, "Nom trop court").max(80),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().email("E-mail invalide").optional()),
  address: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(300).optional()),
  notes: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(2000).optional()),
  tags: zOptionalString,
});

export async function updateCustomer(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(customerSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, customerId, name, email, address, notes, tags } = parsed.data;
    const ctx = await requireStore(storeId, "customers.manage");
    const tagList = [...new Set((tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 30))].slice(0, 20);
    const current = await db.customer.findFirst({ where: { id: customerId, storeId: ctx.store.id }, select: { email: true, phone: true } });
    if (!current) return fail("Client introuvable");
    const nextEmail = email?.toLowerCase() ?? null;
    // L'e-mail sert à la connexion acheteur : un changement annule sa vérification (sinon le nouvel
    // e-mail donnerait accès au compte, à l'historique et à l'avoir du client).
    const emailChanged = (current.email?.toLowerCase() ?? null) !== nextEmail;
    const r = await db.$transaction(async (tx) => {
      const u = await tx.customer.updateMany({
        where: { id: customerId, storeId: ctx.store.id },
        data: { name, email: nextEmail, address: address ?? null, notes: notes ?? null, tags: tagList, ...(emailChanged ? { emailVerifiedAt: null } : {}) },
      });
      // Lot 2 (W) : coordonnées sous `customer` (filtrées au fan-out selon les droits du point).
      if (u.count > 0) await emitDomainEvent(tx, ctx.store.id, "customer.updated", customerEventData({ id: customerId, name, phone: current.phone, email: nextEmail }, { source: "dashboard", updated_fields: ["name", "email", "address", "notes", "tags"] }));
      return u;
    });
    if (r.count === 0) return fail("Client introuvable");
    if (emailChanged) await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "customer.email_changed", target: customerId });
    revalidatePath(`/app/${ctx.store.id}/clients`);
    revalidatePath(`/app/${ctx.store.id}/clients/${customerId}`);
    return success(undefined, "Fiche client enregistrée");
  });
}

export async function setConsent(storeId: string, customerId: string, channel: ConsentChannel, purpose: ConsentPurpose, granted: boolean): Promise<ActionResult> {
  return guard(async () => {
    const v = z
      .object({ channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]), purpose: z.enum(["TRANSACTIONAL", "MARKETING"]), granted: z.boolean() })
      .safeParse({ channel, purpose, granted });
    if (!v.success) return fail("Paramètres invalides");
    const ctx = await requireStore(storeId, "customers.manage");
    const customer = await db.customer.findFirst({ where: { id: customerId, storeId: ctx.store.id }, select: { id: true } });
    if (!customer) return fail("Client introuvable");
    await db.consent.create({ data: { customerId, channel: v.data.channel, purpose: v.data.purpose, granted: v.data.granted, source: "manual" } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: granted ? "customer.consent_granted" : "customer.consent_withdrawn", target: customerId, metadata: { channel, purpose } });
    revalidatePath(`/app/${ctx.store.id}/clients/${customerId}`);
    return success(undefined, granted ? "Consentement enregistré" : "Retrait enregistré");
  });
}

/** RGPD : supprime la fiche et anonymise les commandes liées (jamais de suppression de commandes). */
export async function deleteCustomer(storeId: string, customerId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "customers.manage");
    const customer = await db.customer.findFirst({ where: { id: customerId, storeId: ctx.store.id }, select: { id: true } });
    if (!customer) return fail("Client introuvable");
    await db.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { customerId, storeId: ctx.store.id },
        data: { customerName: "Client supprimé", customerPhone: "0000000000", customerEmail: null, deliveryAddress: null, customerNote: null, customerId: null },
      });
      await tx.customer.delete({ where: { id: customerId } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "customer.deleted", target: customerId }, tx);
    });
    revalidatePath(`/app/${ctx.store.id}/clients`);
    revalidatePath(`/app/${ctx.store.id}/commandes`);
    redirect(`/app/${ctx.store.id}/clients`);
  });
}
