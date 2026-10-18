import "server-only";
import type { Subscription } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PAST_DUE_GRACE_DAYS, RENEWAL_LINK_DAYS_BEFORE, PLANS, getAddOn, type Interval, type PlanId, type PricingZone } from "@/config/plans";
import { SITE } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { enqueue, queueNotification } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { CHANGE_REQUESTED_ACTION, DAY_MS, changeInvoiceIds, createAddOnOrder, getScheduledChange, hideProductsOverLimit, issuePlanInvoice, nonDebtInvoiceIds } from "./service";
import { billingZone, graceEndsAt } from "./rules";
import { migrateLegacyFreeSubscription, migrateLegacyFreeSubscriptions, reconcileStorePause, sendTrialReminderIfDue, syncCoveredSubscription, syncCoveredSubscriptions } from "./pause";

/**
 * Cycle de vie de la facturation (à exécuter régulièrement) :
 *  0. abonnement Gratuit hérité → nouvel essai (migration idempotente, src/lib/billing/pause.ts) ;
 *  1. rappels J-3 / J-1 avant la fin d'essai, puis fin d'essai sans plan payant → abonnement PAUSED et
 *     boutique EN PAUSE (vitrine fermée, rien n'est supprimé, reprise automatique au paiement) ;
 *  2. lien de renouvellement : facture émise RENEWAL_LINK_DAYS_BEFORE (3) jours avant l'échéance et
 *     envoyée par e-mail (pas de prélèvement automatique en Mobile Money) ;
 *  3. changement programmé (descente / résiliation) appliqué à currentPeriodEnd ;
 *  4. impayés : PAST_DUE dès l'échéance dépassée, SUSPENDED après PAST_DUE_GRACE_DAYS (7) jours
 *     (boutique en pause, données conservées) ;
 *  6. en fin de synchronisation : pause / reprise de la boutique alignée sur l'abonnement (reconcileStorePause),
 *     puis recopie vers les boutiques supplémentaires couvertes par cet abonnement.
 *  5. options : expiration des options échues, facture de renouvellement des options mensuelles/annuelles.
 *
 * POINT D'INTÉGRATION : runBillingLifecycle() doit être appelée par le cron (ex. /api/jobs/run, toutes
 * les heures). En attendant, syncStoreBilling(storeId) est appelée à l'ouverture des pages Abonnement,
 * Options et Facture pour garder la boutique courante à jour.
 */

async function ownerEmail(storeId: string, tx: Tx | typeof db = db): Promise<string | null> {
  const store = await tx.store.findUnique({ where: { id: storeId }, select: { contactEmail: true } });
  if (store?.contactEmail) return store.contactEmail;
  const owner = await tx.membership.findFirst({ where: { storeId, role: "OWNER" }, include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } });
  return owner?.user.email ?? null;
}

async function planInvoiceForPeriod(sub: Subscription, periodStart: Date, tx: Tx) {
  const candidates = await tx.invoice.findMany({ where: { subscriptionId: sub.id, status: { not: "VOID" }, periodStart: { gte: new Date(periodStart.getTime() - DAY_MS) } } });
  // Ni facture d'option, ni demande de changement de plan : uniquement un renouvellement.
  const excluded = await nonDebtInvoiceIds(candidates.map((c) => c.id), tx);
  return candidates.find((c) => !excluded.has(c.id)) ?? null;
}

/** Synchronise une boutique (idempotent, sûr à appeler à chaque affichage). */
export async function syncStoreBilling(storeId: string, now = new Date()): Promise<void> {
  const sub = await db.subscription.findUnique({ where: { storeId } });
  if (sub) await syncSubscription(sub, now);
  await syncAddOns(storeId, now);
}

export async function syncSubscription(sub: Subscription, now = new Date()): Promise<void> {
  // Boutique supplémentaire : aucun cycle propre, l'état suit l'abonnement de la boutique principale.
  if (sub.coveredBySubscriptionId) return syncCoveredSubscription(sub, now);
  if (await migrateLegacyFreeSubscription(sub, now)) return;
  await syncSubscriptionSteps(sub, now);
  await db.$transaction(async (tx) => {
    await reconcileStorePause(tx, sub.storeId, now);
    await syncCoveredSubscriptions(sub.id, tx, now);
  });
}

