import type { Metadata } from "next";
import { Mail, ShieldCheck, Users } from "lucide-react";
import type { MembershipRole } from "@prisma/client";
import { getStoreContext, ROLE_LABELS } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { teamSeats, nextPlanForMembers, canBuyExtraMember } from "@/lib/team/seats";
import { formatDate, relativeTime } from "@/lib/utils";
import { PageHeader, Avatar, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { InviteDialog, RoleSelect, RemoveMemberButton, InvitationActions } from "./equipe-client";

export const metadata: Metadata = { title: "Équipe" };

const ROLE_HELP: { role: MembershipRole; text: string }[] = [
  { role: "OWNER", text: "Tout : paiements, abonnement, équipe, archivage. Au moins un par boutique." },
  { role: "MANAGER", text: "Produits, commandes, clients, promotions, livraison, apparence et paramètres. Ni facturation ni équipe." },
  { role: "STAFF", text: "Commandes uniquement : préparation, statut et livraison." },
  { role: "SUPPORT", text: "Accès temporaire en lecture accordé à l'équipe Axi, journalisé. Ne compte pas dans vos places." },
];

export default async function TeamPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "team.manage");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];

  const [members, invitations, seats] = await Promise.all([
    db.membership.findMany({ where: { storeId: store.id }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
    db.invitation.findMany({ where: { storeId: store.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    teamSeats(store.id, ctx.planId),
  ]);
  const owners = members.filter((m) => m.role === "OWNER").length;
  const unlimited = seats.limit == null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((seats.used / Math.max(1, seats.limit!)) * 100));
  const counter = unlimited ? `${seats.used} membre${seats.used > 1 ? "s" : ""}` : `${seats.used} / ${seats.limit} membres`;
  const nextPlan = nextPlanForMembers(ctx.planId);
  const extraOk = canBuyExtraMember(ctx.planId);

  return (
    <>
      <PageHeader
        title="Équipe"
        description="Invitez vos employés et donnez à chacun l'accès dont il a besoin, pas plus."
        actions={seats.allowed ? <InviteDialog storeId={store.id} /> : undefined}
      />

      <div className="space-y-6">
        {/* Places */}
        <section className="bezel" aria-labelledby="seats-title">
          <div className="bezel-core flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <div className="min-w-0 flex-1">
              <h2 id="seats-title" className="text-[13px] font-medium text-ink-muted">
                Places de l&apos;équipe, plan {plan.name}
              </h2>
              <p className="tabular mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.03em] text-ink">{counter}</p>
              <p className="mt-2 text-sm text-ink-muted">
                {seats.members} membre{seats.members > 1 ? "s" : ""} actif{seats.members > 1 ? "s" : ""}
                {seats.pending > 0 ? `, ${seats.pending} invitation${seats.pending > 1 ? "s" : ""} en attente` : ""}
                {seats.extraMembers > 0 ? `. Dont ${seats.extraMembers} place${seats.extraMembers > 1 ? "s" : ""} en option.` : "."}
              </p>
            </div>
            {!unlimited && (
              <div className="w-full sm:w-64">
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line"
                  role="progressbar"
                  aria-label="Places utilisées"
                  aria-valuemin={0}
                  aria-valuemax={seats.limit!}
                  aria-valuenow={seats.used}
                  aria-valuetext={counter}
                >
                  <div className={`h-full rounded-full ${seats.allowed ? "bg-primary" : "bg-sun"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {seats.allowed ? `${seats.limit! - seats.used} place${seats.limit! - seats.used > 1 ? "s" : ""} disponible${seats.limit! - seats.used > 1 ? "s" : ""}` : "Toutes les places sont occupées"}
                </p>
              </div>
            )}
          </div>
        </section>

        {!seats.allowed && seats.limit != null && (
          <PlanGate
            compact
            storeId={store.id}
            plan={nextPlan}
            addOn={extraOk ? "EXTRA_MEMBER" : undefined}
            title="Limite de membres atteinte"
            limit={{ label: "membres", used: seats.used, max: seats.limit }}
            description={
              extraOk
                ? `Les ${seats.limit} places sont occupées (invitations en attente comprises). Ajoutez une place en option ou passez au plan ${PLANS[nextPlan].name}.`
                : `Votre plan inclut ${seats.limit} membre${seats.limit > 1 ? "s" : ""}. Le plan ${PLANS[nextPlan].name} en inclut ${PLANS[nextPlan].limits.members ?? "un nombre illimité"}.`
            }
          />
        )}

        <Card as="section" aria-labelledby="members-title">
          <CardHeader title={<span id="members-title">Membres</span>} description={`${members.length} personne${members.length > 1 ? "s" : ""} avec un accès à ${store.name}.`} />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {members.map((m) => {
              const isSelf = m.user.id === ctx.user.id;
              const lastOwner = m.role === "OWNER" && owners <= 1;
              return (
                <li key={m.id} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-center sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.user.name} size={40} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        <span className="truncate">{m.user.name}</span>
                        {isSelf && <Badge tone="neutral">Vous</Badge>}
                      </p>
                      <p className="truncate text-sm text-ink-muted">{m.user.email}</p>
                      <p className="text-xs text-ink-faint">
                        {m.role === "SUPPORT" && m.expiresAt ? `Accès support, expire ${relativeTime(m.expiresAt)}` : `Membre depuis le ${formatDate(m.createdAt)}`}
                      </p>
                    </div>
                  </div>
                  <div>
                    <RoleSelect storeId={store.id} membershipId={m.id} role={m.role} lastOwner={lastOwner} name={m.user.name} />
                  </div>
                  <div className="flex justify-end">
                    {!lastOwner && m.role !== "SUPPORT" ? <RemoveMemberButton storeId={store.id} membershipId={m.id} name={m.user.name} isSelf={isSelf} /> : <span className="hidden size-11 sm:block" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card as="section" aria-labelledby="inv-title">
          <CardHeader
            title={<span id="inv-title">Invitations en attente</span>}
            description="Valables 7 jours. Chaque invitation en attente occupe une place jusqu'à son acceptation ou sa révocation."
          />
          {invitations.length === 0 ? (
            <EmptyState
              compact
              icon={Mail}
              title="Aucune invitation en attente"
              description={seats.allowed ? "Invitez un gestionnaire ou un préparateur : il reçoit un lien par e-mail." : "Libérez une place pour inviter quelqu'un."}
            />
          ) : (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
                    <Mail className="size-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{i.email}</p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      <Badge tone="neutral">{ROLE_LABELS[i.role]}</Badge>
                      <span>Expire {relativeTime(i.expiresAt)}</span>
                    </p>
                  </div>
                  <InvitationActions storeId={store.id} id={i.id} email={i.email} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" aria-labelledby="roles-title">
          <CardHeader
            title={
              <span id="roles-title" className="inline-flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" aria-hidden /> Les rôles
              </span>
            }
            description="Principe du moindre privilège : chacun ne voit que ce dont il a besoin."
          />
          <CardBody>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ROLE_HELP.map((r) => (
                <div key={r.role} className="rounded-[var(--radius-md)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
                  <dt className="flex items-center gap-2 font-medium text-ink">
                    <Users className="size-4 text-ink-faint" aria-hidden /> {ROLE_LABELS[r.role]}
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{r.text}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
