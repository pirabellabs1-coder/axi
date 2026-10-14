import type { Metadata } from "next";
import { Code2, Clock, Ban, CheckCircle2, Archive, Link2Off, Check, X, type LucideIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { collaboratorState, COLLAB_PERMISSION_LABELS, COLLAB_CANNOT } from "@/lib/apps/collaborator-logic";
import type { CollaboratorPermission } from "@/lib/apps/collaborators";
import { formatDate } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { getCollaboratorInvite } from "./data";
import { InviteButtons } from "./invite-buttons";

export const metadata: Metadata = { title: "Invitation développeur", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Problem = { icon: LucideIcon; title: string; text: string };

export default async function DeveloperInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, inv] = await Promise.all([getCurrentUser(), getCollaboratorInvite(token)]);
  const next = `/invitation-developpeur/${token}`;

  let problem: Problem | null = null;
  if (!inv) problem = { icon: Link2Off, title: "Lien invalide", text: "Ce lien d'invitation est incomplet ou n'existe pas. Vérifiez qu'il a été copié en entier." };
  else {
    const state = collaboratorState(inv);
    if (state === "revoked") problem = { icon: Ban, title: "Invitation révoquée", text: "Cette invitation a été annulée ou refusée. Contactez le marchand qui vous l'a envoyée." };
    else if (state === "active") problem = { icon: CheckCircle2, title: "Invitation déjà acceptée", text: "La boutique figure déjà dans votre portail développeur, parmi vos boutiques de test." };
    else if (state === "expired") problem = { icon: Clock, title: "Invitation expirée", text: "Les invitations sont valables 7 jours. Demandez au marchand de vous la renvoyer." };
    else if (inv.store.status === "ARCHIVED") problem = { icon: Archive, title: "Boutique archivée", text: "Cette boutique n'est plus active." };
  }
  const wrongAccount = !!(inv && user && inv.email !== user.email.toLowerCase());
  const ProblemIcon = problem?.icon ?? Ban;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between gap-3">
          <Logo />
          {user && (
            <span className="min-w-0 truncate text-sm text-ink-muted">
              Connecté : <span className="text-ink">{user.email}</span>
            </span>
          )}
        </div>
      </header>

      <main id="contenu" className="container-x flex flex-1 items-start justify-center py-10 sm:items-center sm:py-16">
        <div className="bezel w-full max-w-md">
          <div className="bezel-core px-6 py-8 text-center sm:px-8 sm:py-10">
            {problem || !inv ? (
              <>
                <span className="mx-auto mb-5 inline-flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning ring-1 ring-inset ring-line">
                  <ProblemIcon className="size-6" aria-hidden />
                </span>
                <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">{problem?.title ?? "Invitation indisponible"}</h1>
                <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted">{problem?.text}</p>
                <ButtonLink href={user ? "/developpeur" : "/connexion"} variant="secondary" className="mt-7 w-full">
                  {user ? "Aller au portail développeur" : "Se connecter"}
                </ButtonLink>
              </>
            ) : (
              <>
                <span className="mx-auto inline-flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10">
                  <Code2 className="size-7" aria-hidden />
                </span>
                <p className="mt-5 text-sm text-ink-muted">{inv.invitedBy?.name ?? "Un marchand"} vous invite comme développeur sur</p>
                <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.035em] text-ink [overflow-wrap:anywhere]">{inv.store.name}</h1>

                <div className="mt-6 text-left">
                  <h2 className="text-sm font-medium text-ink">Vous pourrez</h2>
                  <ul className="mt-2 grid gap-2 text-sm text-ink">
                    {inv.permissions.map((p) => (
                      <li key={p} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <span>{COLLAB_PERMISSION_LABELS[p as CollaboratorPermission]?.title ?? p}</span>
                      </li>
                    ))}
                  </ul>
                  <h2 className="mt-4 text-sm font-medium text-ink">Vous ne pourrez pas</h2>
                  <ul className="mt-2 grid gap-2 text-sm text-ink-muted">
                    {COLLAB_CANNOT.map((t) => (
                      <li key={t} className="flex gap-2">
                        <X className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                  {inv.message && (
                    <blockquote className="mt-4 rounded-[var(--radius-md)] bg-surface-2/60 p-3 text-sm text-ink-muted ring-1 ring-inset ring-line [overflow-wrap:anywhere]">
                      « {inv.message} »
                    </blockquote>
                  )}
                </div>

                <div className="mt-7 border-t border-line pt-6">
                  {!user ? (
                    <div className="space-y-2">
                      <ButtonLink href={`/inscription?next=${encodeURIComponent(next)}`} variant="accent" className="w-full" trailing>
                        Créer mon compte
                      </ButtonLink>
                      <ButtonLink href={`/connexion?next=${encodeURIComponent(next)}`} variant="outline" className="w-full">
                        J&apos;ai déjà un compte
                      </ButtonLink>
                      <p className="pt-2 text-[13px] text-ink-muted">
                        Utilisez l&apos;adresse <span className="font-medium text-ink">{inv.email}</span>, puis revenez sur ce lien.
                      </p>
                    </div>
                  ) : wrongAccount ? (
                    <div className="space-y-4 text-left">
                      <Alert tone="warning" title="Mauvais compte">
                        Vous êtes connecté avec {user.email}, mais l&apos;invitation est destinée à {inv.email}.
                      </Alert>
                      <ButtonLink href={`/connexion?next=${encodeURIComponent(next)}`} variant="outline" className="w-full">
                        Changer de compte
                      </ButtonLink>
                    </div>
                  ) : (
                    <InviteButtons token={token} storeName={inv.store.name} />
                  )}
                </div>
                <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-ink-faint">
                  <Clock className="size-3.5" aria-hidden /> Invitation pour {inv.email}, valable jusqu&apos;au {formatDate(inv.expiresAt)}
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
