import "server-only";
import type { Invoice, Subscription } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS, PLAN_ORDER, getAddOn, type Interval, type PlanId, type PricingZone } from "@/config/plans";
import { addDays, addMonths } from "@/lib/utils";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { activateAddOnPurchase } from "@/lib/addons/service";
import { changeDirection, periodEndFor, prorationCredit } from "./proration";
import { effectivePlanId, planPaymentDecision } from "./rules";
import { getEffectiveAddOnPrice, getEffectivePlanPriceFor } from "@/lib/pricing/catalog";
import { INVOICE_DISCOUNT_ACTION, couponForNextInvoice } from "@/lib/pricing/coupons";
import { couponDiscount } from "@/lib/pricing/rules";

export { changeDirection, periodEndFor, prorationCredit };

/** Marqueur d'une facture émise par un changement de plan (montée / démarrage), posé par changePlan. */
export const CHANGE_REQUESTED_ACTION = "subscription.change_requested";

/** La facture a-t-elle été émise par un changement de plan (et non par un renouvellement) ? */
export async function isPlanChangeInvoice(invoiceId: string, tx: Tx | typeof db = db): Promise<boolean> {
  const marker = await tx.auditLog.findFirst({ where: { action: CHANGE_REQUESTED_ACTION, target: invoiceId }, select: { id: true } });
  return !!marker;
}

