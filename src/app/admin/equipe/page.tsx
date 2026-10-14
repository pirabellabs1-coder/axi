import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/utils";
import { effectivePlatformRole, PLATFORM_ROLES, PLATFORM_ROLE_LABEL, PLATFORM_ROLE_HINT, PERMISSION_LABEL, roleCan, type AdminPermission } from "@/lib/admin/roles";
import { PageHeader, Avatar } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/app/admin-bits";
import { MfaPanel } from "@/components/admin/mfa-panel";
import { AddMemberButton, MemberControls } from "@/components/admin/team-controls";

export const metadata: Metadata = { title: "Équipe et sécurité" };

const MATRIX: AdminPermission[] = ["read", "tickets.manage", "support.access", "billing.manage", "pricing.manage", "coupons.manage", "stores.moderate", "users.manage", "announcements.manage", "settings.manage", "system.manage", "team.manage"];

export default async function AdminTeam() {
  const ctx = await getAdminContext();
  const canManage = ctx.can("team.manage");
  const [me, members] = await Promise.all([
    db.user.findUnique({ where: { id: ctx.user.id }, select: { mfaEnabled: true, mfaSecretEnc: true } }),
    db.user.findMany({
      where: { isPlatformAdmin: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, platformRole: true, isPlatformAdmin: true, mfaEnabled: true, createdAt: true, sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
    }),
  ]);
  const withoutMfa = members.filter((m) => !m.mfaEnabled).length;

  return (
    <>
      <PageHeader title="Équipe et sécurité" description="Qui accède à la console, avec quel rôle, et comment le compte est protégé. Les permissions sont vérifiées côté serveur dans chaque action." actions={canManage ? <AddMemberButton /> : undefined} />

      <Card as="section" id="securite" aria-labelledby="sec-title" className="mb-8 scroll-mt-24">
        <CardHeader title={<span id="sec-title">Votre compte</span>} description={`${ctx.user.email}, ${PLATFORM_ROLE_LABEL[ctx.role]}`} />
        <div className="px-5 pb-5 pt-3 sm:px-6">
          <MfaPanel enabled={!!me?.mfaEnabled} pendingEnrollment={!me?.mfaEnabled && !!me?.mfaSecretEnc} email={ctx.user.email} />
        </div>
      </Card>

      <section aria-labelledby="members" className="mb-8">
        <SectionTitle id="members" title="Membres de l'équipe" description={`${members.length} membre${members.length > 1 ? "s" : ""}${withoutMfa ? `, dont ${withoutMfa} sans double authentification` : ", tous protégés par double authentification"}.`} />
        <Table minWidth={760}>
          <THead>
            <TR>
              <TH>Membre</TH>
              <TH>Rôle</TH>
              <TH>Double authentification</TH>
              <TH>Dernière connexion</TH>
              <TH align="right">{canManage ? "Gérer" : <span className="sr-only">Actions</span>}</TH>
            </TR>
          </THead>
          <TBody>
            {members.map((m) => {
              const role = effectivePlatformRole(m) ?? "SUPPORT";
              return (
                <TR key={m.id}>
                  <TD>
                    <span className="flex items-center gap-3">
                      <Avatar name={m.name} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{m.name}</span>
                        <span className="block truncate text-xs text-ink-muted">{m.email}</span>
                      </span>
                    </span>
                  </TD>
                  <TD><Badge tone={role === "SUPER_ADMIN" ? "primary" : role === "FINANCE" ? "info" : "neutral"}>{PLATFORM_ROLE_LABEL[role]}</Badge></TD>
                  <TD>{m.mfaEnabled ? <Badge tone="success" dot>Activée</Badge> : <Badge tone="warning">Non activée</Badge>}</TD>
                  <TD><span className="text-ink-muted">{m.sessions[0] ? relativeTime(m.sessions[0].createdAt) : "Jamais"}</span></TD>
                  <TD align="right">{canManage ? <MemberControls userId={m.id} name={m.name} role={role} mfaEnabled={m.mfaEnabled} self={m.id === ctx.user.id} /> : null}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </section>

      <section aria-labelledby="matrix">
        <SectionTitle id="matrix" title="Permissions par rôle" description="Appliquées dans toutes les actions de la console (src/lib/admin/roles.ts)." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-4">
          {PLATFORM_ROLES.map((r) => (
            <Card key={r} className="px-5 py-4">
              <p className="font-medium text-ink">{PLATFORM_ROLE_LABEL[r]}</p>
              <p className="mt-1 text-sm text-ink-muted">{PLATFORM_ROLE_HINT[r]}</p>
            </Card>
          ))}
        </div>
        <Table minWidth={560}>
          <THead>
            <TR>
              <TH>Permission</TH>
              {PLATFORM_ROLES.map((r) => <TH key={r} align="center">{PLATFORM_ROLE_LABEL[r]}</TH>)}
            </TR>
          </THead>
          <TBody>
            {MATRIX.map((p) => (
              <TR key={p}>
                <TD>{PERMISSION_LABEL[p]}</TD>
                {PLATFORM_ROLES.map((r) => (
                  <TD key={r} align="center">
                    {roleCan(r, p) ? <Check className="mx-auto size-4 text-primary" aria-label="Autorisé" /> : <Minus className="mx-auto size-4 text-ink-faint" aria-label="Non autorisé" />}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </section>
    </>
  );
}
