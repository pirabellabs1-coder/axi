"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { CreditType, Prisma, SubscriptionStatus, TicketStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import { requireAdminPermission } from "./context";
import type { AdminPermission } from "./roles";
import { audit } from "@/lib/audit";
import { enqueue, runJobs } from "@/lib/jobs";
import { reconcilePendingAttempts } from "@/lib/payments/service";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { confirmInvoicePayment } from "@/lib/billing/service";
import { debitCredits } from "@/lib/credits";
import { ZONE_CURRENCY, type PricingZone } from "@/config/plans";

/**
 * Actions d'administration plateforme.
 * Chaque action vérifie la permission du rôle plateforme (src/lib/admin/roles.ts ; AuthError, jamais de redirect)
 * et journalise dans AuditLog avec un préfixe `admin.`.
 */
async function requireAdmin(perm: AdminPermission): Promise<CurrentUser> {
  const ctx = await requireAdminPermission(perm);
  return ctx.user;
}

const zId = z.string().min(8).max(64);
const zReason = z.string().trim().min(5, "Motif trop court (5 caractères minimum)").max(500);

function revalidateStore(storeId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/boutiques");
  revalidatePath(`/admin/boutiques/${storeId}`);
}

// ─────────────────────────── Boutiques ───────────────────────────

export async function suspendStore(storeId: string, reason: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("stores.moderate");
    const parsed = z.object({ storeId: zId, reason: zReason }).safeParse({ storeId, reason });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true, status: true } });
    if (!store) return fail("Boutique introuvable");
    if (store.status === "SUSPENDED") return fail("Cette boutique est déjà suspendue");
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: storeId }, data: { status: "SUSPENDED", statusReason: parsed.data.reason } });
      await audit({ storeId, actorId: admin.id, action: "admin.store.suspended", target: storeId, metadata: { reason: parsed.data.reason, previousStatus: store.status } }, tx);
    });
    revalidateStore(storeId);
    return success(undefined, "Boutique suspendue");
  });
}

export async function reactivateStore(storeId: string, reason: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("stores.moderate");
    const parsed = z.object({ storeId: zId, reason: zReason }).safeParse({ storeId, reason });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true, status: true, publishedAt: true } });
    if (!store) return fail("Boutique introuvable");
    if (store.status !== "SUSPENDED") return fail("Cette boutique n'est pas suspendue");
    // Une boutique déjà publiée avant suspension revient en ligne ; sinon elle repasse en brouillon.
    const next = store.publishedAt ? "PUBLISHED" : "DRAFT";
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: storeId }, data: { status: next, statusReason: null } });
      await audit({ storeId, actorId: admin.id, action: "admin.store.reactivated", target: storeId, metadata: { reason: parsed.data.reason, newStatus: next } }, tx);
    });
    revalidateStore(storeId);
    return success(undefined, "Boutique réactivée");
  });
}

export async function toggleFeatured(storeId: string): Promise<ActionResult<{ isFeatured: boolean }>> {
  return guard(async () => {
    const admin = await requireAdmin("stores.moderate");
    const store = await db.store.findUnique({ where: { id: storeId }, select: { isFeatured: true } });
    if (!store) return fail("Boutique introuvable");
    const isFeatured = !store.isFeatured;
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: storeId }, data: { isFeatured } });
      await audit({ storeId, actorId: admin.id, action: "admin.store.featured_toggled", target: storeId, metadata: { isFeatured } }, tx);
    });
    revalidateStore(storeId);
    revalidatePath("/marketplace");
    return success({ isFeatured }, isFeatured ? "Boutique mise en vedette" : "Boutique retirée de la vedette");
  });
}

export async function toggleListed(storeId: string): Promise<ActionResult<{ listedInMarketplace: boolean }>> {
  return guard(async () => {
    const admin = await requireAdmin("stores.moderate");
    const store = await db.store.findUnique({ where: { id: storeId }, select: { listedInMarketplace: true, marketplaceBlocked: true } });
    if (!store) return fail("Boutique introuvable");
    // Masquer = blocage administrateur (le marchand ne peut plus se relister) ; lister = levée du blocage.
    const visible = store.listedInMarketplace && !store.marketplaceBlocked;
    const listedInMarketplace = !visible;
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: storeId }, data: { listedInMarketplace, marketplaceBlocked: !listedInMarketplace } });
      await audit({ storeId, actorId: admin.id, action: "admin.store.listed_toggled", target: storeId, metadata: { listedInMarketplace, marketplaceBlocked: !listedInMarketplace } }, tx);
    });
    revalidateStore(storeId);
    revalidatePath("/marketplace");
    return success({ listedInMarketplace }, listedInMarketplace ? "Boutique visible sur la marketplace" : "Boutique masquée de la marketplace");
  });
}

