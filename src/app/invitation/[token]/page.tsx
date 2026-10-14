import type { Metadata } from "next";
import Link from "next/link";
import { Store as StoreIcon, AlertTriangle, Clock, Ban, CheckCircle2, Archive, Link2Off, Check, type LucideIcon } from "lucide-react";
import type { MembershipRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { getInvitationByToken } from "@/lib/team/invitations";
import { formatDate } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ROLE_CAN: Partial<Record<MembershipRole, string[]>> = {
  OWNER: ["Gérer toute la boutique", "Paiements, abonnement et équipe"],
  MANAGER: ["Produits, commandes et clients", "Promotions, livraison et apparence"],
  STAFF: ["Voir et préparer les commandes", "Mettre à jour les statuts et les livraisons"],
};

type Problem = { icon: LucideIcon; title: string; text: string };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, inv] = await Promise.all([getCurrentUser(), getInvitationByToken(token)]);
  const next = `/invitation/${token}`;

  let problem: Problem | null = null;
  if (!inv) problem = { icon: Link2Off, title: "Lien invalide", text: "Ce lien d'invitation est incomplet ou n'existe pas. Vérifiez qu'il a été copié en entier." };
  else if (inv.revokedAt) problem = { icon: Ban, title: "Invitation révoquée", text: "La boutique a annulé cette invitation. Contactez la personne qui vous l'a envoyée." };
  else if (inv.acceptedAt) problem = { icon: CheckCircle2, title: "Invitation déjà acceptée", text: "Vous faites déjà partie de l'équipe : retrouvez la boutique dans votre espace." };
  else if (inv.expiresAt < new Date()) problem = { icon: Clock, title: "Invitation expirée", text: "Les invitations sont valables 7 jours. Demandez au propriétaire de vous la renvoyer." };
  else if (inv.store.status === "ARCHIVED") problem = { icon: Archive, title: "Boutique archivée", text: "Cette boutique n'est plus active." };

  const shown: Problem = problem ?? { icon: AlertTriangle, title: "Invitation indisponible", text: "Cette invitation ne peut pas être utilisée." };
  const ProblemIcon = shown.icon;
  const wrongAccount = !!(inv && user && inv.email !== user.email.toLowerCase());

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
                <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">{shown.title}</h1>
                <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted">{shown.text}</p>
                <ButtonLink href={user ? "/app" : "/connexion"} variant="secondary" className="mt-7 w-full">
                  {user ? "Aller à mes boutiques" : "Se connecter"}
                </ButtonLink>
              </>
            ) : (
              <>
                {inv.store.logoUrl ? (
                  <Avatar name={inv.store.name} src={inv.store.logoUrl} size={64} className="mx-auto ring-4 ring-surface-2" />
                ) : (
                  <span className="mx-auto inline-flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10">
                    <StoreIcon className="size-7" aria-hidden />
                  </span>
                )}
                <p className="mt-5 text-sm text-ink-muted">{inv.invitedBy.name} vous invite à rejoindre</p>
                <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.035em] text-ink [overflow-wrap:anywhere]">{inv.store.name}</h1>
                <div className="mt-3 flex justify-center">
                  <Badge tone="primary">{ROLE_LABELS[inv.role]}</Badge>
                </div>

                {ROLE_CAN[inv.role] && (
                  <ul className="mx-auto mt-6 grid max-w-xs gap-2 text-left text-sm text-ink">
                    {ROLE_CAN[inv.role]!.map((c) => (
                      <li key={c} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                )}

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
                        Utilisez l&apos;adresse <span className="font-medium text-ink">{inv.email}</span>.
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
                    <>
                      <AcceptButton token={token} storeName={inv.store.name} />
                      <Link href="/app" className="mt-2 inline-flex min-h-11 items-center rounded-full px-3 text-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline">
                        Plus tard
                      </Link>
                    </>
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
