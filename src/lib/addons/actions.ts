"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStore, requireUserOrThrow } from "@/lib/auth/permissions";
import { getAccountStoresQuota } from "@/lib/store/account-quota-service";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { getAddOn, ZONE_CURRENCY, type PlanId } from "@/config/plans";
import { billingZone } from "@/lib/billing/rules";
import { audit } from "@/lib/audit";
import { createAddOnOrder, confirmInvoicePayment } from "@/lib/billing/service";

const purchaseSchema = z.object({
  addOnId: z.string().min(3).max(40),
  quantity: z.coerce.number().int().min(1, "Quantité minimale : 1").max(20, "Quantité maximale : 20"),
});

/**
 * Achat d'une option : AddOnPurchase PENDING + Invoice OPEN, puis redirection vers la facture.
 * L'option devient active à la confirmation du paiement (confirmInvoicePayment → activateAddOnPurchase).
 * Prix lu dans le catalogue serveur selon la zone de la boutique.
 */
export async function purchaseAddOn(storeId: string, addOnId: string, quantity = 1): Promise<ActionResult> {
  return guard(() => purchaseAddOnFor(storeId, addOnId, quantity));
}

/**
 * Parcours « payer d'abord » de l'assistant de nouvelle boutique : achète une place « Boutique en plus »
 * sur la boutique principale du COMPTE (meilleur plan), dans la zone/devise de facturation de cette boutique.
 * Après paiement confirmé, la page de facture renvoie vers l'assistant (place débloquée).
 */
export async function purchaseExtraStoreSlot(): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const q = await getAccountStoresQuota(user.id);
    if (q.firstStore || !q.primaryStoreId) return fail("Votre première boutique est incluse : créez-la directement.");
    if (q.allowed) return fail("Vous avez déjà une place libre : créez votre boutique.");
    if (!q.canBuyExtra) return fail("L'option « Boutique en plus » est réservée aux plans Business et Scale. Passez au plan Business pour ouvrir d'autres boutiques.");
    return purchaseAddOnFor(q.primaryStoreId, "EXTRA_STORE", 1);
  });
}

async function purchaseAddOnFor(storeId: string, addOnId: string, quantity: number): Promise<ActionResult> {
  const parsed = purchaseSchema.safeParse({ addOnId, quantity });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Demande invalide.");
  const ctx = await requireStore(storeId, "billing.manage");
  const addOn = getAddOn(parsed.data.addOnId);
  if (!addOn) return fail("Option inconnue.");
  // Option retirée : l'achat de domaine se fait désormais depuis Domaine (recherche, prix réel, renouvellement).
  if (addOn.id === "DOMAIN_NAME") return fail("L'achat de nom de domaine se fait maintenant depuis la page Domaine de votre boutique.");
  if (!addOn.plans.includes(ctx.planId)) return fail(`Cette option n'est pas disponible avec votre plan actuel.`);
  const qty = addOn.billing === "ONE_TIME" || addOn.id === "SECTOR_TEMPLATE" ? 1 : parsed.data.quantity;

  // Évite les doublons : une facture d'option en attente identique est réutilisée.
  const pending = await db.addOnPurchase.findFirst({ where: { storeId: ctx.store.id, addOnId: addOn.id, status: "PENDING", startsAt: { lte: new Date(Date.now() + 60_000) } }, orderBy: { createdAt: "desc" } });
  if (pending?.invoiceId) {
    const inv = await db.invoice.findUnique({ where: { id: pending.invoiceId }, select: { status: true } });
    if (inv?.status === "OPEN") redirect(`/app/${ctx.store.id}/abonnement/factures/${pending.invoiceId}?option=1`);
  }

  // Zone figée sur l'abonnement (source de vérité) ; la devise de la boutique n'initialise qu'un abonnement absent.
  const initialZone = billingZone(ctx.store.subscription, ctx.store.currency);
  const invoiceId = await db.$transaction(async (tx) => {
    const sub = await tx.subscription.upsert({
      where: { storeId: ctx.store.id },
      // Jamais de plan payant créé ici : un abonnement absent est « sans plan » (boutique en pause).
      create: { storeId: ctx.store.id, planId: "FREE", status: "PAUSED", pausedAt: new Date(), zone: initialZone, currency: ZONE_CURRENCY[initialZone] },
      update: {},
    });
    const zone = billingZone(sub, ctx.store.currency);
    const { invoice, purchaseId } = await createAddOnOrder(tx, { storeId: ctx.store.id, subscriptionId: sub.id, planId: sub.planId as PlanId, addOnId: addOn.id, quantity: qty, zone });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "addon.purchased", target: purchaseId, metadata: { addOnId: addOn.id, quantity: qty, invoice: invoice.number, amount: invoice.amount, currency: invoice.currency } }, tx);
    if (invoice.amount === 0) await confirmInvoicePayment(invoice.id, { via: "zero_amount", actorId: ctx.user.id }, tx);
    return invoice.id;
  });
  revalidatePath(`/app/${ctx.store.id}/options`);
  redirect(`/app/${ctx.store.id}/abonnement/factures/${invoiceId}?option=1`);
}