export async function grantSupportAccess(storeId: string, hours: number, reason: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("support.access");
    const parsed = z.object({ storeId: zId, hours: z.coerce.number().int().min(1).max(168), reason: zReason }).safeParse({ storeId, hours, reason });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) return fail("Boutique introuvable");
    const existing = await db.membership.findUnique({ where: { userId_storeId: { userId: admin.id, storeId } } });
    if (existing && existing.role !== "SUPPORT") return fail("Vous êtes déjà membre de cette boutique avec un autre rôle");
    const expiresAt = new Date(Date.now() + parsed.data.hours * 3_600_000);
    await db.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { userId_storeId: { userId: admin.id, storeId } },
        create: { userId: admin.id, storeId, role: "SUPPORT", expiresAt, reason: parsed.data.reason },
        update: { expiresAt, reason: parsed.data.reason },
      });
      await audit({ storeId, actorId: admin.id, action: "admin.support_access.granted", target: storeId, metadata: { hours: parsed.data.hours, expiresAt, reason: parsed.data.reason } }, tx);
    });
    revalidateStore(storeId);
    return success(undefined, `Accès support accordé pour ${parsed.data.hours} h`);
  });
}

// ─────────────────────────── Utilisateurs ───────────────────────────

export async function setPlatformAdmin(userId: string, isPlatformAdmin: boolean): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("team.manage");
    if (userId === admin.id) return fail("Vous ne pouvez pas modifier votre propre rôle d'administrateur");
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isPlatformAdmin: true, emailVerifiedAt: true } });
    if (!user) return fail("Utilisateur introuvable");
    if (user.isPlatformAdmin === isPlatformAdmin) return fail("Aucun changement");
    if (isPlatformAdmin && !user.emailVerifiedAt) return fail("Le compte n'a pas encore vérifié son adresse e-mail.");
    // Promotion au moindre privilège (rôle Support), à ajuster dans Équipe et sécurité.
    // Rétrogradation : le rôle et les sessions ne donnent plus accès à la console.
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { isPlatformAdmin, platformRole: isPlatformAdmin ? "SUPPORT" : null } });
      // Rétrogradation : les accès d'assistance aux boutiques (Membership SUPPORT) sont supprimés.
      const supportRevoked = isPlatformAdmin ? 0 : (await tx.membership.deleteMany({ where: { userId, role: "SUPPORT" } })).count;
      await audit({ actorId: admin.id, action: isPlatformAdmin ? "admin.user.promoted" : "admin.user.demoted", target: userId, metadata: { email: user.email, role: isPlatformAdmin ? "SUPPORT" : null, supportRevoked } }, tx);
    });
    revalidatePath("/admin/utilisateurs");
    revalidatePath(`/admin/utilisateurs/${userId}`);
    revalidatePath("/admin/equipe");
    return success(undefined, isPlatformAdmin ? "Ajouté à l'équipe plateforme (rôle Support)" : "Droits d'administration retirés");
  });
}

export async function revokeUserSessions(userId: string): Promise<ActionResult<{ count: number }>> {
  return guard(async () => {
    const admin = await requireAdmin("users.manage");
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return fail("Utilisateur introuvable");
    const { count } = await db.session.deleteMany({ where: { userId } });
    await audit({ actorId: admin.id, action: "admin.user.sessions_revoked", target: userId, metadata: { count } });
    revalidatePath(`/admin/utilisateurs/${userId}`);
    return success({ count }, `${count} session${count > 1 ? "s" : ""} révoquée${count > 1 ? "s" : ""}`);
  });
}

// ─────────────────────────── Abonnements & factures ───────────────────────────

export async function markInvoicePaid(invoiceId: string, providerRef?: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("billing.manage");
    const ref = providerRef?.trim().slice(0, 120) || null;
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { subscription: { select: { storeId: true } } } });
    if (!invoice) return fail("Facture introuvable");
    if (invoice.status === "PAID") return fail("Cette facture est déjà payée");
    if (invoice.status === "VOID") return fail("Cette facture est annulée");
    // Chemin unique de confirmation (src/lib/billing/service.ts) :
    //  - facture d'abonnement : abonnement ACTIF sur la période de la facture ;
    //  - facture d'option (AddOnPurchase.invoiceId) : activateAddOnPurchase (crédits du pack, échéance).
    const result = await db.$transaction(async (tx) => {
      const r = await confirmInvoicePayment(invoiceId, { via: "admin", actorId: admin.id, providerRef: ref }, tx);
      if (r.ok && !r.already) {
        await audit({ storeId: invoice.subscription.storeId, actorId: admin.id, action: "admin.invoice.marked_paid", target: invoiceId, metadata: { number: invoice.number, amount: invoice.amount, currency: invoice.currency, providerRef: ref, kind: r.kind } }, tx);
      }
      return r;
    });
    if (!result.ok) return fail(result.error ?? "Paiement non confirmé");
    revalidatePath("/admin", "layout");
    return success(undefined, result.kind === "domain" ? `Facture ${invoice.number} payée : opération sur le nom de domaine lancée` : result.kind === "addon" ? `Facture ${invoice.number} payée : option activée` : `Facture ${invoice.number} payée : abonnement actif`);
  });
}

