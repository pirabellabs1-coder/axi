import type { Metadata } from "next";
import { Blocks } from "lucide-react";
import type { Prisma, AppStatus } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { APP_CATEGORY_LABELS, formatAppPrice, isAppCategory } from "@/lib/apps/types";
import { SCOPE_LABELS } from "@/lib/mcp/scopes";
import { isScope } from "@/lib/mcp/scopes";
import { formatDate } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { AppIcon } from "@/app/app/[storeId]/applications/app-visuals";
import { AppStatusBadge } from "@/app/app/[storeId]/developpeur/apps/app-status";
import { ReviewControls } from "./review-controls";

export const metadata: Metadata = { title: "Applications" };

const FILTERS = [
  { value: "revue", label: "En revue", status: "IN_REVIEW" as AppStatus },
  { value: "publiees", label: "Publiées", status: "PUBLISHED" as AppStatus },
  { value: "suspendues", label: "Suspendues", status: "SUSPENDED" as AppStatus },
  { value: "brouillons", label: "Brouillons", status: "DRAFT" as AppStatus },
  { value: "toutes", label: "Toutes", status: undefined },
] as const;

export default async function AdminApplications({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.value === sp.statut) ?? FILTERS[0];

  const where: Prisma.AppWhereInput = filter.status ? { status: filter.status } : {};
  const [inReviewCount, apps] = await Promise.all([
    db.app.count({ where: { status: "IN_REVIEW" } }),
    db.app.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: { developer: { select: { name: true, email: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Applications"
        description={inReviewCount > 0 ? `${inReviewCount} application${inReviewCount > 1 ? "s" : ""} en attente de revue.` : "Revue et modération des applications tierces de l'App Store."}
      />

      <div className="mb-5">
        <Segmented
          label="Filtrer les applications"
          size="sm"
          value={filter.value}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label, href: `/admin/applications${f.value === "revue" ? "" : `?statut=${f.value}`}` }))}
        />
      </div>

      {apps.length === 0 ? (
        <EmptyState icon={Blocks} title="Aucune application" description="Aucune application ne correspond à ce filtre." />
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => (
            <Card as="li" key={app.id} className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <AppIcon name={app.name} iconUrl={app.iconUrl} category={app.category} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-ink">{app.name}</h2>
                    <AppStatusBadge status={app.status} />
                    {app.firstParty && <Badge tone="primary">Axi</Badge>}
                    {app.listed && <Badge tone="info">Au catalogue</Badge>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-ink-faint">/{app.slug}</p>
                  {app.tagline && <p className="mt-1 text-sm text-ink-muted">{app.tagline}</p>}
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                    <span>Par {app.developer?.name ?? app.developerName}{app.developer?.email ? ` · ${app.developer.email}` : ""}</span>
                    <span aria-hidden>·</span>
                    <span>{isAppCategory(app.category) ? APP_CATEGORY_LABELS[app.category] : app.category}</span>
                    <span aria-hidden>·</span>
                    <span>{formatAppPrice(app.pricingType, app.priceAmount, app.priceInterval, app.trialDays)}</span>
                    <span aria-hidden>·</span>
                    <span>Mise à jour le {formatDate(app.updatedAt)}</span>
                  </p>
                  {app.requestedScopes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {app.requestedScopes.map((s) => (
                        <Badge key={s} tone={isScope(s) && SCOPE_LABELS[s].write ? "warning" : "neutral"}>
                          {isScope(s) ? SCOPE_LABELS[s].label : s}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="w-full sm:w-auto">
                  <ReviewControls appId={app.id} status={app.status} />
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}