/**
 * Résiliation d'une option récurrente : effective en fin de période (reste utilisable jusqu'à endsAt,
 * aucune facture de renouvellement). Une option en attente de paiement est simplement annulée.
 */
export async function cancelAddOn(storeId: string, purchaseId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "billing.manage");
    const p = await db.addOnPurchase.findFirst({ where: { id: purchaseId, storeId: ctx.store.id } });
    if (!p) return fail("Option introuvable.");
    const addOn = getAddOn(p.addOnId);
    if (p.status === "PENDING") {
      await db.$transaction(async (tx) => {
        await tx.addOnPurchase.update({ where: { id: p.id }, data: { status: "CANCELLED", endsAt: new Date() } });
        if (p.invoiceId) await tx.invoice.updateMany({ where: { id: p.invoiceId, status: "OPEN" }, data: { status: "VOID" } });
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "addon.cancelled_pending", target: p.id, metadata: { addOnId: p.addOnId } }, tx);
      });
      revalidatePath(`/app/${ctx.store.id}/options`);
      return success(undefined, "Commande d'option annulée, facture annulée.");
    }
    if (p.status !== "ACTIVE" || !addOn || (addOn.billing !== "MONTHLY" && addOn.billing !== "YEARLY") || !p.endsAt) return fail("Cette option ne peut pas être résiliée.");
    await db.$transaction(async (tx) => {
      await tx.addOnPurchase.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
      // Renouvellement déjà émis mais non payé : annulé.
      const renewals = await tx.addOnPurchase.findMany({ where: { storeId: ctx.store.id, addOnId: p.addOnId, status: "PENDING", startsAt: { gte: p.endsAt! } } });
      for (const r of renewals) {
        await tx.addOnPurchase.update({ where: { id: r.id }, data: { status: "CANCELLED", endsAt: new Date() } });
        if (r.invoiceId) await tx.invoice.updateMany({ where: { id: r.invoiceId, status: "OPEN" }, data: { status: "VOID" } });
      }
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "addon.cancel_scheduled", target: p.id, metadata: { addOnId: p.addOnId, endsAt: p.endsAt } }, tx);
    });
    revalidatePath(`/app/${ctx.store.id}/options`);
    return success(undefined, `Option résiliée : elle reste active jusqu'au ${p.endsAt.toLocaleDateString("fr-FR")}.`);
  });
}

/** Reprise d'une option résiliée avant son échéance. */
export async function resumeAddOn(storeId: string, purchaseId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "billing.manage");
    const p = await db.addOnPurchase.findFirst({ where: { id: purchaseId, storeId: ctx.store.id, status: "CANCELLED", endsAt: { gt: new Date() } } });
    if (!p) return fail("Option introuvable ou déjà échue.");
    if (!getAddOn(p.addOnId)?.plans.includes(ctx.planId)) return fail("Cette option n'est plus disponible avec votre plan.");
    await db.addOnPurchase.update({ where: { id: p.id }, data: { status: "ACTIVE" } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "addon.resumed", target: p.id });
    revalidatePath(`/app/${ctx.store.id}/options`);
    return success(undefined, "Option reprise : elle sera renouvelée normalement.");
  });
}
