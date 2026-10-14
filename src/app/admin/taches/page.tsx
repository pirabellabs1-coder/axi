import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Bell } from "lucide-react";
import type { JobStatus, NotificationStatus } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { JOB_STATUS, NOTIF_STATUS, StatusBadge, Pagination, PAGE_SIZE, pageParam, str, JsonDetails } from "@/components/app/admin-bits";
import { RunJobsButton, RetryJobButton, RetryNotificationButton } from "./job-actions";

export const metadata: Metadata = { title: "Tâches et notifications" };

const JOB_STATUSES: JobStatus[] = ["PENDING", "RUNNING", "DONE", "FAILED", "DEAD"];
const NOTIF_STATUSES: NotificationStatus[] = ["QUEUED", "SENT", "FAILED", "SKIPPED"];

export default async function AdminJobs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const jobStatus = str(sp.status);
  const notifStatus = str(sp.notif);
  const page = pageParam(sp.page);
  const notifPage = pageParam(sp.notifPage);

  const jobWhere = jobStatus && JOB_STATUSES.includes(jobStatus as JobStatus) ? { status: jobStatus as JobStatus } : { status: { in: ["PENDING", "RUNNING", "FAILED", "DEAD"] as JobStatus[] } };
  const notifWhere = notifStatus && NOTIF_STATUSES.includes(notifStatus as NotificationStatus) ? { status: notifStatus as NotificationStatus } : { status: { in: ["QUEUED", "FAILED"] as NotificationStatus[] } };

  const [jobCounts, notifCounts, jobTotal, jobs, notifTotal, notifs] = await Promise.all([
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
    db.notification.groupBy({ by: ["status"], _count: { _all: true } }),
    db.job.count({ where: jobWhere }),
    db.job.findMany({ where: jobWhere, orderBy: [{ status: "asc" }, { runAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { store: { select: { id: true, name: true } } } }),
    db.notification.count({ where: notifWhere }),
    db.notification.findMany({ where: notifWhere, orderBy: { createdAt: "desc" }, skip: (notifPage - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { store: { select: { id: true, name: true } } } }),
  ]);
  const jc = (s: JobStatus) => jobCounts.find((c) => c.status === s)?._count._all ?? 0;
  const nc = (s: NotificationStatus) => notifCounts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="Tâches et notifications"
        description="Outbox transactionnelle : les événements métier sont traités par le worker (cron /api/jobs/run ou pnpm jobs)."
        actions={<RunJobsButton />}
      />

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {JOB_STATUSES.map((s) => (
          <Link key={s} href={`/admin/taches?status=${s}&notif=${notifStatus}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 hover:bg-surface-2" aria-current={jobStatus === s ? "page" : undefined}>
            <StatusBadge map={JOB_STATUS} value={s} />
            <span className="tabular font-medium">{jc(s)}</span>
          </Link>
        ))}
      </div>

      <section aria-labelledby="jobs" className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="jobs" className="font-display text-lg font-semibold">Tâches <span className="text-sm font-normal text-ink-muted">({jobTotal}{jobStatus ? "" : ", hors terminées"})</span></h2>
          <form method="get" className="flex items-center gap-2" aria-label="Filtrer les tâches">
            <input type="hidden" name="notif" value={notifStatus} />
            <Select fieldSize="sm" name="status" defaultValue={jobStatus} aria-label="Statut de tâche" className="">
              <option value="">Actives et en échec</option>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>{JOB_STATUS[s].label}</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrer</Button>
          </form>
        </div>
        {jobs.length === 0 ? (
          <EmptyState icon={ListChecks} title="Aucune tâche" description="La file est vide pour ce filtre." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>Boutique</TH>
                <TH>Statut</TH>
                <TH align="center">Tentatives</TH>
                <TH>Planifiée</TH>
                <TH>Erreur / payload</TH>
                <TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {jobs.map((j) => (
                <TR key={j.id}>
                  <TD><span className="font-mono text-xs">{j.type}</span><span className="block text-[11px] text-ink-faint">{j.id}</span></TD>
                  <TD>{j.store ? <Link href={`/admin/boutiques/${j.store.id}`} className="hover:text-primary">{j.store.name}</Link> : <span className="text-ink-faint">Plateforme</span>}</TD>
                  <TD><StatusBadge map={JOB_STATUS} value={j.status} /></TD>
                  <TD align="center"><span className="tabular">{j.attempts}/{j.maxAttempts}</span></TD>
                  <TD><span className="text-ink-muted">{formatDateTime(j.runAt)}</span></TD>
                  <TD>
                    {j.lastError && <p className="mb-1 max-w-[320px] break-words text-xs text-danger">{j.lastError}</p>}
                    <JsonDetails value={j.payload} summary="Payload" />
                  </TD>
                  <TD align="right">{j.status !== "RUNNING" && j.status !== "DONE" ? <RetryJobButton jobId={j.id} /> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} total={jobTotal} basePath="/admin/taches" params={{ status: jobStatus, notif: notifStatus, notifPage: String(notifPage) }} />
      </section>

      <section aria-labelledby="notifications" id="notifications">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="notifications-title" className="font-display text-lg font-semibold">Notifications <span className="text-sm font-normal text-ink-muted">({notifTotal}{notifStatus ? "" : ", en file ou en échec"})</span></h2>
          <form method="get" className="flex items-center gap-2" aria-label="Filtrer les notifications">
            <input type="hidden" name="status" value={jobStatus} />
            <Select fieldSize="sm" name="notif" defaultValue={notifStatus} aria-label="Statut de notification" className="">
              <option value="">En file et en échec</option>
              {NOTIF_STATUSES.map((s) => (
                <option key={s} value={s}>{NOTIF_STATUS[s].label} ({nc(s)})</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrer</Button>
          </form>
        </div>
        {notifs.length === 0 ? (
          <EmptyState icon={Bell} title="Aucune notification" description="Rien en attente d'envoi." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Modèle</TH>
                <TH>Canal</TH>
                <TH>Destinataire</TH>
                <TH>Boutique</TH>
                <TH>Statut</TH>
                <TH>Créée</TH>
                <TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {notifs.map((n) => (
                <TR key={n.id}>
                  <TD><span className="font-mono text-xs">{n.template}</span></TD>
                  <TD>{n.channel}</TD>
                  <TD><span className="break-all text-xs">{n.recipient}</span></TD>
                  <TD>{n.store ? <Link href={`/admin/boutiques/${n.store.id}`} className="hover:text-primary">{n.store.name}</Link> : "-"}</TD>
                  <TD><StatusBadge map={NOTIF_STATUS} value={n.status} />{n.error && <span className="block max-w-[260px] break-words text-[11px] text-danger">{n.error}</span>}<span className="block text-[11px] text-ink-faint">{n.attempts} tentative{n.attempts > 1 ? "s" : ""}</span></TD>
                  <TD><span className="text-ink-muted">{formatDateTime(n.createdAt)}</span></TD>
                  <TD align="right">{n.status !== "SENT" ? <RetryNotificationButton notificationId={n.id} /> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={notifPage} total={notifTotal} basePath="/admin/taches" params={{ status: jobStatus, notif: notifStatus, page: String(page) }} pageKey="notifPage" />
      </section>
    </>
  );
}
