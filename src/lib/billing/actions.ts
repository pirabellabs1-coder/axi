"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, type Tx } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { PLANS, ZONE_CURRENCY, zoneForCurrency, type Interval, type PlanId } from "@/config/plans";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { SITE } from "@/config/site";
import { createPlatformCheckout, fetchPlatformStatus, platformProviderFor } from "./platform-billing";
import { CHANGE_REQUESTED_ACTION, addOnInvoiceIds, confirmInvoicePayment, nonDebtInvoiceIds, hideProductsOverLimit, invoiceLines, issuePlanInvoice, pendingPlanChange, quotePlanChange } from "./service";
import { billingZone } from "./rules";
import { COUPON_PUBLIC_ERROR, precheckStoreCoupon, redeemCoupon } from "@/lib/pricing/coupons";
import { normalizeCouponCode } from "@/lib/pricing/rules";

/** Échec d'utilisation d'un code promo dans la transaction d'émission (annule la transaction). */
class CouponError extends Error {}

const zPlan = z.enum(["FREE", "STARTER", "BUSINESS", "SCALE", "ENTERPRISE"]);
const zInterval = z.enum(["MONTHLY", "YEARLY"]);

/**
 * Zone tarifaire : celle figée sur l'abonnement (source de vérité, changée uniquement par l'admin
 * via setPricingZone). Jamais réécrite depuis la devise de la boutique.
 */
function zoneOf(ctx: StoreContext) {
  const zone = billingZone(ctx.store.subscription, ctx.store.currency);
  return { zone, currency: ZONE_CURRENCY[zone] };
}

/** Annule les factures d'abonnement non payées remplacées par un changement (jamais les factures d'options). */
async function voidReplacedPlanInvoices(tx: Tx, subscriptionId: string, fromDate?: Date) {
  // Jamais une facture déjà échue : une dette ne s'efface pas par un changement de plan.
  const open = await tx.invoice.findMany({ where: { subscriptionId, status: "OPEN", dueAt: { gte: new Date() }, ...(fromDate ? { periodStart: { gte: fromDate } } : {}) }, select: { id: true } });
  const addons = await addOnInvoiceIds(open.map((o) => o.id), tx);
  const ids = open.map((o) => o.id).filter((id) => !addons.has(id));
  if (ids.length) await tx.invoice.updateMany({ where: { id: { in: ids } }, data: { status: "VOID" } });
  return ids.length;
}

/**
 * Changement de plan (règles V4, détail dans src/lib/billing/rules.ts) :
 * - montée / démarrage payant : facture OPEN (prorata crédité) ; l'abonnement reste sur son plan
 *   actuel (ou en essai) et le nouveau plan démarre à la confirmation du paiement (confirmInvoicePayment) ;
 * - descente : programmée à la fin de la période payée (cancelAtPeriodEnd + AuditLog subscription.downgrade_scheduled) ;
 * - sans période payée en cours (essai, Gratuit, suspendu) : immédiat.
 * Le montant est TOUJOURS recalculé ici à partir du catalogue (jamais transmis par le client).
 */