/** Changement de plan en attente de paiement (facture OPEN émise par changePlan), ou null. */
export async function pendingPlanChange(subscriptionId: string, tx: Tx | typeof db = db): Promise<Invoice | null> {
  const open = await tx.invoice.findMany({ where: { subscriptionId, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 10 });
  if (open.length === 0) return null;
  const markers = await tx.auditLog.findMany({ where: { action: CHANGE_REQUESTED_ACTION, target: { in: open.map((o) => o.id) } }, select: { target: true } });
  const ids = new Set(markers.map((m) => m.target));
  return open.find((o) => ids.has(o.id)) ?? null;
}

/**
 * Facturation SaaS V4 (cahier des charges §21) : règles métier pures + écritures transactionnelles.
 *
 * Règles :
 *  - Montée en gamme (plan supérieur, ou mensuel → annuel) : facture OPEN marquée
 *    `subscription.change_requested` ; l'abonnement garde son plan jusqu'au paiement, puis la nouvelle
 *    période démarre à la confirmation (confirmInvoicePayment). Le temps restant de la période payée est
 *    crédité sur la facture (prorata en unités entières, arrondi à l'inférieur). Non réglée à
 *    l'échéance (7 j), la demande expire (VOID) sans dette ni suspension.
 *  - Descente (plan inférieur, annuel → mensuel, ou Gratuit) : EN FIN DE PÉRIODE. L'abonnement garde
 *    le plan courant jusqu'à currentPeriodEnd. Pas de champ dédié dans le schéma : on pose
 *    `cancelAtPeriodEnd = true` et on journalise `subscription.downgrade_scheduled` (AuditLog,
 *    metadata { to, interval, effectiveAt }). Sans cet événement, cancelAtPeriodEnd signifie « passage
 *    au plan Gratuit ». L'application a lieu dans applyScheduledChange() (lifecycle.ts).
 *  - Lors d'une descente, les produits au-delà de la limite du nouveau plan passent en brouillon
 *    (DRAFT, jamais supprimés) ; la liste est journalisée (`subscription.products_hidden`).
 *  - Factures numérotées AXI-{AAAA}-{000001}, montants en unités natives (EUR centimes, XOF entier).
 */

export const DAY_MS = 86_400_000;

/** Numéro de facture séquentiel AXI-{YYYY}-{000001} (à appeler dans une transaction). */
export async function nextInvoiceNumber(tx: Tx | typeof db, year = new Date().getFullYear()): Promise<string> {
  // Verrou transactionnel PostgreSQL : sérialise la numérotation (pas de collision entre cron, pages et actions).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(724201)`;
  // Seuls les suffixes numériques comptent (les chiffres se trient avant les lettres : borne « < A »).
  const prefix = `AXI-${year}-`;
  const last = await tx.invoice.findFirst({ where: { number: { startsWith: prefix, lt: `${prefix}A` } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? Number(last.number.split("-")[2]) || 0 : 0;
  return `AXI-${year}-${String(n + 1).padStart(6, "0")}`;
}

/** Factures d'options (liées à un AddOnPurchase) : ne modifient jamais l'abonnement. */
export async function addOnInvoiceIds(invoiceIds: string[], tx: Tx | typeof db = db): Promise<Set<string>> {
  if (invoiceIds.length === 0) return new Set();
  const rows = await tx.addOnPurchase.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { invoiceId: true } });
  return new Set(rows.map((r) => r.invoiceId!).filter(Boolean));
}

/** Factures émises par une demande de changement de plan (marqueur CHANGE_REQUESTED_ACTION). */
export async function changeInvoiceIds(invoiceIds: string[], tx: Tx | typeof db = db): Promise<Set<string>> {
  if (invoiceIds.length === 0) return new Set();
  const rows = await tx.auditLog.findMany({ where: { action: CHANGE_REQUESTED_ACTION, target: { in: invoiceIds } }, select: { target: true } });
  return new Set(rows.map((r) => r.target!).filter(Boolean));
}

/**
 * Factures qui ne constituent PAS une dette d'abonnement : options, et demandes de changement de plan
 * non réglées (le service n'a jamais été rendu ; elles expirent, sans suspendre le plan en cours).
 */
export async function nonDebtInvoiceIds(invoiceIds: string[], tx: Tx | typeof db = db): Promise<Set<string>> {
  const [a, c] = await Promise.all([addOnInvoiceIds(invoiceIds, tx), changeInvoiceIds(invoiceIds, tx)]);
  return new Set([...a, ...c]);
}

/** Dernière facture d'abonnement PAYÉE couvrant `now` (base du prorata). */
export async function paidPlanInvoiceCovering(subscriptionId: string, now = new Date(), tx: Tx | typeof db = db): Promise<Invoice | null> {
  const candidates = await tx.invoice.findMany({ where: { subscriptionId, status: "PAID", periodStart: { lte: now }, periodEnd: { gt: now } }, orderBy: { createdAt: "desc" }, take: 5 });
  const addons = await addOnInvoiceIds(candidates.map((c) => c.id), tx);
  return candidates.find((c) => !addons.has(c.id)) ?? null;
}

/* ───────────────────────── Changement programmé ───────────────────────── */

export type ScheduledChange = { to: PlanId; interval: Interval; effectiveAt: Date | null };

/** Changement programmé en fin de période (descente ou résiliation), ou null. */
export async function getScheduledChange(sub: Subscription | null, tx: Tx | typeof db = db): Promise<ScheduledChange | null> {
  if (!sub || !sub.cancelAtPeriodEnd) return null;
  const last = await tx.auditLog.findFirst({
    where: { storeId: sub.storeId, action: { in: ["subscription.downgrade_scheduled", "subscription.cancel_scheduled", "subscription.changed", "subscription.cancel_reverted", "subscription.downgrade_cancelled"] } },
    orderBy: { createdAt: "desc" },
  });
  if (last?.action === "subscription.downgrade_scheduled") {
    const m = (last.metadata ?? {}) as { to?: PlanId; interval?: Interval };
    if (m.to && PLANS[m.to]) return { to: m.to, interval: m.interval ?? "MONTHLY", effectiveAt: sub.currentPeriodEnd };
  }
  return { to: "FREE", interval: "MONTHLY", effectiveAt: sub.currentPeriodEnd };
}

/* ───────────────────────── Produits au-delà de la limite ───────────────────────── */

/** Produits actifs qui seraient masqués sous un plan donné (les mieux placés sont conservés). */
export async function productsOverLimit(storeId: string, planId: PlanId, tx: Tx | typeof db = db) {
  const limit = PLANS[planId].limits.products;
  if (limit == null) return [];
  const active = await tx.product.findMany({
    where: { storeId, status: "ACTIVE" },
    orderBy: [{ isFeatured: "desc" }, { position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
  return active.slice(limit);
}

/** Passe en brouillon les produits au-delà de la limite. Jamais de suppression. */
export async function hideProductsOverLimit(storeId: string, planId: PlanId, tx: Tx, actorId?: string | null) {
  const extra = await productsOverLimit(storeId, planId, tx);
  if (extra.length === 0) return [];
  await tx.product.updateMany({ where: { storeId, id: { in: extra.map((p) => p.id) } }, data: { status: "DRAFT" } });
  await audit({ storeId, actorId: actorId ?? null, action: "subscription.products_hidden", metadata: { planId, count: extra.length, products: extra.map((p) => ({ id: p.id, name: p.name })) } }, tx);
  return extra;
}

/* ───────────────────────── Confirmation de paiement ───────────────────────── */

export type ConfirmSource = { providerRef?: string | null; actorId?: string | null; via: "admin" | "webhook" | "zero_amount" | "system" };

/**
 * Chemin UNIQUE de confirmation d'une facture (admin, webhook signé, facture à 0).
 * - Facture d'option (AddOnPurchase.invoiceId) : active l'option (et crédite le portefeuille pour un pack).
 * - Facture d'abonnement : abonnement ACTIVE sur le plan et la période de la facture. C'est le SEUL
 *   endroit qui fait passer un abonnement sur un plan payant (hors essai) : une montée en gamme
 *   n'est appliquée qu'ici (règles : planPaymentDecision, src/lib/billing/rules.ts).
 * Idempotente : une facture déjà payée ne déclenche rien.
 * Réutilisable par l'admin : `markInvoicePaid` (src/lib/admin/actions.ts) doit l'appeler.
 */
export async function confirmInvoicePayment(invoiceId: string, source: ConfirmSource, outerTx?: Tx): Promise<{ ok: boolean; already?: boolean; kind?: "addon" | "plan"; error?: string }> {
  const run = async (tx: Tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { subscription: true } });
    if (!invoice) return { ok: false, error: "Facture introuvable" };
    if (invoice.status === "PAID") return { ok: true, already: true };
    if (invoice.status === "VOID") return { ok: false, error: "Facture annulée" };
    const now = new Date();
    const locked = await tx.invoice.updateMany({ where: { id: invoice.id, status: { in: ["OPEN", "DRAFT", "UNCOLLECTIBLE"] } }, data: { status: "PAID", paidAt: now, providerRef: source.providerRef ?? invoice.providerRef } });
    if (locked.count === 0) return { ok: true, already: true };
    const sub = invoice.subscription;

    const purchases = await tx.addOnPurchase.findMany({ where: { invoiceId: invoice.id } });
    if (purchases.length > 0) {
      for (const p of purchases) await activateAddOnPurchase(p.id, tx);
      await audit({ storeId: sub.storeId, actorId: source.actorId ?? null, action: "invoice.paid", target: invoice.id, metadata: { number: invoice.number, kind: "addon", via: source.via, providerRef: source.providerRef ?? null } }, tx);
      return { ok: true, kind: "addon" as const };
    }

    const isChange = await isPlanChangeInvoice(invoice.id, tx);
    // Une ancienne facture réglée en retard ne doit pas écraser un plan plus récent.
    const addonInvoices = await tx.addOnPurchase.findMany({ where: { storeId: sub.storeId, invoiceId: { not: null } }, select: { invoiceId: true } });
    const latest = await tx.invoice.findFirst({
      where: { subscriptionId: sub.id, status: { not: "VOID" }, id: { notIn: addonInvoices.map((p) => p.invoiceId!) } },
      orderBy: { periodEnd: "desc" },
    });
    const isLatest = !latest || latest.id === invoice.id;
    const overdueRows = await tx.invoice.findMany({ where: { subscriptionId: sub.id, status: "OPEN", dueAt: { lt: now }, id: { not: invoice.id } }, select: { id: true } });
    const notDebt = await nonDebtInvoiceIds(overdueRows.map((r) => r.id), tx);
    const stillOverdue = overdueRows.filter((r) => !notDebt.has(r.id)).length > 0;
    const previousPlan = effectivePlanId(sub, now);
    const decision = planPaymentDecision({ sub, invoice, now, isChange, isLatest, stillOverdue });

    if (isChange) {
      // Montée réglée en retard : la période démarre au paiement (la facture reflète la période servie).
      if (decision.periodStart.getTime() !== invoice.periodStart.getTime()) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { periodStart: decision.periodStart, periodEnd: decision.periodEnd } });
      }
      // Les factures d'abonnement encore ouvertes et NON échues (renouvellement de l'ancien plan, autre
      // demande de changement) sont remplacées par la nouvelle période. Une dette échue reste due.
      const open = await tx.invoice.findMany({ where: { subscriptionId: sub.id, status: "OPEN", dueAt: { gte: now }, id: { not: invoice.id } }, select: { id: true } });
      const openAddons = await addOnInvoiceIds(open.map((o) => o.id), tx);
      const replaced = open.map((o) => o.id).filter((id) => !openAddons.has(id));
      if (replaced.length) await tx.invoice.updateMany({ where: { id: { in: replaced }, status: "OPEN" }, data: { status: "VOID" } });
    }
    await tx.subscription.update({ where: { id: sub.id }, data: decision.data });
    if (decision.appliedLower) {
      const hidden = await hideProductsOverLimit(sub.storeId, invoice.planId as PlanId, tx);
      await audit({ storeId: sub.storeId, action: "subscription.downgrade_applied", metadata: { from: sub.planId, to: invoice.planId, hiddenProducts: hidden.length, via: "payment" } }, tx);
    }
    if (isChange) {
      // Démarrage d'un plan inférieur au plan d'essai : produits au-delà de la limite en brouillon.
      if (PLAN_ORDER.indexOf(invoice.planId as PlanId) < PLAN_ORDER.indexOf(previousPlan)) await hideProductsOverLimit(sub.storeId, invoice.planId as PlanId, tx, source.actorId);
      await audit({ storeId: sub.storeId, actorId: source.actorId ?? null, action: "subscription.changed", target: invoice.id, metadata: { from: sub.planId, to: invoice.planId, interval: decision.interval, via: "payment", periodStart: decision.periodStart, periodEnd: decision.periodEnd } }, tx);
    }
    await enqueue("subscription.changed", { storeId: sub.storeId, subscriptionId: sub.id, planId: invoice.planId, status: "ACTIVE", invoiceId: invoice.id }, { storeId: sub.storeId }, tx);
    await audit({ storeId: sub.storeId, actorId: source.actorId ?? null, action: "invoice.paid", target: invoice.id, metadata: { number: invoice.number, kind: "plan", via: source.via, providerRef: source.providerRef ?? null, amount: invoice.amount, currency: invoice.currency } }, tx);
    return { ok: true, kind: "plan" as const };
  };
  return outerTx ? run(outerTx) : db.$transaction(run);
}

/* ───────────────────────── Émission de factures ───────────────────────── */

/**
 * Facture d'abonnement pour une période. Montant 0 → payée immédiatement.
 * Prix : catalogue effectif (surcharge /admin/tarifs sinon src/config/plans.ts), relu ici à chaque émission.
 * Ordre de calcul : brut → remise du code promo SaaS en cours (src/lib/pricing/coupons.ts) → crédit de prorata.
 */
export async function issuePlanInvoice(
  tx: Tx,
  params: { subscriptionId: string; planId: PlanId; zone: PricingZone; interval: Interval; periodStart: Date; dueAt?: Date; credit?: number; creditNote?: string },
): Promise<Invoice> {
  const { amount: grossRaw, currency } = await getEffectivePlanPriceFor(params.planId, params.zone, params.interval, tx);
  const gross = grossRaw ?? 0;
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: params.subscriptionId }, select: { storeId: true } });
  const coupon = gross > 0 ? await couponForNextInvoice(sub.storeId, params.zone, params.planId, tx) : null;
  const discount = coupon ? couponDiscount(coupon, gross) : 0;
  const credit = Math.min(params.credit ?? 0, gross - discount);
  const amount = Math.max(0, gross - discount - credit);
  const periodEnd = periodEndFor(params.periodStart, params.interval);
  const inv = await tx.invoice.create({
    data: {
      subscriptionId: params.subscriptionId,
      number: await nextInvoiceNumber(tx, params.periodStart.getFullYear()),
      planId: params.planId,
      amount,
      currency,
      status: "OPEN",
      periodStart: params.periodStart,
      periodEnd,
      dueAt: params.dueAt ?? addDays(new Date(), 7),
    },
  });
  // Détail des lignes (le modèle Invoice n'a qu'un montant) : journalisé et relu par invoiceLines.
  if (coupon && discount > 0) {
    await audit({ storeId: sub.storeId, action: INVOICE_DISCOUNT_ACTION, target: inv.id, metadata: { couponId: coupon.id, code: coupon.code, gross, discount, currency, percentOff: coupon.percentOff, amountOff: coupon.amountOff } }, tx);
  }
  if (credit > 0) {
    await audit({ storeId: sub.storeId, action: "invoice.proration", target: inv.id, metadata: { gross, credit, note: params.creditNote ?? null, currency } }, tx);
  }
  return inv;
}

