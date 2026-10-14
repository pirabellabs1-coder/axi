import type { Metadata } from "next";
import { Check, Code2, X } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { collaboratorState, COLLAB_STATE_LABELS, COLLAB_PERMISSION_LABELS, COLLAB_CANNOT, type CollaboratorState } from "@/lib/apps/collaborator-logic";
import type { CollaboratorPermission } from "@/lib/apps/collaborators";
import { formatDate, relativeTime } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { InviteDeveloperDialog, CollaboratorActions } from "./developpeurs-client";

export const metadata: Metadata = { title: "Développeurs et collaborateurs" };

const STATE_TONE: Record<CollaboratorState, BadgeTone> = { pending: "info", expired: "warning", active: "success", revoked: "neutral" };

export default async function DevelopersPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "integrations.manage");
  const store = ctx.store;

  const rows = await db.storeCollaborator.findMany({
    where: { storeId: store.id },
    select: { id: true, email: true, status: true, permissions: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true, user: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Développeurs et collaborateurs"
        description="Autorisez un développeur à tester ses applications sur votre boutique, sans lui donner accès à votre activité."
        actions={<InviteDeveloperDialog storeId={store.id} />}
      />

      <div className="space-y-6">
        <Card as="section" aria-labelledby="collab-list-title">
          <CardHeader title={<span id="collab-list-title">Collaborateurs</span>} description="Invitations en attente, accès actifs et accès révoqués." />
          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={Code2}
              title="Aucun développeur invité"
              description="Invitez le développeur qui crée une application pour vous : il pourra l'installer en test sur votre boutique."
            />
          ) : (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {rows.map((r) => {
                const state = collaboratorState(r, now);
                const detail =
                  state === "active" && r.acceptedAt
                    ? `Actif depuis le ${formatDate(r.acceptedAt)}`
                    : state === "pending"
                      ? `Invitation expire ${relativeTime(r.expiresAt)}`
                      : state === "expired"
                        ? "Invitation expirée : renvoyez-la"
                        : r.revokedAt
                          ? `Révoqué le ${formatDate(r.revokedAt)}`
                          : "Révoqué";
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        <span className="truncate [overflow-wrap:anywhere]">{r.user?.name ?? r.email}</span>
                        <Badge tone={STATE_TONE[state]} dot>
                          {COLLAB_STATE_LABELS[state]}
                        </Badge>
                      </p>
                      {r.user?.name && <p className="truncate text-sm text-ink-muted">{r.email}</p>}
                      <p className="mt-1 text-sm text-ink-muted">
                        {r.permissions.map((p) => COLLAB_PERMISSION_LABELS[p as CollaboratorPermission]?.title ?? p).join(" · ")}
                      </p>
                      <p className="text-xs text-ink-faint">{detail}</p>
                    </div>
                    {state !== "revoked" && (
                      <CollaboratorActions storeId={store.id} id={r.id} email={r.email} canResend={state === "pending" || state === "expired"} active={state === "active"} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card as="section" aria-labelledby="collab-rules-title">
          <CardHeader title={<span id="collab-rules-title">Ce qu&apos;un collaborateur peut faire</span>} description="Vous gardez le contrôle : l'accès se révoque à tout moment, en un clic." />
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-[var(--radius-md)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
                <h3 className="font-medium text-ink">Il peut</h3>
                <ul className="mt-2 grid gap-2 text-sm text-ink-muted">
                  {Object.values(COLLAB_PERMISSION_LABELS).map((p) => (
                    <li key={p.title} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>
                        <span className="font-medium text-ink">{p.title}</span> (si vous l&apos;autorisez). {p.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[var(--radius-md)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
                <h3 className="font-medium text-ink">Il ne peut pas</h3>
                <ul className="mt-2 grid gap-2 text-sm text-ink-muted">
                  {COLLAB_CANNOT.map((t) => (
                    <li key={t} className="flex gap-2">
                      <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
