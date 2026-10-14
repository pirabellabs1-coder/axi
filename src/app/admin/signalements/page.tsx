import type { Metadata } from "next";
import Link from "next/link";
import { Flag, Mail } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { relativeTime, formatDateTime } from "@/lib/utils";
import { REPORT_STATUSES, REPORT_STATUS_LABEL, reasonLabel, type ReportStatus } from "@/lib/reports/constants";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { Pagination, PAGE_SIZE, pageParam, str, STORE_STATUS, StatusBadge } from "@/components/app/admin-bits";
import { ReportActions } from "@/components/admin/report-actions";

export const metadata: Metadata = { title: "Signalements" };

const TONE: Record<ReportStatus, BadgeTone> = { OPEN: "danger", REVIEWING: "sun", RESOLVED: "success", DISMISSED: "neutral" };

export default async function AdminReports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAdminContext();
  const canEdit = ctx.can("stores.moderate");
  const sp = await searchParams;
  const raw = str(sp.status);
  const status = raw === "all" ? "all" : (REPORT_STATUSES as readonly string[]).includes(raw) ? raw : "";
  const page = pageParam(sp.page);
  const where = status === "all" ? {} : status ? { status } : { status: { in: ["OPEN", "REVIEWING"] } };

  const [total, reports, counts] = await Promise.all([
    db.storeReport.count({ where }),
    db.storeReport.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.storeReport.groupBy({ by: ["status"], _count: true }),
  ]);
  const storeIds = [...new Set(reports.map((r) => r.storeId))];
  const [stores, perStore] = await Promise.all([
    storeIds.length ? db.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true, slug: true, status: true, marketplaceBlocked: true } }) : [],
    storeIds.length ? db.storeReport.groupBy({ by: ["storeId"], where: { storeId: { in: storeIds } }, _count: true }) : [],
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader title="Signalements" description="Signalements envoyés depuis les boutiques publiques. Décidez vite : suspendre, retirer de la marketplace ou rejeter. Chaque décision est motivée et journalisée." />

      <LinkTabs
        param="status"
        className="mb-5"
        items={[
          { href: "/admin/signalements", label: "À traiter", count: count("OPEN") + count("REVIEWING") },
          { href: "/admin/signalements?status=RESOLVED", label: "Traités", count: count("RESOLVED") },
          { href: "/admin/signalements?status=DISMISSED", label: "Rejetés", count: count("DISMISSED") },
          { href: "/admin/signalements?status=all", label: "Tous" },
        ]}
      />

      {reports.length === 0 ? (
        <EmptyState icon={Flag} title={status ? "Aucun signalement" : "Aucun signalement à traiter"} description="Les visiteurs signalent une boutique depuis son pied de page (« Signaler cette boutique »)." />
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const s = stores.find((x) => x.id === r.storeId);
            const n = perStore.find((x) => x.storeId === r.storeId)?._count ?? 1;
            return (
              <Card as="li" key={r.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[r.status as ReportStatus] ?? "neutral"} dot>{REPORT_STATUS_LABEL[r.status as ReportStatus] ?? r.status}</Badge>
                      <span className="font-medium text-ink">{reasonLabel(r.reason)}</span>
                      <span className="text-xs text-ink-faint" title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      {s ? (
                        <>
                          <Link href={`/admin/boutiques/${s.id}`} className="font-medium text-ink hover:text-primary">{s.name}</Link>
                          <span className="text-ink-faint">/{s.slug}</span>
                          <StatusBadge map={STORE_STATUS} value={s.status} />
                          {s.marketplaceBlocked && <Badge tone="neutral">Hors marketplace</Badge>}
                          {n > 1 && <Badge tone="warning">{n} signalements</Badge>}
                        </>
                      ) : (
                        <span className="text-ink-muted">Boutique supprimée</span>
                      )}
                    </p>
                  </div>
                  {s && <ReportActions reportId={r.id} storeName={s.name} status={r.status} storeSuspended={s.status === "SUSPENDED"} storeBlocked={s.marketplaceBlocked} canEdit={canEdit} />}
                </div>
                {r.message && <p className="mt-3 max-w-[72ch] whitespace-pre-line rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-sm text-ink [overflow-wrap:anywhere]">{r.message}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  {r.reporterEmail && (
                    <a href={`mailto:${r.reporterEmail}`} className="inline-flex min-h-8 items-center gap-1 hover:text-ink">
                      <Mail className="size-3.5" aria-hidden /> {r.reporterEmail}
                    </a>
                  )}
                  {r.resolution && <span className="inline-flex min-h-8 items-center">Décision : {r.resolution}</span>}
                </div>
              </Card>
            );
          })}
        </ul>
      )}
      <Pagination page={page} total={total} basePath="/admin/signalements" params={{ status }} />
      {!canEdit && <p className="mt-4 text-sm text-ink-muted">Lecture seule : la modération est réservée aux super-administrateurs.</p>}
    </>
  );
}
