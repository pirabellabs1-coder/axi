import "server-only";
import { db } from "@/lib/db";
import { enqueue, queueNotification } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { SITE } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { getRegistrar } from "./registrar";
import { REMINDER_DAYS, RENEW_INVOICE_DAYS_BEFORE, configureDns, issueRenewalInvoice, ownerEmail } from "./service";

/**
 * Cycle de vie des domaines achetés via Axi, appelé par runBillingLifecycle (cron horaire). Chaque étape est
 * idempotente (transitions conditionnelles, clés de rappel) et isolée (une erreur n'arrête pas les autres domaines).
 *  1. factures d'achat impayées à l'échéance (ou annulées par l'admin) → VOID, commande CANCELLED ;
 *  2. facture de renouvellement à J-30 (auto-renouvellement actif) au prix courant (coût + marge) ;
 *  3. rappels J-30 / J-7 / J-1 (e-mail + notification) ;
 *  4. facture de renouvellement impayée à son échéance (J-7) → alerte (une fois). Rien à couper chez AWS :
 *     l'auto-renouvellement Route 53 est désactivé en permanence, seul un renouvellement PAYÉ appelle RenewDomain ;
 *  5. échéance dépassée sans renouvellement → EXPIRED (factures ouvertes annulées, domaines dé-vérifiés) ;
 *  6. DNS non encore configuré → nouvelle tentative.
 */
const DAY_MS = 86_400_000;