async function syncSubscriptionSteps(sub: Subscription, now: Date): Promise<void> {
  const zone: PricingZone = billingZone(sub, sub.currency);

  // 0. Demandes de changement de plan non réglées à l'échéance : expirées (VOID). Le plan en cours
  //    n'a jamais changé, il n'y a donc ni dette ni suspension liée à ces factures.
  const openRows = await db.invoice.findMany({ where: { subscriptionId: sub.id, status: "OPEN", dueAt: { lt: now } }, select: { id: true, number: true } });
  const expiredChanges = await changeInvoiceIds(openRows.map((r) => r.id));
  for (const r of openRows.filter((o) => expiredChanges.has(o.id))) {
    await db.$transaction(async (tx) => {
      const v = await tx.invoice.updateMany({ where: { id: r.id, status: "OPEN" }, data: { status: "VOID" } });
      if (v.count) await audit({ storeId: sub.storeId, action: "subscription.change_expired", target: r.id, metadata: { number: r.number, marker: CHANGE_REQUESTED_ACTION } }, tx);
    });
  }

  // 1. Rappels J-3 / J-1, puis fin d'essai sans plan payant → pause (aucun produit masqué, rien n'est supprimé ;
  //    trialEndsAt est conservé pour l'affichage « essai terminé le … »).
  if (sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt > now) {
    await sendTrialReminderIfDue(sub, now);
    return;
  }
  if (sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt <= now) {
    await db.$transaction(async (tx) => {
      const locked = await tx.subscription.updateMany({ where: { id: sub.id, status: "TRIALING" }, data: { planId: "FREE", status: "PAUSED", interval: "MONTHLY", pausedAt: now, currentPeriodStart: now, currentPeriodEnd: null, cancelAtPeriodEnd: false } });
      if (locked.count === 0) return;
      await audit({ storeId: sub.storeId, action: "subscription.trial_ended", metadata: { from: sub.planId, to: "PAUSED" } }, tx);
      await enqueue("subscription.changed", { storeId: sub.storeId, from: sub.planId, to: "FREE", status: "PAUSED", reason: "trial_ended" }, { storeId: sub.storeId }, tx);
    });
    return;
  }
  if (sub.planId === "FREE" || !sub.currentPeriodEnd) return;
  const end = sub.currentPeriodEnd;
  const scheduled = await getScheduledChange(sub);

  // 2. Lien de renouvellement (J-3)
  if ((sub.status === "ACTIVE" || sub.status === "PAST_DUE") && end.getTime() - now.getTime() <= RENEWAL_LINK_DAYS_BEFORE * DAY_MS && end > new Date(now.getTime() - PAST_DUE_GRACE_DAYS * DAY_MS)) {
    const target: { planId: PlanId; interval: Interval } = scheduled ? { planId: scheduled.to, interval: scheduled.interval } : { planId: sub.planId as PlanId, interval: sub.interval as Interval };
    if (target.planId !== "FREE" && target.planId !== "ENTERPRISE") {
      const created = await db.$transaction(async (tx) => {
        if (await planInvoiceForPeriod(sub, end, tx)) return null;
        const inv = await issuePlanInvoice(tx, { subscriptionId: sub.id, planId: target.planId, zone, interval: target.interval, periodStart: end, dueAt: end });
        await audit({ storeId: sub.storeId, action: "invoice.renewal_issued", target: inv.id, metadata: { number: inv.number, planId: target.planId } }, tx);
        return inv;
      });
      if (created) {
        const to = await ownerEmail(sub.storeId);
        if (to) {
          const link = `${SITE.url}/app/${sub.storeId}/abonnement/factures/${created.id}`;
          await queueNotification(sub.storeId, "email", to, "billing.renewal_link", {
            subject: `Renouvellement ${SITE.name} : facture ${created.number}`,
            text: `Bonjour,\n\nVotre abonnement ${PLANS[target.planId].name} arrive à échéance le ${formatDate(end)}.\nMontant : ${formatMoney(created.amount, created.currency)}.\n\nPayez en un clic (Mobile Money ou carte) : ${link}\n\nSans paiement, vos fonctions payantes restent actives ${PAST_DUE_GRACE_DAYS} jours après l'échéance, puis sont suspendues. Vos données sont toujours conservées.\n\nL'équipe ${SITE.name}`,
          });
          await enqueue("notification.send", {}, { storeId: sub.storeId });
        }
      }
    }
  }

  // 3. Changement programmé à l'échéance
  if (scheduled && end <= now) {
    await db.$transaction(async (tx) => {
      const locked = await tx.subscription.updateMany({ where: { id: sub.id, cancelAtPeriodEnd: true, currentPeriodEnd: end }, data: { cancelAtPeriodEnd: false } });
      if (locked.count === 0) return;
      if (scheduled.to === "FREE") {
        // Résiliation arrivée à échéance : plus de plan Gratuit, la boutique passe en pause (reconcileStorePause).
        await tx.subscription.update({ where: { id: sub.id }, data: { planId: "FREE", status: "PAUSED", pausedAt: now, trialEndsAt: null, interval: "MONTHLY", currentPeriodStart: end, currentPeriodEnd: null } });
      } else {
        const inv = await planInvoiceForPeriod(sub, end, tx);
        const paid = inv?.status === "PAID";
        // Période prolongée UNIQUEMENT si la facture de renouvellement est payée. Sinon la période
        // reste échue à `end` : la grâce court depuis l'échéance de la facture (dueAt = end), puis pause.
        await tx.subscription.update({
          where: { id: sub.id },
          data: paid
            ? { planId: scheduled.to, interval: scheduled.interval, currentPeriodStart: end, currentPeriodEnd: inv!.periodEnd, status: "ACTIVE" }
            : { planId: scheduled.to, interval: scheduled.interval, currentPeriodStart: end, currentPeriodEnd: end, status: end < now ? "PAST_DUE" : "ACTIVE" },
        });
        if (!inv) await issuePlanInvoice(tx, { subscriptionId: sub.id, planId: scheduled.to, zone, interval: scheduled.interval, periodStart: end, dueAt: end });
      }
      const hidden = scheduled.to === "FREE" ? [] : await hideProductsOverLimit(sub.storeId, scheduled.to, tx);
      await audit({ storeId: sub.storeId, action: "subscription.downgrade_applied", metadata: { from: sub.planId, to: scheduled.to, interval: scheduled.interval, hiddenProducts: hidden.length } }, tx);
      await enqueue("subscription.changed", { storeId: sub.storeId, from: sub.planId, to: scheduled.to, reason: "scheduled" }, { storeId: sub.storeId }, tx);
    });
    return;
  }

  // 3 bis. Échéance sans changement programmé : bascule sur la période déjà payée (renouvellement anticipé)
  if (!scheduled && end <= now) {
    await db.$transaction(async (tx) => {
      const inv = await planInvoiceForPeriod(sub, end, tx);
      if (inv?.status !== "PAID") return;
      const yearly = inv.periodEnd.getTime() - inv.periodStart.getTime() > 200 * DAY_MS;
      await tx.subscription.updateMany({ where: { id: sub.id, currentPeriodEnd: end }, data: { planId: inv.planId, interval: yearly ? "YEARLY" : "MONTHLY", currentPeriodStart: inv.periodStart, currentPeriodEnd: inv.periodEnd, status: "ACTIVE" } });
    });
  }

  // 4. Impayés : retard puis suspension après la période de grâce
  const overdue = await db.invoice.findMany({ where: { subscriptionId: sub.id, status: "OPEN", dueAt: { lt: now } }, orderBy: { dueAt: "asc" } });
  const notDebt = await nonDebtInvoiceIds(overdue.map((o) => o.id));
  const planOverdue = overdue.filter((o) => !notDebt.has(o.id));
  if (planOverdue.length > 0) {
    const oldest = planOverdue[0];
    // Grâce calculée depuis l'échéance de la facture impayée (jamais depuis une période prolongée).
    const graceOver = graceEndsAt(oldest).getTime() < now.getTime();
    // Revérifié dans la transaction : un paiement confirmé entre-temps n'est jamais écrasé.
    await db.$transaction(async (tx) => {
      const still = await tx.invoice.count({ where: { id: oldest.id, status: "OPEN" } });
      if (!still) return;
      const r = await tx.subscription.updateMany({
        where: { id: sub.id, status: { in: graceOver ? ["ACTIVE", "PAST_DUE"] : ["ACTIVE"] } },
        data: { status: graceOver ? "SUSPENDED" : "PAST_DUE" },
      });
      if (r.count === 0) return;
      await audit({ storeId: sub.storeId, action: graceOver ? "subscription.suspended_unpaid" : "subscription.past_due", target: oldest.id, metadata: { number: oldest.number } }, tx);
      if (graceOver) await enqueue("subscription.changed", { storeId: sub.storeId, status: "SUSPENDED", invoiceId: oldest.id }, { storeId: sub.storeId }, tx);
    });
  }
}

