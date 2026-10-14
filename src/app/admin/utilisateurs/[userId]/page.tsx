import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin, ROLE_LABELS } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime, formatPhone } from "@/lib/utils";
import { PageHeader, Avatar } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STORE_STATUS, StatusBadge, DL } from "@/components/app/admin-bits";
import { UserAdminActions } from "./user-actions";

export const metadata: Metadata = { title: "Fiche utilisateur" };

export default async function AdminUserDetail({ params }: { params: Promise<{ userId: string }> }) {
  const admin = await requirePlatformAdmin();
  const { userId } = await params;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { include: { store: { select: { id: true, name: true, slug: true, status: true } } }, orderBy: { createdAt: "asc" } },
      sessions: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { sessions: true, auditLogs: true, supportTickets: true } },
    },
  });
  if (!user) notFound();
  const activeSessions = user.sessions.filter((s) => s.expiresAt > new Date());

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <Avatar name={user.name} size={40} /> {user.name}
          </span>
        }
        description={user.email}
        back={{ href: "/admin/utilisateurs", label: "Utilisateurs" }}
      />

      <Card className="mb-6">
        <CardHeader title="Actions" />
        <CardBody>
          <UserAdminActions userId={user.id} isPlatformAdmin={user.isPlatformAdmin} isSelf={user.id === admin.id} sessionsCount={user._count.sessions} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Compte" />
          <CardBody>
            <DL
              items={[
                { label: "Rôles", value: <span className="inline-flex gap-1.5">{user.isPlatformAdmin && <Badge tone="accent">Admin plateforme</Badge>}<Badge tone={user.emailVerifiedAt ? "success" : "warning"}>{user.emailVerifiedAt ? "E-mail vérifié" : "E-mail non vérifié"}</Badge></span> },
                { label: "Téléphone", value: user.phone ? formatPhone(user.phone) : null },
                { label: "Langue", value: user.locale },
                { label: "MFA", value: user.mfaEnabled ? "Activée" : "Désactivée" },
                { label: "Inscrit le", value: formatDateTime(user.createdAt) },
                { label: "Vérifié le", value: user.emailVerifiedAt ? formatDateTime(user.emailVerifiedAt) : null },
                { label: "Actions auditées", value: user._count.auditLogs },
                { label: "Tickets support", value: user._count.supportTickets },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Boutiques" description={`${user.memberships.length} appartenance${user.memberships.length > 1 ? "s" : ""}`} />
          <CardBody className="p-0">
            {user.memberships.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">Aucune boutique.</p>
            ) : (
              <ul className="divide-y divide-line">
                {user.memberships.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/boutiques/${m.store.id}`} className="font-medium text-ink hover:text-primary">{m.store.name}</Link>
                      <span className="block text-xs text-ink-muted">/{m.store.slug}</span>
                    </div>
                    <Badge tone={m.role === "OWNER" ? "primary" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                    <StatusBadge map={STORE_STATUS} value={m.store.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Sessions" description={`${activeSessions.length} active${activeSessions.length > 1 ? "s" : ""} sur les ${user.sessions.length} plus récentes`} />
          <CardBody className="p-0">
            {user.sessions.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">Aucune session.</p>
            ) : (
              <ul className="divide-y divide-line">
                {user.sessions.map((s) => {
                  const active = s.expiresAt > new Date();
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                      <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Expirée"}</Badge>
                      <span className="text-ink-muted">IP {s.ip ?? "-"}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-faint" title={s.userAgent ?? undefined}>{s.userAgent ?? "Navigateur inconnu"}</span>
                      <span className="text-xs text-ink-faint">créée {formatDateTime(s.createdAt)} · expire {formatDateTime(s.expiresAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
