import type { Metadata } from "next";
import Link from "next/link";
import { Receipt, CreditCard } from "lucide-react";
import type { InvoiceStatus, SubscriptionStatus, PlanId } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS, PLAN_ORDER, getAddOn } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { INVOICE_STATUS, SUB_STATUS, ZONE_SHORT, StatusBadge, Pagination, PAGE_SIZE, pageParam, str } from "@/components/app/admin-bits";
import { InvoiceActions, SubscriptionStatusSelect } from "./billing-actions";

export const metadata: Metadata = { title: "Abonnements et factures" };

const INVOICE_STATUSES: InvoiceStatus[] = ["OPEN", "PAID", "VOID", "UNCOLLECTIBLE", "DRAFT"];
const SUB_STATUSES: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "PAUSED", "CANCELLED"];

export default async function AdminBilling({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const invStatus = str(sp.status);
  const subStatus = str(sp.sub);
  const plan = str(sp.plan);
  const page = pageParam(sp.page);
  const subPage = pageParam(sp.subPage);

  const invWhere = invStatus && INVOICE_STATUSES.includes(invStatus as InvoiceStatus) ? { status: invStatus as InvoiceStatus } : {};
  const subWhere = {
    ...(subStatus && SUB_STATUSES.includes(subStatus as SubscriptionStatus) ? { status: subStatus as SubscriptionStatus } : {}),
    ...(plan && PLAN_ORDER.includes(plan as PlanId) ? { planId: plan as PlanId } : {}),
  };

  const [invTotal, invoices, subTotal, subs] = await Promise.all([
    db.invoice.count({ where: invWhere }),
    db.invoice.findMany({ where: invWhere, orderBy: [{ status: "asc" }, { dueAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { subscription: { select: { storeId: true, store: { select: { name: true } } } } } }),
    db.subscription.count({ where: subWhere }),
    db.subscription.findMany({ where: subWhere, orderBy: { updatedAt: "desc" }, skip: (subPage - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { store: { select: { id: true, name: true, slug: true } } } }),
  ]);

  const purchases = invoices.length ? await db.addOnPurchase.findMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } }, select: { invoiceId: true, addOnId: true, quantity: true } }) : [];
  const addOnByInvoice = new Map(purchases.map((p) => [p.invoiceId!, p]));
  const params = { status: invStatus, sub: subStatus, plan };

  return (
    <>
      <PageHeader title="Abonnements et factures" description="Facturation plateforme des plans et des options. Marquer une facture payée active l'abonnement ou l'option correspondante. Paiement en ligne : voir docs/DEPLOIEMENT.md." />

      <section aria-labelledby="invoices" className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="invoices" className="font-display text-lg font-semibold">Factures <span className="text-sm font-normal text-ink-muted">({invTotal})</span></h2>
          <form method="get" className="flex items-center gap-2" aria-label="Filtrer les factures">
            <input type="hidden" name="sub" value={subStatus} />
            <input type="hidden" name="plan" value={plan} />
            <Select fieldSize="sm" name="status" defaultValue={invStatus} aria-label="Statut de facture" className="">
              <option value="">Tous statuts</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrer</Button>
          </form>
        </div>
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="Aucune facture" description="Les factures d'abonnement apparaîtront ici." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Numéro</TH>
                <TH>Boutique</TH>
                <TH>Objet</TH>
                <TH>Statut</TH>
                <TH align="right">Montant</TH>
                <TH align="right">Échéance</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((inv) => (
                <TR key={inv.id}>
                  <TD><span className="font-mono text-xs">{inv.number}</span>{inv.providerRef && <span className="block text-[11px] text-ink-faint">réf. {inv.providerRef}</span>}</TD>
                  <TD><Link href={`/admin/boutiques/${inv.subscription.storeId}`} className="hover:text-primary">{inv.subscription.store.name}</Link></TD>
                  <TD>{addOnByInvoice.has(inv.id) ? <span>Option : {getAddOn(addOnByInvoice.get(inv.id)!.addOnId)?.name ?? addOnByInvoice.get(inv.id)!.addOnId}</span> : <span>Plan {PLANS[inv.planId].name}</span>}</TD>
                  <TD><StatusBadge map={INVOICE_STATUS} value={inv.status} />{inv.paidAt && <span className="block text-[11px] text-ink-faint">payée le {formatDate(inv.paidAt)}</span>}</TD>
                  <TD align="right">{formatMoney(inv.amount, inv.currency)}</TD>
                  <TD align="right"><span className={inv.status === "OPEN" && inv.dueAt < new Date() ? "font-medium text-danger" : "text-ink-muted"}>{formatDate(inv.dueAt)}</span></TD>
                  <TD align="right"><InvoiceActions invoiceId={inv.id} number={inv.number} status={inv.status} kind={addOnByInvoice.has(inv.id) ? "addon" : "plan"} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} total={invTotal} basePath="/admin/abonnements" params={{ ...params, subPage: String(subPage) }} />
      </section>

      <section aria-labelledby="subs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="subs" className="font-display text-lg font-semibold">Abonnements <span className="text-sm font-normal text-ink-muted">({subTotal})</span></h2>
          <form method="get" className="flex items-center gap-2" aria-label="Filtrer les abonnements">
            <input type="hidden" name="status" value={invStatus} />
            <Select fieldSize="sm" name="plan" defaultValue={plan} aria-label="Plan" className="">
              <option value="">Tous plans</option>
              {PLAN_ORDER.map((p) => (
                <option key={p} value={p}>{PLANS[p].name}</option>
              ))}
            </Select>
            <Select fieldSize="sm" name="sub" defaultValue={subStatus} aria-label="Statut d'abonnement" className="">
              <option value="">Tous statuts</option>
              {SUB_STATUSES.map((s) => (
                <option key={s} value={s}>{SUB_STATUS[s].label}</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrer</Button>
          </form>
        </div>
        {subs.length === 0 ? (
          <EmptyState icon={CreditCard} title="Aucun abonnement" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Boutique</TH>
                <TH>Plan</TH>
                <TH>Zone</TH>
                <TH>Intervalle</TH>
                <TH>Période</TH>
                <TH>Statut</TH>
                <TH align="right">Changer</TH>
              </TR>
            </THead>
            <TBody>
              {subs.map((s) => (
                <TR key={s.id}>
                  <TD><Link href={`/admin/boutiques/${s.store.id}`} className="font-medium hover:text-primary">{s.store.name}</Link><span className="block text-xs text-ink-muted">/{s.store.slug}</span></TD>
                  <TD>{PLANS[s.planId].name}{s.cancelAtPeriodEnd && <span className="block text-[11px] text-warning">Annulation en fin de période</span>}</TD>
                  <TD>{ZONE_SHORT[s.zone] ?? s.zone}</TD>
                  <TD>{s.interval === "YEARLY" ? "Annuel" : "Mensuel"}</TD>
                  <TD><span className="text-ink-muted">{formatDate(s.currentPeriodStart)} → {s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "sans échéance"}</span>{s.status === "TRIALING" && s.trialEndsAt && <span className="block text-[11px] text-ink-faint">essai jusqu'au {formatDate(s.trialEndsAt)}</span>}</TD>
                  <TD><StatusBadge map={SUB_STATUS} value={s.status} /></TD>
                  <TD align="right"><SubscriptionStatusSelect subscriptionId={s.id} status={s.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={subPage} total={subTotal} basePath="/admin/abonnements" params={{ ...params, page: String(page) }} pageKey="subPage" />
      </section>
    </>
  );
}