export async function changePlan(storeId: string, planId: PlanId, interval: Interval, couponCode?: string | null): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ planId: zPlan, interval: zInterval, couponCode: z.string().max(40).optional().nullable() }).safeParse({ planId, interval, couponCode });
    if (!parsed.success) return fail("Plan, période ou code promo invalide.");
    const code = normalizeCouponCode(parsed.data.couponCode);
    const ctx = await requireStore(storeId, "billing.manage");
    if (planId === "ENTERPRISE") return fail(`Enterprise est sur devis : écrivez-nous à ${SITE.supportEmail}.`);
    const sub = ctx.store.subscription;
    const { zone, currency } = zoneOf(ctx);
    const now = new Date();
    const quote = await quotePlanChange(ctx.store.id, sub, zone, planId, interval, now);
    const from = sub?.planId ?? null;

    if (quote.kind === "same") {
      if (sub?.cancelAtPeriodEnd) return cancelScheduledChange(storeId);
      return fail("Vous êtes déjà sur ce plan.");
    }

    // Code promo SaaS : uniquement à la souscription ou à la montée en gamme (facture émise maintenant).
    if (code) {
      if (planId === "FREE" || quote.kind === "downgrade") return fail("Un code promo s'applique lors d'une souscription ou d'une montée en gamme.");
      const pre = await precheckStoreCoupon(code, { storeId: ctx.store.id, zone, planId });
      if (!pre.ok) return fail(pre.error, { couponCode: [pre.error] });
    }

    // Descente programmée en fin de période
    if (quote.kind === "downgrade" && sub) {
      await db.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
        if (sub.currentPeriodEnd) await voidReplacedPlanInvoices(tx, sub.id, new Date(sub.currentPeriodEnd.getTime() - 86_400_000));
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: planId === "FREE" ? "subscription.cancel_scheduled" : "subscription.downgrade_scheduled", metadata: { from, to: planId, interval, effectiveAt: sub.currentPeriodEnd, hiddenProducts: quote.hiddenProducts } }, tx);
      });
      revalidatePath(`/app/${ctx.store.id}`, "layout");
      return success(undefined, `Changement programmé : ${PLANS[planId].name} à partir du ${sub.currentPeriodEnd?.toLocaleDateString("fr-FR") ?? "prochain renouvellement"}.`);
    }

    // Montée ou démarrage payant : impossible tant qu'une facture d'abonnement est échue (sinon on effacerait la dette).
    if (sub && planId !== "FREE") {
      const overdue = await db.invoice.findMany({ where: { subscriptionId: sub.id, status: "OPEN", dueAt: { lt: now } }, orderBy: { dueAt: "asc" } });
      const notDebt = await nonDebtInvoiceIds(overdue.map((o) => o.id));
      const debt = overdue.find((o) => !notDebt.has(o.id));
      if (debt) return fail(`Réglez d'abord la facture ${debt.number} (échue le ${debt.dueAt.toLocaleDateString("fr-FR")}) pour changer de plan.`);
    }

    // Passage immédiat au plan Gratuit (essai, ou aucune période payée en cours)
    if (planId === "FREE") {
      await db.$transaction(async (tx) => {
        const s = await tx.subscription.upsert({
          where: { storeId: ctx.store.id },
          create: { storeId: ctx.store.id, planId: "FREE", status: "ACTIVE", interval: "MONTHLY", zone, currency, currentPeriodStart: now, currentPeriodEnd: null },
          update: { planId: "FREE", status: "ACTIVE", interval: "MONTHLY", trialEndsAt: null, currentPeriodStart: now, currentPeriodEnd: null, cancelAtPeriodEnd: false },
        });
        await voidReplacedPlanInvoices(tx, s.id);
        await hideProductsOverLimit(ctx.store.id, "FREE", tx, ctx.user.id);
        await enqueue("subscription.changed", { storeId: ctx.store.id, from, to: "FREE" }, { storeId: ctx.store.id }, tx);
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "subscription.changed", metadata: { from, to: "FREE" } }, tx);
      });
      revalidatePath(`/app/${ctx.store.id}`, "layout");
      return success(undefined, "Vous êtes passé au plan Gratuit. Vos données sont conservées.");
    }

    // Montée (avec prorata) ou démarrage d'un plan payant : facture OPEN uniquement.
    // Rien ne change sur l'abonnement avant la confirmation du paiement (B2).
    let invoiceId: string;
    try {
    invoiceId = await db.$transaction(async (tx) => {
      const s = await tx.subscription.upsert({
        where: { storeId: ctx.store.id },
        create: { storeId: ctx.store.id, planId: "FREE", status: "ACTIVE", interval: "MONTHLY", zone, currency, currentPeriodStart: now, currentPeriodEnd: null },
        update: {},
      });
      // Une demande de changement précédente non réglée est remplacée (jamais un renouvellement ; une demande de changement n'est pas une dette).
      const previous = await pendingPlanChange(s.id, tx);
      if (previous) await tx.invoice.updateMany({ where: { id: previous.id, status: "OPEN" }, data: { status: "VOID" } });
      if (code) {
        const r = await redeemCoupon(tx, { code, storeId: ctx.store.id, zone, planId, actorId: ctx.user.id });
        if (!r.ok) throw new CouponError(COUPON_PUBLIC_ERROR);
      }
      const inv = await issuePlanInvoice(tx, {
        subscriptionId: s.id,
        planId,
        zone,
        interval,
        periodStart: now,
        credit: quote.kind === "upgrade" ? quote.credit : 0,
        creditNote: from ? `Temps restant sur le plan ${PLANS[from as PlanId].name}.` : undefined,
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: CHANGE_REQUESTED_ACTION, target: inv.id, metadata: { from, to: planId, interval, invoice: inv.number, credit: quote.kind === "upgrade" ? quote.credit : 0, kind: quote.kind, replaced: previous?.number ?? null, coupon: code || null } }, tx);
      // Crédit de prorata couvrant tout le montant : rien à payer, le plan s'applique tout de suite.
      if (inv.amount === 0) await confirmInvoicePayment(inv.id, { via: "zero_amount", actorId: ctx.user.id }, tx);
      return inv.id;
    });
    } catch (e) {
      if (e instanceof CouponError) return fail(e.message, { couponCode: [e.message] });
      throw e;
    }
    revalidatePath(`/app/${ctx.store.id}`, "layout");
    redirect(`/app/${ctx.store.id}/abonnement/factures/${invoiceId}`);
  });
}

/** Annule une descente ou une résiliation programmée : l'abonnement continue sur le plan actuel. */
export async function cancelScheduledChange(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "billing.manage");
    const sub = ctx.store.subscription;
    if (!sub?.cancelAtPeriodEnd) return fail("Aucun changement programmé.");
    await db.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
      // Une facture de renouvellement émise pour le plan cible est remplacée (réémise pour le plan actuel à J-3).
      if (sub.currentPeriodEnd) await voidReplacedPlanInvoices(tx, sub.id, new Date(sub.currentPeriodEnd.getTime() - 86_400_000));
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "subscription.downgrade_cancelled" }, tx);
    });
    revalidatePath(`/app/${ctx.store.id}`, "layout");
    return success(undefined, `Changement annulé : vous restez sur le plan ${PLANS[sub.planId as PlanId].name}.`);
  });
}

