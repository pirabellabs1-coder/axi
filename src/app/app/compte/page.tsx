import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, KeyRound, MonitorSmartphone, ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import { MfaPanel } from "@/components/admin/mfa-panel";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { formatDate } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "@/components/app/user-menu";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProfileForm, PasswordForm, SessionsList, DeleteAccount } from "./compte-client";

export const metadata: Metadata = { title: "Mon compte" };

const NAV = [
  { href: "#profil", label: "Profil", icon: UserRound },
  { href: "#mot-de-passe", label: "Mot de passe", icon: KeyRound },
  { href: "#double-authentification", label: "Double authentification", icon: ShieldCheck },
  { href: "#appareils", label: "Appareils connectés", icon: MonitorSmartphone },
  { href: "#zone-sensible", label: "Zone sensible", icon: TriangleAlert },
];

export default async function AccountPage() {
  const user = (await getCurrentUser())!;
  const jar = await cookies();
  const currentHash = sha256(jar.get(SESSION_COOKIE)?.value ?? "");

  const [full, sessions, ownedActive, storeCount] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { phone: true, createdAt: true, mfaEnabled: true, mfaSecretEnc: true } }),
    db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.membership.count({ where: { userId: user.id, role: "OWNER", store: { status: { not: "ARCHIVED" } } } }),
    db.membership.count({ where: { userId: user.id, store: { status: { not: "ARCHIVED" } } } }),
  ]);

  const blocked =
    ownedActive > 0
      ? `Vous êtes propriétaire de ${ownedActive} boutique${ownedActive > 1 ? "s" : ""} active${ownedActive > 1 ? "s" : ""}. Archivez-la (Paramètres, Zone sensible) ou transférez la propriété à un autre membre avant de supprimer votre compte.`
      : null;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between gap-3">
          <Logo href="/app" />
          <UserMenu name={user.name} email={user.email} isAdmin={user.isPlatformAdmin} />
        </div>
      </header>

      <main id="contenu" className="container-x pb-20 pt-6 sm:pt-10">
        <Link href="/app" className="-ml-1 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-sm text-ink-muted transition-colors hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Mes boutiques
        </Link>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[30px]">Mon compte</h1>
            <p className="mt-1 text-sm text-ink-muted">Profil, sécurité et appareils connectés.</p>
            <nav aria-label="Sections du compte" className="mt-5">
              <ul className="relative scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 lg:flex-col lg:overflow-visible">
                {NAV.map((n) => (
                  <li key={n.href} className="shrink-0">
                    <a
                      href={n.href}
                      className="inline-flex h-11 w-full items-center gap-2.5 rounded-full px-4 text-sm font-medium text-ink-muted ring-1 ring-inset ring-line transition-colors hover:bg-surface hover:text-ink lg:rounded-[var(--radius-md)] lg:px-3 lg:ring-0"
                    >
                      <n.icon className="size-4" aria-hidden /> {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="min-w-0 max-w-2xl space-y-6">
            <section className="bezel" aria-label="Résumé du compte">
              <div className="bezel-core flex flex-wrap items-center gap-4 p-5 sm:p-6">
                <Avatar name={user.name} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold tracking-[-0.02em] text-ink">{user.name}</p>
                  <p className="truncate text-sm text-ink-muted">{user.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {user.isPlatformAdmin && <Badge tone="info">Administrateur Axi</Badge>}
                  <Badge tone="neutral">
                    {storeCount} boutique{storeCount > 1 ? "s" : ""}
                  </Badge>
                  {full?.createdAt && <Badge tone="neutral">Depuis le {formatDate(full.createdAt)}</Badge>}
                </div>
              </div>
            </section>

            <Card as="section" id="profil" aria-labelledby="profile-title" className="scroll-mt-24">
              <CardHeader title={<span id="profile-title">Profil</span>} description="Votre nom apparaît dans l'historique des commandes et les invitations." />
              <CardBody>
                <ProfileForm name={user.name} email={user.email} phone={full?.phone ?? ""} />
              </CardBody>
            </Card>

            <Card as="section" id="mot-de-passe" aria-labelledby="pw-title" className="scroll-mt-24">
              <CardHeader title={<span id="pw-title">Mot de passe</span>} description="Changer votre mot de passe ne déconnecte pas vos autres appareils : utilisez la section suivante si besoin." />
              <CardBody>
                <PasswordForm />
              </CardBody>
            </Card>

            <section id="double-authentification" aria-label="Double authentification" className="scroll-mt-24">
              <MfaPanel enabled={!!full?.mfaEnabled} pendingEnrollment={!full?.mfaEnabled && !!full?.mfaSecretEnc} email={user.email} scope="account" />
            </section>

            <Card as="section" id="appareils" aria-labelledby="sessions-title" className="scroll-mt-24">
              <CardHeader
                title={<span id="sessions-title">Appareils connectés</span>}
                description="Si vous ne reconnaissez pas un appareil, déconnectez-le puis changez votre mot de passe."
                action={<Badge tone="neutral">{sessions.length}</Badge>}
              />
              <CardBody className="pt-2">
                <SessionsList
                  sessions={sessions.map((s) => ({
                    id: s.id,
                    userAgent: s.userAgent,
                    ip: s.ip,
                    createdAt: s.createdAt.toISOString(),
                    expiresAt: s.expiresAt.toISOString(),
                    current: s.tokenHash === currentHash,
                  }))}
                />
              </CardBody>
            </Card>

            <Card as="section" id="zone-sensible" aria-labelledby="delete-title" className="scroll-mt-24 ring-danger/30">
              <CardHeader title={<span id="delete-title" className="text-danger">Zone sensible</span>} />
              <CardBody>
                <DeleteAccount blockedReason={blocked} />
              </CardBody>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