/** Lignes d'une facture pour l'affichage (plan, prorata, options). */
export async function invoiceLines(invoice: Invoice, tx: Tx | typeof db = db): Promise<{ label: string; detail?: string; quantity: number; amount: number }[]> {
  const purchases = await tx.addOnPurchase.findMany({ where: { invoiceId: invoice.id } });
  if (purchases.length > 0) {
    return purchases.map((p) => {
      const a = getAddOn(p.addOnId);
      return { label: a?.name ?? p.addOnId, detail: a?.description, quantity: p.quantity, amount: p.unitPrice * p.quantity };
    });
  }
  const plan = PLANS[invoice.planId as PlanId];
  const yearly = invoice.periodEnd.getTime() - invoice.periodStart.getTime() > 200 * DAY_MS;
  const [proration, discountRow] = await Promise.all([
    tx.auditLog.findFirst({ where: { action: "invoice.proration", target: invoice.id } }),
    tx.auditLog.findFirst({ where: { action: INVOICE_DISCOUNT_ACTION, target: invoice.id } }),
  ]);
  const meta = (proration?.metadata ?? null) as { gross?: number; credit?: number; note?: string } | null;
  const disc = (discountRow?.metadata ?? null) as { gross?: number; discount?: number; code?: string; percentOff?: number | null } | null;
  const lines: { label: string; detail?: string; quantity: number; amount: number }[] = [
    { label: `Plan ${plan.name}, abonnement ${yearly ? "annuel" : "mensuel"}`, detail: yearly ? "Paiement annuel : 2 mois offerts." : plan.tagline, quantity: 1, amount: meta?.gross ?? disc?.gross ?? invoice.amount },
  ];
  if (disc?.discount) lines.push({ label: `Code promo ${disc.code ?? ""}`.trim(), detail: disc.percentOff ? `Remise de ${disc.percentOff} %.` : "Remise commerciale.", quantity: 1, amount: -disc.discount });
  if (meta?.credit) lines.push({ label: "Crédit au prorata", detail: meta.note ?? "Temps restant de la période précédente.", quantity: 1, amount: -meta.credit });
  return lines;
}

