import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, ExternalLink, Users, AppWindow } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { getAppBySlug, listStoreInstallations } from "@/lib/apps/queries";
import { APP_CATEGORY_LABELS, formatAppPrice, isAppCategory, effectiveGrantedScopes } from "@/lib/apps/types";
import { parseScopes, planScopes, SCOPE_LABELS } from "@/lib/mcp/scopes";
import { MCP_LIMITS } from "@/config/plans";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { cn, formatDate } from "@/lib/utils";
import { AppIcon } from "../app-visuals";
import { InstallControls, type ScopeView } from "./install-controls";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  return { title: app ? app.name : "Application" };
}

export default async function AppDetailPage({ params }: { params: Promise<{ storeId: string; slug: string }> }) {
  const { storeId, slug } = await params;
  const ctx = await getStoreContext(storeId, "store.view");
  const base = `/app/${storeId}/applications`;

  const [published, installations] = await Promise.all([getAppBySlug(slug), listStoreInstallations(storeId)]);
  // Une app retirée du catalogue (dépubliée ou suspendue) reste consultable — et désinstallable — si elle est installée.
  const app = published ?? installations.find((i) => i.app.slug === slug && i.status === "ACTIVE")?.app ?? null;
  if (!app) notFound();
  const active = installations.find((i) => i.appId === app.id && i.status === "ACTIVE") ?? null;
  const suspended = app.status === "SUSPENDED";
  const canOpen = active !== null && !suspended;
  // L'accès API d'une app (jetons OAuth) suit la règle des connexions OAuth : plan Business ou supérieur.
  const apiNeedsPlan = !!app.oauthClientId && !MCP_LIMITS[ctx.planId].oauth;
  const installed = active !== null;
  const canManage = ctx.can("integrations.manage");

  // Permissions demandées, ordonnées canoniquement, avec distinction accordée / limitée par le plan.
  const requested = parseScopes(app.requestedScopes);
  const grantedSet = new Set(effectiveGrantedScopes(app.requestedScopes, planScopes(ctx.planId)));
  const scopes: ScopeView[] = requested.map((s) => ({
    key: s,
    label: SCOPE_LABELS[s].label,
    description: SCOPE_LABELS[s].description,
    write: SCOPE_LABELS[s].write,
    granted: grantedSet.has(s),
  }));
  const categoryLabel = APP_CATEGORY_LABELS[isAppCategory(app.category) ? app.category : "autre"];
  const paragraphs = (app.description ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <>
      <Link href={base} className="mb-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Catalogue
      </Link>

      {/* En-tête */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <AppIcon name={app.name} iconUrl={app.iconUrl} category={app.category} size={64} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">{app.name}</h1>
              {app.firstParty && <Badge tone="primary">Axi</Badge>}
              {installed && <Badge tone="success" dot>Installée</Badge>}
            </div>
            {app.tagline && <p className="mt-1 text-sm text-ink-muted">{app.tagline}</p>}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              <span>{app.developerName}</span>
              <span aria-hidden>·</span>
              <Badge tone="neutral">{categoryLabel}</Badge>
              <span aria-hidden>·</span>
              <span className="font-medium text-ink">{formatAppPrice(app.pricingType, app.priceAmount, app.priceInterval, app.trialDays)}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          {canOpen && (
            <a
              href={`${base}/${app.slug}/ouvrir`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
            >
              {/* <a> et non <Link> : la CSP de /ouvrir (frame-src élargi) ne s’applique qu’au chargement complet du document. */}
              <AppWindow className="size-4" aria-hidden /> Ouvrir l&apos;application
            </a>
          )}
          <InstallControls
            storeId={storeId}
            slug={app.slug}
            appName={app.name}
            installed={installed}
            installationId={active?.id ?? null}
            scopes={scopes}
            canManage={canManage}
            billingStatus={active?.billingStatus ?? null}
            trialEndsLabel={active?.trialEndsAt ? formatDate(active.trialEndsAt) : null}
          />
        </div>
      </div>

      {app.status !== "PUBLISHED" && (
        <Alert tone="warning" className="mt-6">
          {suspended
            ? "Cette application a été suspendue par Axi : elle n'a plus accès à votre boutique. Vous pouvez la désinstaller."
            : "Cette application n'est plus proposée au catalogue. Elle reste installée ; vous pouvez la désinstaller à tout moment."}
        </Alert>
      )}
      {apiNeedsPlan && !active && (
        <Alert tone="info" className="mt-6">
          Cette application utilise l&apos;API d&apos;Axi : son accès à vos données nécessite le plan Business ou supérieur. Vous pouvez l&apos;installer, mais elle ne pourra pas se connecter avant un changement de plan.
        </Alert>
      )}

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Description */}
        <section aria-labelledby="desc-title">
          <h2 id="desc-title" className="mb-3 text-lg font-semibold tracking-[-0.02em] text-ink">À propos</h2>
          {paragraphs.length > 0 ? (
            <div className="space-y-3 text-sm leading-relaxed text-ink-muted">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">{app.tagline ?? "Aucune description fournie."}</p>
          )}
          {app.supportUrl && (
            <a href={app.supportUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
              Assistance et site du développeur <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {app.installCount > 0 && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-ink-muted">
              <Users className="size-4" aria-hidden /> {app.installCount.toLocaleString("fr-FR")} installation{app.installCount > 1 ? "s" : ""}
            </p>
          )}
        </section>

        {/* Permissions demandées */}
        <Card as="section" aria-labelledby="perms-title">
          <CardBody>
            <h2 id="perms-title" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Autorisations demandées
            </h2>
            <p className="mt-1 text-sm text-ink-muted">Ce que cette application pourra faire dans votre boutique.</p>
            {scopes.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted">Aucune autorisation d&apos;accès aux données n&apos;est requise.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {scopes.map((s) => (
                  <li key={s.key} className="flex items-start gap-2.5">
                    <span className={cn("mt-1 inline-flex size-2 shrink-0 rounded-full", s.write ? "bg-accent" : "bg-primary")} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {s.label}
                        <span className="ml-2 align-middle text-[11px] font-normal text-ink-muted">{s.write ? "écriture" : "lecture"}</span>
                        {!s.granted && <span className="ml-2 align-middle text-[11px] font-normal text-[#8a5a00] dark:text-sun">limitée par le plan</span>}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{s.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {scopes.some((s) => !s.granted) && (
              <Alert tone="info" className="mt-4">
                Votre plan actuel ne couvre pas toutes les autorisations : l&apos;application s&apos;installera avec les accès disponibles.
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
