import type { Metadata } from "next";
import Link from "next/link";
import { Puzzle } from "lucide-react";
import type { AddOnStatus, Prisma } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { ADD_ONS, ADD_ON_BILLING_LABEL, getAddOn } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { addOnMrrEur, sumByCurrency } from "@/lib/admin/metrics";
import { PageHeader, EmptyState, Kpi } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, TableToolbar } from "@/components/ui/table";
import { ADDON_STATUS, INVOICE_STATUS, StatusBadge, Pagination, PAGE_SIZE, pageParam, str } from "@/components/app/admin-bits";
import { InvoiceActions } from "../abonnements/billing-actions";

export const metadata: Metadata = { title: "Options vendues" };

const STATUSES: AddOnStatus[] = ["PENDING", "ACTIVE", "EXPIRED", "CANCELLED"];

export default async function AdminAddOns({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const status = str(sp.status);
  const addOnId = str(sp.option);
  const page = pageParam(sp.page);
  const now = new Date();

  const where: Prisma.AddOnPurchaseWhereInput = {
    ...(STATUSES.includes(status as AddOnStatus) ? { status: status as AddOnStatus } : {}),
    ...(ADD_ONS.some((a) => a.id === addOnId) ? { addOnId } : {}),
  };

  const [total, rows, active, paidInvoices] = await Promise.all([
    db.addOnPurchase.count({ where }),
    db.addOnPurchase.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { store: { select: { id: true, name: true, city: true } } } }),
    db.addOnPurchase.findMany({ where: { status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { addOnId: true, quantity: true } }),
    db.addOnPurchase.findMany({ where: { invoiceId: { not: null } }, select: { invoiceId: true } }),
  ]);
  const invoiceIds = [...new Set([...rows.map((r) => r.invoiceId), ...paidInvoices.map((p) => p.invoiceId)].filter(Boolean) as string[])];
  const invoices = invoiceIds.length ? await db.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, number: true, status: true, amount: true, currency: true, paidAt: true } }) : [];
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const collected = sumByCurrency(invoices.filter((i) => i.status === "PAID"));
  const pending = rows.filter((r) => r.status === "PENDING").length;

  return (
    <>
      <PageHeader title="Options vendues" description="Achats d'options par boutique, factures liées et activation. Une option s'active quand sa facture est payée." />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="MRR des options" value={formatMoney(addOnMrrEur(active), "EUR")} hint="Options mensuelles et annuelles, tarif Monde" />
        <Kpi className="sm:order-last sm:col-span-2 xl:order-none xl:col-span-1" label="Encaissé (toutes options)" value={Object.keys(collected).length ? Object.entries(collected).map(([c, a]) => formatMoney(a, c)).join(" + ") : formatMoney(0, "EUR")} hint="Factures d'options payées" />
        <Kpi label="Options actives" value={active.reduce((n, a) => n + a.quantity, 0)} hint={pending ? `${pending} en attente de paiement sur cette page` : "Aucune en attente sur cette page"} />
      </div>

      <div className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">
        <TableToolbar>
          <form method="get" className="flex w-full flex-wrap items-center gap-2" aria-label="Filtrer les options">
            <Select fieldSize="sm" name="status" defaultValue={status} aria-label="Statut" className=" w-auto min-w-[180px]">
              <option value="">Tous les statuts</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{ADDON_STATUS[s].label}</option>
              ))}
            </Select>
            <Select fieldSize="sm" name="option" defaultValue={addOnId} aria-label="Option" className=" w-auto min-w-[220px]">
              <option value="">Toutes les options</option>
              {ADD_ONS.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrer</Button>
            <span className="ml-auto text-sm text-ink-muted">{total} achat{total > 1 ? "s" : ""}</span>
          </form>
        </TableToolbar>
        {rows.length === 0 ? (
          <EmptyState compact icon={Puzzle} title="Aucune option" description="Les options achetées par les marchands apparaîtront ici." />
        ) : (
          <Table bare minWidth={920}>
            <THead>
              <TR>
                <TH>Option</TH>
                <TH>Boutique</TH>
                <TH>Statut</TH>
                <TH>Validité</TH>
                <TH>Facture</TH>
                <TH align="right">Montant</TH>
                <TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const a = getAddOn(r.addOnId);
                const inv = r.invoiceId ? invoiceById.get(r.invoiceId) : undefined;
                return (
                  <TR key={r.id}>
                    <TD>
                      <span className="font-medium">{a?.name ?? r.addOnId}</span>
                      <span className="block text-xs text-ink-muted">{a ? ADD_ON_BILLING_LABEL[a.billing] : ""}{r.quantity > 1 ? `, quantité ${r.quantity}` : ""}</span>
                    </TD>
                    <TD><Link href={`/admin/boutiques/${r.store.id}`} className="hover:text-primary">{r.store.name}</Link>{r.store.city && <span className="block text-xs text-ink-muted">{r.store.city}</span>}</TD>
                    <TD><StatusBadge map={ADDON_STATUS} value={r.status} /></TD>
                    <TD><span className="text-ink-muted">depuis le {formatDate(r.startsAt)}</span>{r.endsAt && <span className="block text-xs text-ink-faint">jusqu'au {formatDate(r.endsAt)}</span>}</TD>
                    <TD>{inv ? <span className="inline-flex flex-col gap-1"><span className="font-mono text-xs">{inv.number}</span><StatusBadge map={INVOICE_STATUS} value={inv.status} /></span> : <span className="text-ink-faint">-</span>}</TD>
                    <TD align="right">{formatMoney(r.unitPrice * r.quantity, r.currency)}</TD>
                    <TD align="right">{inv && (inv.status === "OPEN" || inv.status === "DRAFT") ? <InvoiceActions invoiceId={inv.id} number={inv.number} status={inv.status} kind="addon" /> : <span className="text-xs text-ink-faint">-</span>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
      <Pagination page={page} total={total} basePath="/admin/options" params={{ status, option: addOnId }} />
    </>
  );
}