/* ───────────────────────── Options : commande + facture ───────────────────────── */

/**
 * Crée un achat d'option PENDING et sa facture OPEN (même transaction).
 * Le prix est TOUJOURS celui du catalogue serveur (zone de la boutique), jamais celui du client.
 */
export async function createAddOnOrder(
  tx: Tx,
  params: { storeId: string; subscriptionId: string; planId: PlanId; addOnId: string; quantity: number; zone: PricingZone; startsAt?: Date },
): Promise<{ purchaseId: string; invoice: Invoice }> {
  const addOn = getAddOn(params.addOnId);
  if (!addOn) throw new Error(`Option inconnue : ${params.addOnId}`);
  // Prix effectif du catalogue (surcharge /admin/tarifs sinon src/config/plans.ts), jamais celui du client.
  const unitPrice = (await getEffectiveAddOnPrice(addOn.id, params.zone, tx)).amount ?? addOn.price[params.zone];
  const currency = params.zone === "AFRICA" ? "XOF" : "EUR";
  const now = new Date();
  const start = params.startsAt ?? now;
  const periodEnd = addOn.billing === "MONTHLY" ? addMonths(start, 1) : addOn.billing === "YEARLY" ? addMonths(start, 12) : start;
  const invoice = await tx.invoice.create({
    data: {
      subscriptionId: params.subscriptionId,
      number: await nextInvoiceNumber(tx, now.getFullYear()),
      planId: params.planId,
      amount: unitPrice * params.quantity,
      currency,
      status: "OPEN",
      periodStart: start,
      periodEnd,
      dueAt: params.startsAt && params.startsAt > now ? params.startsAt : addDays(now, 7),
    },
  });
  const purchase = await tx.addOnPurchase.create({
    data: { storeId: params.storeId, addOnId: addOn.id, quantity: params.quantity, unitPrice, currency, status: "PENDING", invoiceId: invoice.id, startsAt: start },
  });
  return { purchaseId: purchase.id, invoice };
}

