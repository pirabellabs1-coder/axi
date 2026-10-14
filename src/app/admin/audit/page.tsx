import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pagination, PAGE_SIZE, pageParam, str, JsonDetails } from "@/components/app/admin-bits";

export const metadata: Metadata = { title: "Journal d'audit" };

export default async function AdminAudit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const action = str(sp.action);
  const storeId = str(sp.storeId);
  const actorId = str(sp.actorId);
  const page = pageParam(sp.page);

  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
    ...(storeId ? { storeId } : {}),
    ...(actorId ? { actorId } : {}),
  };

  const [total, logs, stores, actions] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { actor: { select: { id: true, name: true } }, store: { select: { id: true, name: true } } } }),
    db.store.findMany({ where: { auditLogs: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
    db.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Journal d'audit" description={`${total} entrée${total > 1 ? "s" : ""}. Les actions sensibles (plateforme et boutiques) sont journalisées avec acteur, cible et adresse IP.`} />

      <form method="get" className="mb-5 grid grid-cols-1 gap-3 rounded-[var(--radius-lg)] bg-surface p-3 ring-1 ring-line shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]" role="search" aria-label="Filtrer le journal">
        <div>
          <Input fieldSize="sm" name="action" list="audit-actions" defaultValue={action} placeholder="Action (ex. admin.store.suspended)" aria-label="Action" />
          <datalist id="audit-actions">
            {actions.map((a) => (
              <option key={a.action} value={a.action} />
            ))}
          </datalist>
        </div>
        <Select fieldSize="sm" name="storeId" defaultValue={storeId} aria-label="Boutique">
          <option value="">Toutes boutiques</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        {actorId && <input type="hidden" name="actorId" value={actorId} />}
        <Button type="submit" variant="secondary" size="sm" className="h-11 sm:h-9">Filtrer</Button>
      </form>

      {logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="Aucune entrée" description="Aucune action ne correspond à ces filtres." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Acteur</TH>
              <TH>Action</TH>
              <TH>Boutique</TH>
              <TH>Cible</TH>
              <TH>IP</TH>
              <TH>Métadonnées</TH>
            </TR>
          </THead>
          <TBody>
            {logs.map((l) => (
              <TR key={l.id}>
                <TD><span className="whitespace-nowrap text-ink-muted">{formatDateTime(l.createdAt)}</span></TD>
                <TD>{l.actor ? <Link href={`/admin/utilisateurs/${l.actor.id}`} className="hover:text-primary">{l.actor.name}</Link> : <span className="text-ink-faint">Système</span>}</TD>
                <TD><span className="font-mono text-xs">{l.action}</span></TD>
                <TD>{l.store ? <Link href={`/admin/boutiques/${l.store.id}`} className="hover:text-primary">{l.store.name}</Link> : "-"}</TD>
                <TD><span className="font-mono text-xs text-ink-muted">{l.target ?? "-"}</span></TD>
                <TD><span className="font-mono text-xs text-ink-faint">{l.ip ?? "-"}</span></TD>
                <TD><JsonDetails value={l.metadata} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={page} total={total} basePath="/admin/audit" params={{ action, storeId, actorId }} />
    </>
  );
}