export async function runDomainLifecycle(now = new Date()): Promise<{ voided: number; renewals: number; reminders: number; unpaidAlerts: number; expired: number }> {
  const out = { voided: 0, renewals: 0, reminders: 0, unpaidAlerts: 0, expired: 0 };
  const safe = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[domains] ${label}`, e);
    }
  };

  // 1. Achats non réglés
  const unpaid = await db.domainCharge.findMany({
    where: { status: "OPEN", OR: [{ kind: "REGISTER", invoice: { dueAt: { lt: now } } }, { invoice: { status: "VOID" } }] },
    select: { id: true, kind: true, invoiceId: true, registrationId: true, storeId: true },
    take: 200,
  });
  for (const c of unpaid) {
    await safe(`void ${c.id}`, () =>
      db.$transaction(async (tx) => {
        const r = await tx.domainCharge.updateMany({ where: { id: c.id, status: "OPEN" }, data: { status: "VOID" } });
        if (r.count === 0) return;
        if (c.invoiceId) await tx.invoice.updateMany({ where: { id: c.invoiceId, status: "OPEN" }, data: { status: "VOID" } });
        if (c.kind === "REGISTER") await tx.domainRegistration.updateMany({ where: { id: c.registrationId, status: "AWAITING_PAYMENT" }, data: { status: "CANCELLED" } });
        await audit({ storeId: c.storeId, action: "domain.invoice_voided", target: c.registrationId, metadata: { chargeId: c.id, invoiceId: c.invoiceId, kind: c.kind } }, tx);
        out.voided++;
      }),
    );
  }

  const horizon = new Date(now.getTime() + RENEW_INVOICE_DAYS_BEFORE * DAY_MS);
  const due = await db.domainRegistration.findMany({ where: { status: "REGISTERED", expiresAt: { lte: horizon } }, take: 500 });
  for (const reg of due) {
    if (!reg.storeId) continue; // boutique supprimée : domaine archivé, plus de facturation
    const storeId = reg.storeId;
    const expiresAt = reg.expiresAt!;
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);

    // 5. Échéance dépassée
    if (expiresAt <= now) {
      await safe(`expire ${reg.id}`, async () => {
        const detail = await (await getRegistrar()).getDetail(reg.domainName).catch(() => undefined);
        if (detail?.expiresAt && detail.expiresAt > now) {
          // Renouvelé chez le registrar (auto-renouvellement) : on resynchronise l'échéance.
          await db.domainRegistration.update({ where: { id: reg.id }, data: { expiresAt: detail.expiresAt } });
          return;
        }
        await db.$transaction(async (tx) => {
          const r = await tx.domainRegistration.updateMany({ where: { id: reg.id, status: "REGISTERED" }, data: { status: "EXPIRED" } });
          if (r.count === 0) return;
          const open = await tx.domainCharge.findMany({ where: { registrationId: reg.id, status: "OPEN" }, select: { id: true, invoiceId: true } });
          await tx.domainCharge.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "VOID" } });
          await tx.invoice.updateMany({ where: { id: { in: open.map((o) => o.invoiceId).filter((x): x is string => !!x) }, status: "OPEN" }, data: { status: "VOID" } });
          // Plus servi : plus de certificat émis (endpoint ask) ni de résolution vers la boutique.
          await tx.domain.updateMany({ where: { registrationId: reg.id }, data: { verified: false, isPrimary: false } });
          await audit({ storeId: storeId, action: "domain.expired_registration", target: reg.id, metadata: { domain: reg.domainName, expiresAt } }, tx);
          const { notifyStore } = await import("@/lib/notifications/service");
          await notifyStore(storeId, { kind: "other", key: `domain:expired:${reg.id}:${day(expiresAt)}`, title: `Domaine ${reg.domainName} expiré`, text: "Il n'a pas été renouvelé. Contactez le support rapidement : une restauration reste parfois possible pendant quelques semaines, avec des frais du registre.", href: `/app/${storeId}/domaine` }, tx);
          out.expired++;
        });
      });
      continue;
    }

    // 2. Facture de renouvellement (J-30)
    if (reg.autoRenew) {
      await safe(`renewal ${reg.id}`, async () => {
        const r = await issueRenewalInvoice(reg.id, { now });
        if (r.ok && !r.reused) out.renewals++;
        if (!r.ok) await db.domainRegistration.update({ where: { id: reg.id }, data: { lastError: `Renouvellement : ${r.error}` } });
      });
    }

    // 4. Impayé à l'échéance de la facture : alerte unique (clé dans `reminders`), aucune action AWS.
    const overdue = await db.domainCharge.findFirst({ where: { registrationId: reg.id, kind: "RENEW", status: "OPEN", invoice: { status: "OPEN", dueAt: { lt: now } } }, include: { invoice: true } });
    const unpaidKey = overdue ? `unpaid:${overdue.id}` : null;
    if (overdue?.invoice && unpaidKey && !reg.reminders.includes(unpaidKey)) {
      const inv = overdue.invoice;
      await safe(`unpaid ${reg.id}`, async () => {
        const claimed = await db.domainRegistration.updateMany({ where: { id: reg.id, NOT: { reminders: { has: unpaidKey } } }, data: { reminders: { push: unpaidKey } } });
        if (claimed.count === 0) return;
        out.unpaidAlerts++;
        await audit({ storeId, action: "domain.renewal_unpaid", target: reg.id, metadata: { domain: reg.domainName, invoiceId: inv.id, number: inv.number } });
        const { notifyStore } = await import("@/lib/notifications/service");
        const link = `/app/${storeId}/abonnement/factures/${inv.id}`;
        await notifyStore(storeId, { kind: "invoice.due", key: `domain:unpaid:${overdue.id}`, title: `Domaine ${reg.domainName} : renouvellement impayé`, text: `Réglez la facture ${inv.number} avant le ${formatDate(expiresAt)} : sans paiement, le domaine ne sera pas renouvelé.`, href: link });
        const to = await ownerEmail(storeId);
        if (to) {
          await queueNotification(storeId, "email", to, "domain.renewal_unpaid", {
            subject: `Action requise : renouvellement de ${reg.domainName}`,
            text: `Bonjour,\n\nLa facture ${inv.number} (${formatMoney(inv.amount, inv.currency)}) de renouvellement de ${reg.domainName} n'est pas réglée. Sans paiement, le domaine ne sera pas renouvelé.\n\nLe domaine expire le ${formatDate(expiresAt)}. Payez avant cette date pour le conserver : ${SITE.url}${link}\n\nL'équipe ${SITE.name}`,
          });
          await enqueue("notification.send", {}, { storeId });
        }
      });
    }

    // 3. Rappels J-30 / J-7 / J-1 : uniquement le seuil le plus proche non encore envoyé
    const threshold = [...REMINDER_DAYS].sort((a, b) => a - b).find((d) => daysLeft <= d);
    const key = threshold != null ? `${day(expiresAt)}:${threshold}` : null;
    if (key && !reg.reminders.includes(key)) {
      await safe(`reminder ${reg.id}`, async () => {
        const claimed = await db.domainRegistration.updateMany({ where: { id: reg.id, NOT: { reminders: { has: key } } }, data: { reminders: { push: key } } });
        if (claimed.count === 0) return;
        out.reminders++;
        const open = await db.domainCharge.findFirst({ where: { registrationId: reg.id, kind: "RENEW", status: "OPEN" }, include: { invoice: true } });
        const fresh = await db.domainRegistration.findUnique({ where: { id: reg.id }, select: { autoRenew: true } });
        const payLine = open?.invoice ? `Facture ${open.invoice.number} : ${formatMoney(open.invoice.amount, open.invoice.currency)}. Payer : ${SITE.url}/app/${storeId}/abonnement/factures/${open.invoiceId}` : fresh?.autoRenew ? "La facture de renouvellement vous sera envoyée." : `Le renouvellement automatique est désactivé : renouvelez depuis ${SITE.url}/app/${storeId}/domaine`;
        const { notifyStore } = await import("@/lib/notifications/service");
        await notifyStore(storeId, { kind: "invoice.due", key: `domain:remind:${reg.id}:${key}`, title: `Domaine ${reg.domainName} : échéance dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`, text: `Échéance le ${formatDate(expiresAt)}. ${open?.invoice ? `Facture ${open.invoice.number} à régler.` : ""}`.trim(), href: open ? `/app/${storeId}/abonnement/factures/${open.invoiceId}` : `/app/${storeId}/domaine` });
        const to = await ownerEmail(storeId);
        if (to) {
          await queueNotification(storeId, "email", to, "domain.renewal_reminder", {
            subject: `${reg.domainName} expire le ${formatDate(expiresAt)}`,
            text: `Bonjour,\n\nVotre nom de domaine ${reg.domainName} arrive à échéance le ${formatDate(expiresAt)} (dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}).\n\n${payLine}\n\nL'équipe ${SITE.name}`,
          });
          await enqueue("notification.send", {}, { storeId: storeId });
        }
      });
    }
  }

  // 6. DNS en attente
  const noDns = await db.domainRegistration.findMany({ where: { status: "REGISTERED", dnsConfiguredAt: null }, select: { id: true }, take: 50 });
  for (const r of noDns) await safe(`dns ${r.id}`, () => configureDns(r.id));

  return out;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}