export async function voidInvoice(invoiceId: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("billing.manage");
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { subscription: { select: { storeId: true } } } });
    if (!invoice) return fail("Facture introuvable");
    if (invoice.status === "PAID") return fail("Une facture payée ne peut pas être annulée");
    if (invoice.status === "VOID") return fail("Cette facture est déjà annulée");
    // Conditionnel : une facture payée (ou annulée) entre-temps, p. ex. par un webhook, n'est jamais annulée.
    const voided = await db.$transaction(async (tx) => {
      const r = await tx.invoice.updateMany({ where: { id: invoiceId, status: { notIn: ["PAID", "VOID"] } }, data: { status: "VOID" } });
      if (r.count === 0) return false;
      await audit({ storeId: invoice.subscription.storeId, actorId: admin.id, action: "admin.invoice.voided", target: invoiceId, metadata: { number: invoice.number } }, tx);
      return true;
    });
    if (!voided) return fail("La facture a changé entre-temps (payée ou déjà annulée). Rechargez la page.");
    revalidatePath("/admin/abonnements");
    revalidatePath("/admin");
    return success(undefined, `Facture ${invoice.number} annulée`);
  });
}

const SUB_STATUSES: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"];

export async function setSubscriptionStatus(subscriptionId: string, status: SubscriptionStatus): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("billing.manage");
    if (!SUB_STATUSES.includes(status)) return fail("Statut invalide");
    const sub = await db.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) return fail("Abonnement introuvable");
    if (sub.status === status) return fail("Aucun changement");
    await db.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status } });
      await enqueue("subscription.changed", { storeId: sub.storeId, subscriptionId, planId: sub.planId, status }, { storeId: sub.storeId }, tx);
      await audit({ storeId: sub.storeId, actorId: admin.id, action: "admin.subscription.status_changed", target: subscriptionId, metadata: { from: sub.status, to: status } }, tx);
    });
    revalidatePath("/admin/abonnements");
    revalidatePath("/admin");
    revalidatePath(`/admin/boutiques/${sub.storeId}`);
    return success(undefined, "Statut de l'abonnement mis à jour");
  });
}

// ─────────────────────────── Paiements ───────────────────────────

export async function runReconciliation(): Promise<ActionResult<{ checked: number; updated: number }>> {
  return guard(async () => {
    const admin = await requireAdmin("system.manage");
    const result = await reconcilePendingAttempts();
    await audit({ actorId: admin.id, action: "admin.payments.reconciled", metadata: result });
    revalidatePath("/admin/paiements");
    return success(result, `${result.checked} tentative${result.checked > 1 ? "s" : ""} vérifiée${result.checked > 1 ? "s" : ""}, ${result.updated} mise${result.updated > 1 ? "s" : ""} à jour`);
  });
}

// ─────────────────────────── Tickets ───────────────────────────

const TICKET_STATUSES: TicketStatus[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];

export async function setTicketStatus(ticketId: string, status: TicketStatus): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("tickets.manage");
    if (!TICKET_STATUSES.includes(status)) return fail("Statut invalide");
    const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return fail("Ticket introuvable");
    if (ticket.status === status) return fail("Aucun changement");
    await db.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status } });
      await audit({ storeId: ticket.storeId, actorId: admin.id, action: "admin.ticket.status_changed", target: ticketId, metadata: { from: ticket.status, to: status } }, tx);
    });
    revalidatePath("/admin/tickets");
    revalidatePath(`/admin/tickets/${ticketId}`);
    return success(undefined, "Statut du ticket mis à jour");
  });
}

// ─────────────────────────── Tâches & notifications ───────────────────────────

export async function retryJob(jobId: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("system.manage");
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) return fail("Tâche introuvable");
    if (job.status === "RUNNING") return fail("Cette tâche est en cours d'exécution");
    await db.$transaction(async (tx) => {
      await tx.job.update({ where: { id: jobId }, data: { status: "PENDING", runAt: new Date(), attempts: 0, lockedAt: null, lastError: null } });
      await audit({ storeId: job.storeId, actorId: admin.id, action: "admin.job.retried", target: jobId, metadata: { type: job.type, previousStatus: job.status } }, tx);
    });
    revalidatePath("/admin/taches");
    return success(undefined, "Tâche remise en file d'attente");
  });
}

