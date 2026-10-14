import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import type { TicketStatus } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime, truncate } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { TICKET_STATUS, StatusBadge, Pagination, PAGE_SIZE, pageParam, str } from "@/components/app/admin-bits";

export const metadata: Metadata = { title: "Tickets" };

const STATUSES: TicketStatus[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];

export default async function AdminTickets({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const status = str(sp.status);
  const page = pageParam(sp.page);
  const where = status && STATUSES.includes(status as TicketStatus) ? { status: status as TicketStatus } : { status: { in: ["OPEN", "PENDING"] as TicketStatus[] } };

  const [total, tickets] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { store: { select: { id: true, name: true } }, user: { select: { id: true, name: true } } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Tickets de support"
        description={status ? `${total} ticket${total > 1 ? "s" : ""}.` : `${total} ticket${total > 1 ? "s" : ""} à traiter (ouverts ou en attente).`}
        actions={
          <form method="get" className="flex items-center gap-2" aria-label="Filtrer les tickets">
            <Select fieldSize="sm" name="status" defaultValue={status} aria-label="Statut" className="">
              <option value="">À traiter</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{TICKET_STATUS[s].label}</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrer</Button>
          </form>
        }
      />

      {tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="Aucun ticket" description="Tout est à jour. Les demandes envoyées via la page Contact ou l'espace marchand apparaîtront ici." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Sujet</TH>
              <TH>Demandeur</TH>
              <TH>Boutique</TH>
              <TH>Statut</TH>
              <TH align="right">Créé</TH>
            </TR>
          </THead>
          <TBody>
            {tickets.map((t) => (
              <TR key={t.id}>
                <TD>
                  <Link href={`/admin/tickets/${t.id}`} className="font-medium text-ink hover:text-primary">{t.subject}</Link>
                  <span className="block text-xs text-ink-muted">{truncate(t.message, 90)}</span>
                </TD>
                <TD>{t.user ? <Link href={`/admin/utilisateurs/${t.user.id}`} className="hover:text-primary">{t.user.name}</Link> : t.email}<span className="block text-xs text-ink-muted">{t.email}</span></TD>
                <TD>{t.store ? <Link href={`/admin/boutiques/${t.store.id}`} className="hover:text-primary">{t.store.name}</Link> : "-"}</TD>
                <TD><StatusBadge map={TICKET_STATUS} value={t.status} /></TD>
                <TD align="right"><span className="text-ink-muted">{formatDateTime(t.createdAt)}</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={page} total={total} basePath="/admin/tickets" params={{ status }} />
    </>
  );
}
