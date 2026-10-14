import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PageHeader, EmptyState, Avatar } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination, PAGE_SIZE, pageParam, str } from "@/components/app/admin-bits";

export const metadata: Metadata = { title: "Utilisateurs" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = str(sp.q);
  const role = str(sp.role);
  const page = pageParam(sp.page);

  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }] } : {}),
    ...(role === "admin" ? { isPlatformAdmin: true } : role === "unverified" ? { emailVerifiedAt: null } : {}),
  };

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, email: true, isPlatformAdmin: true, emailVerifiedAt: true, createdAt: true, _count: { select: { memberships: true, sessions: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader title="Utilisateurs" description={`${total} compte${total > 1 ? "s" : ""}.`} />

      <form method="get" className="mb-5 grid grid-cols-1 gap-3 rounded-[var(--radius-lg)] bg-surface p-3 ring-1 ring-line shadow-[var(--shadow-card)] sm:grid-cols-[1fr_180px_auto]" role="search" aria-label="Filtrer les utilisateurs">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input fieldSize="sm" name="q" defaultValue={q} placeholder="Nom, e-mail, téléphone…" aria-label="Recherche" className="pl-10" />
        </div>
        <Select fieldSize="sm" name="role" defaultValue={role} aria-label="Filtre">
          <option value="">Tous</option>
          <option value="admin">Administrateurs</option>
          <option value="unverified">E-mail non vérifié</option>
        </Select>
        <Button type="submit" variant="secondary" size="sm" className="h-11 sm:h-9">Filtrer</Button>
      </form>

      {users.length === 0 ? (
        <EmptyState icon={Users} title="Aucun utilisateur" description="Aucun compte ne correspond à ces critères." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Utilisateur</TH>
              <TH>Statut</TH>
              <TH align="right">Boutiques</TH>
              <TH align="right">Sessions</TH>
              <TH align="right">Inscrit</TH>
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD>
                  <span className="flex items-center gap-3">
                    <Avatar name={u.name} size={32} />
                    <span className="min-w-0">
                      <Link href={`/admin/utilisateurs/${u.id}`} className="font-medium text-ink hover:text-primary">{u.name}</Link>
                      <span className="block truncate text-xs text-ink-muted">{u.email}</span>
                    </span>
                  </span>
                </TD>
                <TD>
                  <span className="inline-flex flex-wrap gap-1.5">
                    {u.isPlatformAdmin && <Badge tone="accent">Admin</Badge>}
                    <Badge tone={u.emailVerifiedAt ? "success" : "warning"}>{u.emailVerifiedAt ? "Vérifié" : "Non vérifié"}</Badge>
                  </span>
                </TD>
                <TD align="right">{u._count.memberships}</TD>
                <TD align="right">{u._count.sessions}</TD>
                <TD align="right"><span className="text-ink-muted">{formatDate(u.createdAt)}</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={page} total={total} basePath="/admin/utilisateurs" params={{ q, role }} />
    </>
  );
}