export async function runJobsNow(): Promise<ActionResult<{ processed: number; failed: number }>> {
  return guard(async () => {
    const admin = await requireAdmin("system.manage");
    const result = await runJobs(25);
    await audit({ actorId: admin.id, action: "admin.jobs.run", metadata: result });
    revalidatePath("/admin/taches");
    revalidatePath("/admin");
    return success(result, `${result.processed} tâche${result.processed > 1 ? "s" : ""} exécutée${result.processed > 1 ? "s" : ""}, ${result.failed} en échec`);
  });
}

export async function retryNotification(notificationId: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("system.manage");
    const n = await db.notification.findUnique({ where: { id: notificationId } });
    if (!n) return fail("Notification introuvable");
    if (n.status === "SENT") return fail("Cette notification a déjà été envoyée");
    await db.$transaction(async (tx) => {
      await tx.notification.update({ where: { id: notificationId }, data: { status: "QUEUED", attempts: 0, error: null } });
      await enqueue("notification.send", { notificationId }, { storeId: n.storeId }, tx);
      await audit({ storeId: n.storeId, actorId: admin.id, action: "admin.notification.retried", target: notificationId, metadata: { channel: n.channel, template: n.template } as Prisma.JsonObject }, tx);
    });
    revalidatePath("/admin/taches");
    return success(undefined, "Notification remise en file d'attente");
  });
}

// ─────────────────────────── Zone tarifaire ───────────────────────────

/**
 * Change la zone tarifaire de l'abonnement (WORLD = EUR, AFRICA = FCFA). Effet sur les prochaines
 * factures uniquement : les factures déjà émises gardent leur devise. Motif obligatoire, audité.
 */
export async function setPricingZone(storeId: string, zone: PricingZone, reason: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("billing.manage");
    const parsed = z.object({ storeId: zId, zone: z.enum(["WORLD", "AFRICA"]), reason: zReason }).safeParse({ storeId, zone, reason });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const sub = await db.subscription.findUnique({ where: { storeId }, select: { id: true, zone: true, currency: true } });
    if (!sub) return fail("Cette boutique n'a pas d'abonnement");
    if (sub.zone === parsed.data.zone) return fail("Aucun changement");
    const currency = ZONE_CURRENCY[parsed.data.zone];
    await db.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub.id }, data: { zone: parsed.data.zone, currency } });
      await audit({ storeId, actorId: admin.id, action: "admin.subscription.zone_changed", target: sub.id, metadata: { from: { zone: sub.zone, currency: sub.currency }, to: { zone: parsed.data.zone, currency }, reason: parsed.data.reason } }, tx);
    });
    revalidateStore(storeId);
    revalidatePath("/admin/abonnements");
    return success(undefined, `Zone tarifaire : ${parsed.data.zone === "AFRICA" ? "Afrique (FCFA)" : "Monde (EUR)"}`);
  });
}

// ─────────────────────────── Portefeuilles de crédits ───────────────────────────

const zCreditType = z.enum(["WA_UTILITY", "WA_MARKETING", "AI"]);

/**
 * Ajustement manuel d'un portefeuille (geste commercial, correction).
 * - Ajout : mouvement `admin` sans échéance (règle des gestes commerciaux, src/lib/credits.ts).
 * - Retrait : débit FIFO sur les lots actifs via debitCredits (refusé si le solde est insuffisant).
 * Motif obligatoire, journalisé `admin.credits.adjusted`.
 */
export async function adjustCredits(storeId: string, type: CreditType, delta: number, reason: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdmin("billing.manage");
    const parsed = z
      .object({ storeId: zId, type: zCreditType, delta: z.coerce.number().int("Nombre entier attendu").min(-100_000).max(100_000).refine((n) => n !== 0, "Indiquez un nombre de crédits non nul"), reason: zReason })
      .safeParse({ storeId, type, delta, reason });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) return fail("Boutique introuvable");
    const { type: t, delta: d } = parsed.data;
    const reference = `admin:${Date.now().toString(36)}`;
    const outcome = await db.$transaction(async (tx) => {
      if (d > 0) {
        await tx.creditLedger.create({ data: { storeId, type: t, delta: d, reason: "admin", reference, expiresAt: null } });
      } else {
        const r = await debitCredits(storeId, t, -d, reference, tx);
        if (!r.ok) return r.error;
      }
      await audit({ storeId, actorId: admin.id, action: "admin.credits.adjusted", target: storeId, metadata: { type: t, delta: d, reason: parsed.data.reason, reference } }, tx);
      return null;
    });
    if (outcome) return fail(outcome);
    revalidateStore(storeId);
    revalidatePath("/admin/credits");
    return success(undefined, d > 0 ? `${d} crédits ajoutés` : `${-d} crédits retirés`);
  });
}