/** Options : expiration et facture de renouvellement (J-3) des options récurrentes non résiliées. */
export async function syncAddOns(storeId: string, now = new Date()): Promise<void> {
  await db.addOnPurchase.updateMany({ where: { storeId, status: { in: ["ACTIVE", "CANCELLED"] }, endsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const soon = new Date(now.getTime() + RENEWAL_LINK_DAYS_BEFORE * DAY_MS);
  const due = await db.addOnPurchase.findMany({ where: { storeId, status: "ACTIVE", endsAt: { gt: now, lte: soon } } });
  if (due.length === 0) return;
  const sub = await db.subscription.findUnique({ where: { storeId } });
  if (!sub) return;
  for (const p of due) {
    const addOn = getAddOn(p.addOnId);
    if (!addOn || (addOn.billing !== "MONTHLY" && addOn.billing !== "YEARLY")) continue;
    if (!addOn.plans.includes(sub.planId as PlanId)) continue; // plus éligible : l'option expire simplement
    await db.$transaction(async (tx) => {
      const pending = await tx.addOnPurchase.findFirst({ where: { storeId, addOnId: p.addOnId, status: { in: ["PENDING", "ACTIVE"] }, startsAt: { gte: p.endsAt! }, id: { not: p.id } } });
      if (pending) return;
      const zone = (sub.zone === "AFRICA" ? "AFRICA" : "WORLD") as PricingZone;
      const { invoice } = await createAddOnOrder(tx, { storeId, subscriptionId: sub.id, planId: sub.planId as PlanId, addOnId: p.addOnId, quantity: p.quantity, zone, startsAt: p.endsAt! });
      await audit({ storeId, action: "addon.renewal_issued", target: invoice.id, metadata: { addOnId: p.addOnId, number: invoice.number } }, tx);
    });
  }
}

/**
 * Boutiques couvertes (option « Boutique en plus ») dont l'état diverge de l'abonnement principal, ou orphelines
 * non encore en pause : seules celles-ci sont resynchronisées par le cron.
 */
export async function divergentCoveredSubscriptionIds(limit = 500): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "Subscription" c
    LEFT JOIN "Subscription" p ON p.id = c."coveredBySubscriptionId"
    WHERE c."coveredBySubscriptionId" IS NOT NULL
      AND ((p.id IS NULL AND c.status <> 'PAUSED')
        OR (p.id IS NOT NULL AND (c."planId", c.status, c."trialEndsAt", c."currentPeriodEnd") IS DISTINCT FROM (p."planId", p.status, p."trialEndsAt", p."currentPeriodEnd")))
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/** Point d'entrée du cron : toutes les boutiques concernées. */
export async function runBillingLifecycle(now = new Date()): Promise<{ subscriptions: number; stores: number; legacyFreeMigrated: number }> {
  const horizon = new Date(now.getTime() + RENEWAL_LINK_DAYS_BEFORE * DAY_MS);
  // 0. Abonnements Gratuits hérités : nouvel essai (idempotent ; aussi lancé par `pnpm billing:migrate-free`).
  const legacy = await migrateLegacyFreeSubscriptions(now).catch((e) => {
    console.error("[billing] migrate free", e);
    return { scanned: 0, migrated: 0 };
  });
  const divergentCovered = await divergentCoveredSubscriptionIds();
  const subs = await db.subscription.findMany({
    where: {
      OR: [
        // Fin d'essai ET rappels J-3 / J-1 (horizon = 3 jours).
        { status: "TRIALING", trialEndsAt: { lte: horizon } },
        // Pause à appliquer (sans plan, impayé) ou à lever (plan de nouveau actif), boutiques couvertes.
        { status: { in: ["PAUSED", "SUSPENDED", "CANCELLED"] }, store: { status: { in: ["DRAFT", "PUBLISHED", "CLOSED_TEMPORARILY"] } } },
        { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] }, store: { status: "PAUSED" } },
        // Boutiques couvertes dont l'état diverge de l'abonnement principal (ou orphelines) uniquement.
        ...(divergentCovered.length ? [{ id: { in: divergentCovered } }] : []),
        { planId: { not: "FREE" }, currentPeriodEnd: { lte: horizon } },
        { status: { in: ["ACTIVE", "PAST_DUE", "TRIALING"] }, invoices: { some: { status: "OPEN", dueAt: { lt: now } } } },
      ],
    },
    take: 500,
  });
  for (const s of subs) {
    try {
      await syncSubscription(s, now);
    } catch (e) {
      console.error("[billing] sync", s.id, e);
    }
  }
  const addonStores = await db.addOnPurchase.findMany({ where: { status: { in: ["ACTIVE", "CANCELLED"] }, endsAt: { lte: horizon } }, select: { storeId: true }, distinct: ["storeId"], take: 500 });
  for (const a of addonStores) {
    try {
      await syncAddOns(a.storeId, now);
    } catch (e) {
      console.error("[billing] addons", a.storeId, e);
    }
  }
  // Phase D : fin d'essai des abonnements d'app (trialing → active), même cadence de cron.
  await (await import("@/lib/apps/billing-lifecycle")).runAppBillingLifecycle(now).catch((e) => console.error("[billing] apps", e));
  await (await import("@/lib/domains/lifecycle")).runDomainLifecycle(now).catch((e) => console.error("[billing] domains", e));
  return { subscriptions: subs.length, stores: addonStores.length, legacyFreeMigrated: legacy.migrated };
}