/** Résiliation en fin de période (= descente programmée vers Gratuit) ou reprise. */
export async function setCancelAtPeriodEnd(storeId: string, cancel: boolean): Promise<ActionResult> {
  if (!cancel) return cancelScheduledChange(storeId);
  return guard(async () => {
    const ctx = await requireStore(storeId, "billing.manage");
    const sub = ctx.store.subscription;
    if (!sub || sub.planId === "FREE") return fail("Aucun abonnement payant à résilier.");
    return changePlan(storeId, "FREE", "MONTHLY");
  });
}

/** Mode manuel : le marchand déclare avoir payé → ticket pour l'admin. */
export async function declareInvoicePaid(storeId: string, invoiceId: string, reference?: string): Promise<ActionResult> {
  return guard(async () => {
    const ref = z.string().trim().max(80).optional().safeParse(reference);
    if (!ref.success) return fail("Référence trop longue (80 caractères maximum).");
    const ctx = await requireStore(storeId, "billing.manage");
    const inv = await db.invoice.findFirst({ where: { id: invoiceId, subscription: { storeId: ctx.store.id } } });
    if (!inv) return fail("Facture introuvable.");
    if (inv.status === "PAID") return success(undefined, "Cette facture est déjà réglée.");
    if (inv.status === "VOID") return fail("Cette facture a été annulée.");
    const recent = await db.supportTicket.findFirst({ where: { storeId: ctx.store.id, subject: { startsWith: `Paiement facture ${inv.number}` }, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent) return fail("Votre déclaration a déjà été transmise il y a moins d'une heure. Nous la traitons sous 24 h ouvrées.");
    await db.supportTicket.create({
      data: {
        storeId: ctx.store.id,
        userId: ctx.user.id,
        email: ctx.user.email,
        subject: `Paiement facture ${inv.number} : ${ctx.store.name}`,
        message: `Le marchand déclare avoir réglé la facture ${inv.number} (${inv.amount} ${inv.currency}, plan ${inv.planId}).\nRéférence de transaction indiquée : ${ref.data || "non fournie"}.\nÀ vérifier puis marquer la facture comme payée dans /admin (confirmInvoicePayment).`,
      },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "invoice.payment_declared", target: inv.id, metadata: { reference: ref.data ?? null } });
    revalidatePath(`/app/${ctx.store.id}/abonnement/factures/${inv.id}`);
    return success(undefined, "Merci. Nous vérifions le paiement et activons la facture sous 24 h ouvrées.");
  });
}

/** Paiement en ligne : redirection vers le fournisseur de la zone (point d'intégration). */
export async function payInvoiceOnline(storeId: string, invoiceId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "billing.manage");
    const inv = await db.invoice.findFirst({ where: { id: invoiceId, subscription: { storeId: ctx.store.id } } });
    if (!inv) return fail("Facture introuvable.");
    if (inv.status === "PAID") return fail("Cette facture est déjà réglée.");
    if (inv.status === "VOID") return fail("Cette facture a été annulée.");
    // Le fournisseur suit la devise de la facture (figée à l'émission), pas la devise de la boutique.
    const zone = zoneForCurrency(inv.currency);
    // Session précédente déjà réglée (webhook en retard) : on confirme au lieu d'en ouvrir une seconde.
    if (inv.providerRef) {
      const prev = await fetchPlatformStatus(platformProviderFor(zone), inv.providerRef);
      if (prev === "CONFIRMED") {
        const r = await confirmInvoicePayment(inv.id, { via: "system", providerRef: inv.providerRef });
        revalidatePath(`/app/${ctx.store.id}`, "layout");
        return r.ok ? success(undefined, "Paiement déjà reçu : la facture est réglée.") : fail(r.error ?? "Paiement à vérifier par le support.");
      }
    }
    const base = `${SITE.url}/app/${ctx.store.id}/abonnement/factures/${inv.id}`;
    const lines = await invoiceLines(inv);
    const r = await createPlatformCheckout(
      inv,
      { zone, storeName: ctx.store.name, email: ctx.user.email, phone: ctx.store.whatsappNumber, label: lines[0]?.label ?? `Plan ${PLANS[inv.planId as PlanId].name}` },
      { returnUrl: `${base}?retour=1`, cancelUrl: base },
    );
    if (!r.ok) return fail(r.error);
    await db.invoice.update({ where: { id: inv.id }, data: { providerRef: r.providerRef } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "invoice.checkout_started", target: inv.id, metadata: { provider: platformProviderFor(zone), providerRef: r.providerRef } });
    redirect(r.redirectUrl);
  });
}