/* ───────────────────────── Devis de changement de plan ───────────────────────── */

export type PlanQuote = {
  planId: PlanId;
  interval: Interval;
  /** upgrade : immédiat au prorata ; downgrade : fin de période ; start : démarrage immédiat sans crédit ; same : rien à faire. */
  kind: "upgrade" | "downgrade" | "start" | "same" | "contact";
  gross: number;
  credit: number;
  amount: number;
  currency: string;
  effectiveAt: Date | null;
  hiddenProducts: number;
};

/** Le plan courant a-t-il une période payée en cours (sinon tout changement est immédiat) ? */
export function hasRunningPaidPeriod(sub: Subscription | null, now = new Date()): boolean {
  return !!sub && sub.planId !== "FREE" && (sub.status === "ACTIVE" || sub.status === "PAST_DUE") && !!sub.currentPeriodEnd && sub.currentPeriodEnd > now;
}

/** Devis serveur (même calcul pour l'affichage et pour l'action). */
export async function quotePlanChange(storeId: string, sub: Subscription | null, zone: PricingZone, planId: PlanId, interval: Interval, now = new Date(), tx: Tx | typeof db = db): Promise<PlanQuote> {
  const { amount: gross, currency } = await getEffectivePlanPriceFor(planId, zone, interval, tx);
  const base = { planId, interval, gross: gross ?? 0, credit: 0, amount: gross ?? 0, currency, effectiveAt: now as Date | null, hiddenProducts: 0 };
  if (planId === "ENTERPRISE") return { ...base, kind: "contact" };
  const trialing = sub?.status === "TRIALING" && !!sub.trialEndsAt && sub.trialEndsAt > now;
  const current = { planId: (sub?.planId ?? "FREE") as PlanId, interval: (sub?.interval ?? "MONTHLY") as Interval };
  const dir = changeDirection(current, { planId, interval });
  const hidden = PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(current.planId) || trialing ? (await productsOverLimit(storeId, planId, tx)).length : 0;
  if (!trialing && dir === 0 && sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) return { ...base, kind: "same", amount: 0 };
  const running = !trialing && hasRunningPaidPeriod(sub, now);
  if (dir < 0 && running) return { ...base, kind: "downgrade", amount: gross ?? 0, effectiveAt: sub!.currentPeriodEnd, hiddenProducts: hidden };
  if (dir > 0 && running) {
    const paid = await paidPlanInvoiceCovering(sub!.id, now, tx);
    const credit = paid && paid.currency === currency ? Math.min(gross ?? 0, prorationCredit(paid.amount, paid.periodStart, paid.periodEnd, now)) : 0;
    return { ...base, kind: "upgrade", credit, amount: Math.max(0, (gross ?? 0) - credit) };
  }
  return { ...base, kind: "start", hiddenProducts: hidden };
}
