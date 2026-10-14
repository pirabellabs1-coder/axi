import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Blocks, Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import Link from "next/link";
import { listDeveloperApps } from "@/lib/apps/dev-queries";
import { APP_CATEGORY_LABELS, formatAppPrice, isAppCategory } from "@/lib/apps/types";
import { formatDate } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppIcon } from "@/app/app/[storeId]/applications/app-visuals";
import { AppStatusBadge } from "./app-status";
import { devBase } from "@/app/app/[storeId]/developpeur/_components/dev-base";

export const metadata: Metadata = { title: "Mes applications" };

export default async function DeveloperAppsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const dev = devBase((await params).storeId);
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  // Isolation : uniquement les apps dont ce développeur est propriétaire.
  const apps = await listDeveloperApps(user.id);

  return (
    <>
      <PageHeader
        title="Mes applications"
        description="Créez, configurez et soumettez vos applications à la plateforme Axi. Votre application est hébergée sur votre serveur ; chaque application reçoit une identité OAuth pour se connecter à Axi."
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${dev}/apps/nouvelle`}>
              <Plus className="size-4" aria-hidden /> Créer une application
            </ButtonLink>
          </div>
        }
      />

      {apps.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title="Aucune application pour le moment"
          description="Publiez votre première intégration sur l'App Store d'Axi : connectez vos outils à l'API, proposez-la aux marchands et suivez les installations."
          action={
            <ButtonLink href={`${dev}/apps/nouvelle`}>
              <Plus className="size-4" aria-hidden /> Créer une application
            </ButtonLink>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {apps.map((app) => (
            <Card as="li" key={app.id} className="transition-shadow hover:ring-primary/30">
              <Link href={`${dev}/apps/${app.id}`} className="block rounded-[var(--radius-lg)] p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <div className="flex items-start gap-3">
                  <AppIcon name={app.name} iconUrl={app.iconUrl} category={app.category} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="truncate font-semibold text-ink">{app.name}</h2>
                      <AppStatusBadge status={app.status} />
                    </div>
                    {app.tagline && <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{app.tagline}</p>}
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                      <span>{isAppCategory(app.category) ? APP_CATEGORY_LABELS[app.category] : app.category}</span>
                      <span aria-hidden>·</span>
                      <span>{formatAppPrice(app.pricingType, app.priceAmount, app.priceInterval, app.trialDays)}</span>
                      <span aria-hidden>·</span>
                      <span>{app.liveInstallCount} installation{app.liveInstallCount > 1 ? "s" : ""}</span>
                      {app.testInstallCount > 0 && (<><span aria-hidden>·</span><span>{app.testInstallCount} en test</span></>)}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">Modifiée le {formatDate(app.updatedAt)}</p>
                  </div>
                </div>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}
