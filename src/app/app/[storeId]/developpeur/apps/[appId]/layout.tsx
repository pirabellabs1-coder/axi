import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getOwnedApp } from "@/lib/apps/dev-queries";
import { LinkTabs } from "@/components/ui/tabs";
import { AppIcon } from "@/app/app/[storeId]/applications/app-visuals";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { AppStatusBadge } from "../app-status";
import { devBase } from "../../_components/dev-base";

/** Coquille de la fiche d'une application : fil d'Ariane, identité, onglets. Isolation par propriétaire. */
export default async function AppDetailLayout({ children, params }: { children: React.ReactNode; params: Promise<{ storeId: string; appId: string }> }) {
  const { storeId, appId } = await params;
  const dev = devBase(storeId);
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const app = await getOwnedApp(appId, user.id);
  if (!app) notFound();

  const base = `${dev}/apps/${app.id}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { href: dev, label: "Espace développeur" },
          { href: `${dev}/apps`, label: "Mes applications" },
          { label: app.name },
        ]}
      />
      <div className="mb-5 flex items-center gap-3">
        <AppIcon name={app.name} iconUrl={app.iconUrl} category={app.category} size={48} />
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-semibold tracking-[-0.03em] text-ink sm:text-[28px]">{app.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <AppStatusBadge status={app.status} />
            <span className="font-mono text-xs">{app.slug}</span>
            {app.listed && <span className="text-xs">Visible au catalogue</span>}
          </p>
        </div>
      </div>
      <LinkTabs
        className="mb-6"
        items={[
          { href: base, label: "Vue d'ensemble", exact: true },
          { href: `${base}/identifiants`, label: "Identifiants" },
          { href: `${base}/configuration`, label: "Configuration" },
          { href: `${base}/fiche`, label: "Fiche catalogue" },
          { href: `${base}/tests`, label: "Tests" },
          { href: `${base}/revue`, label: "Statut et revue" },
        ]}
      />
      {children}
    </>
  );
}
