import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Code2, Store } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { homeStoreHref } from "@/lib/apps/dev-queries";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Espace développeur", robots: { index: false, follow: false } };

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Ancienne entrée /developpeur/** : l'espace développeur vit désormais dans l'admin de la boutique
 * (/app/<storeId>/developpeur/**, avec la barre latérale). Redirection vers la boutique de la 1re adhésion ;
 * sans boutique, page minimale qui oriente vers la création de boutique.
 */
export default async function LegacyDeveloperEntry({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const rest = path.filter((s) => SAFE_SEGMENT.test(s)).join("/");
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?next=${encodeURIComponent(`/developpeur${rest ? `/${rest}` : ""}`)}`);

  const home = await homeStoreHref(user.id);
  if (home !== "/app") redirect(`${home}/developpeur${rest ? `/${rest}` : ""}`);

  return (
    <div className="min-h-dvh bg-canvas px-4 py-8">
      <div className="mx-auto max-w-lg">
        <Logo href="/" />
        <main id="contenu" className="mt-10 rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-8">
          <Code2 className="size-6 text-primary" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink">Espace développeur</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            L&apos;espace développeur se trouve dans l&apos;administration de votre boutique. Créez une boutique (gratuite) : elle vous servira aussi de
            boutique de test pour vos applications.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/app/nouvelle-boutique">
              <Store className="size-4" aria-hidden /> Créer une boutique
            </ButtonLink>
            <ButtonLink href="/" variant="outline">Retour au site</ButtonLink>
          </div>
          <p className="mt-6 text-sm text-ink-muted">
            Invité comme collaborateur développeur ? Ouvrez le lien d&apos;invitation reçu par e-mail. <Link href="/developpeurs" className="font-medium text-primary-deep underline">Documentation publique</Link>
          </p>
        </main>
      </div>
    </div>
  );
}
