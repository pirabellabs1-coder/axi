import type { Metadata } from "next";
import Link from "next/link";
import { Zap, ScrollText } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { TRIGGER_META } from "@/lib/automations/templates";
import { PRESETS } from "@/lib/automations/config";
import { activeAutomationLimit } from "@/lib/automations/limits";
import { LOG_CHANNEL, loadAutomation } from "@/lib/automations/engine";
import { PageHeader, EmptyState, Alert, StatusDot } from "@/components/ui/misc";
import { Card, Bezel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { AutomationBuilder, AutomationRow, PresetGallery, type AutomationDTO, type BuilderEnv } from "./automations-client";

export const metadata: Metadata = { title: "Automatisations" };

const DESCRIPTION = "Confirmations, relances et alertes qui partent toutes seules, au bon moment, sans doublon.";

type LogPayload = { automationId?: string; name?: string; label?: string | null; results?: { type: string; status: string; detail: string }[] };

function sevenDaysAgo() {
  return new Date(Date.now() - 7 * 86_400_000);
}

export default async function AutomationsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ statut?: string; journal?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];

  if (!plan.features.automations) {
    return (
      <>
        <PageHeader title="Automatisations" description={DESCRIPTION} />
        <PlanGate
          storeId={store.id}
          feature="automations"
          description={`Les automatisations sont incluses à partir du plan Business. Votre plan actuel (${plan.name}) ne les propose pas encore. Le changement est immédiat et vos données restent intactes.`}
          unlocks={["Confirmation de commande envoyée tout de suite", "Demande d'avis deux jours après la livraison", "Réactivation des clients inactifs avec un coupon", "Alerte de stock bas avant la rupture"]}
        />
      </>
    );
  }

  const since7 = sevenDaysAgo();
  const statusFilter = sp.statut === "SENT" || sp.statut === "SKIPPED" || sp.statut === "FAILED" ? sp.statut : null;
  const [rows, waIntegration, logs, stats, orders] = await Promise.all([
    db.automation.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "asc" } }),
    db.integration.findUnique({ where: { storeId_kind: { storeId: store.id, kind: "whatsapp_cloud" } }, select: { status: true } }),
    db.notification.findMany({
      where: { storeId: store.id, channel: LOG_CHANNEL, ...(statusFilter ? { status: statusFilter } : {}), ...(sp.journal ? { template: `automation:${sp.journal}` } : {}) },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.notification.groupBy({ by: ["template", "status"], where: { storeId: store.id, channel: LOG_CHANNEL, createdAt: { gte: since7 } }, _count: { _all: true } }),
    db.order.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, reference: true, customerName: true, total: true, currency: true, status: true } }),
  ]);

  const statByAutomation = new Map<string, { sent: number; skipped: number; failed: number }>();
  let sent7 = 0;
  let skipped7 = 0;
  let failed7 = 0;
  for (const s of stats) {
    const id = s.template.replace(/^automation:/, "");
    const cur = statByAutomation.get(id) ?? { sent: 0, skipped: 0, failed: 0 };
    const n = s._count._all;
    if (s.status === "SENT") {
      cur.sent += n;
      sent7 += n;
    } else if (s.status === "SKIPPED") {
      cur.skipped += n;
      skipped7 += n;
    } else if (s.status === "FAILED") {
      cur.failed += n;
      failed7 += n;
    }
    statByAutomation.set(id, cur);
  }

  const dtos: AutomationDTO[] = rows.flatMap((r) => {
    const a = loadAutomation(r);
    if (!a) return [];
    return [{ id: a.id, trigger: a.trigger, delayMinutes: a.delayMinutes, active: a.active, config: a.config, stats: statByAutomation.get(a.id) ?? { sent: 0, skipped: 0, failed: 0 } }];
  });
  const names = new Map(dtos.map((d) => [d.id, d.config.name]));
  const waActive = waIntegration?.status === "active";
  const limit = activeAutomationLimit(ctx.planId);
  const activeCount = dtos.filter((a) => a.active).length;
  const canActivate = limit == null || activeCount < limit;
  const overBy = limit != null ? activeCount - limit : 0;

  const env: BuilderEnv = {
    storeId: store.id,
    storeName: store.name,
    currency: store.currency,
    canActivate,
    abandonedCart: plan.features.abandonedCart,
    waActive,
    sampleTotal: formatMoney(store.currency === "XOF" || store.currency === "XAF" ? 12500 : 2490, store.currency),
    orders: orders.map((o) => ({ id: o.id, label: `${o.reference} · ${o.customerName} · ${formatMoney(o.total, o.currency)}` })),
  };
  const existingNames = dtos.map((d) => d.config.name);
  const journalName = sp.journal ? names.get(sp.journal) : null;
  const qs = (statut: string | null) => {
    const p = new URLSearchParams();
    if (statut) p.set("statut", statut);
    if (sp.journal) p.set("journal", sp.journal);
    const s = p.toString();
    return `/app/${store.id}/automatisations${s ? `?${s}` : ""}#journal`;
  };

  return (
    <>
      <PageHeader title="Automatisations" description={DESCRIPTION} actions={<AutomationBuilder env={env} />} />

      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Bezel coreClassName="p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-ink-muted">Actives</p>
            <Badge tone="neutral">Plan {plan.name}</Badge>
          </div>
          <p className="mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink tabular">
            {activeCount}
            <span className="text-ink-muted">{limit == null ? "" : ` / ${limit}`}</span>
            <span className="ml-2 text-sm font-medium tracking-normal text-ink-muted">{limit == null ? "illimitées" : `active${activeCount > 1 ? "s" : ""}`}</span>
          </p>
          <Progress className="mt-4" size="sm" value={activeCount} max={limit} label={<span className="sr-only">Automatisations actives</span>} />
        </Bezel>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-muted">Exécutions sur 7 jours</p>
          <p className="mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink tabular">{sent7}</p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            <span className="tabular">{skipped7} ignorée{skipped7 > 1 ? "s" : ""}</span>
            <span className={failed7 ? "font-medium text-danger tabular" : "tabular"}>
              {failed7} échec{failed7 > 1 ? "s" : ""}
            </span>
          </p>
        </Card>
        <Card className="flex flex-col justify-center gap-2.5 p-5">
          <StatusDot tone={waActive ? "success" : "warning"}>WhatsApp : {waActive ? "envoi automatique (API)" : "brouillons à envoyer"}</StatusDot>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {waActive
              ? "Chaque message débite 1 crédit, remboursé si l'envoi échoue."
              : "Sans API, chaque message attend dans la boîte de réception avec un bouton wa.me. Il n'est jamais présenté comme envoyé."}
            {!waActive && ctx.can("integrations.manage") && (
              <>
                {" "}
                <Link href={`/app/${store.id}/whatsapp`} className="font-medium text-primary underline-offset-4 hover:underline">
                  Connecter l'API
                </Link>
              </>
            )}
          </p>
        </Card>
      </div>

      {overBy > 0 && (
        <Alert tone="danger" className="mb-4" title="Plus d'automatisations actives que votre plan n'en permet">
          Votre plan {plan.name} permet {limit} automatisations actives : seules les {limit} plus anciennes s'exécutent. Désactivez-en {overBy} ou passez au plan Scale.
        </Alert>
      )}
      {!canActivate && limit != null && overBy <= 0 && (
        <PlanGate compact className="mb-6" storeId={store.id} plan="SCALE" title="Automatisations illimitées" limit={{ label: "automatisations actives", used: activeCount, max: limit }} description={`Désactivez-en une pour en activer une autre, ou passez au plan Scale.`} />
      )}

      <section aria-labelledby="presets-title" className="mb-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="presets-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">
              Modèles prêts en un clic
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">Activés immédiatement avec un message déjà rédigé. Vous pourrez l'ajuster ensuite.</p>
          </div>
        </div>
        <PresetGallery env={env} existingNames={existingNames} presets={PRESETS.map((p) => ({ key: p.key, name: p.name, pitch: p.pitch, trigger: p.trigger, configName: p.config.name, actions: p.config.actions.map((a) => a.type) }))} />
      </section>

      <section aria-labelledby="list-title" className="mb-10">
        <h2 id="list-title" className="mb-3 text-lg font-semibold tracking-[-0.02em] text-ink">
          Vos automatisations <span className="text-ink-muted tabular">({dtos.length})</span>
        </h2>
        {dtos.length === 0 ? (
          <EmptyState icon={Zap} title="Aucune automatisation" description="Activez un modèle ci-dessus, ou composez la vôtre : Quand, Si, Alors, Après." action={<AutomationBuilder env={env} />} />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {dtos.map((a) => (
                <AutomationRow key={a.id} automation={a} env={env} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="journal-title" id="journal" className="scroll-mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="journal-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">
              Journal d'exécution
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {journalName ? (
                <>
                  Filtré sur « {journalName} ».{" "}
                  <Link href={`/app/${store.id}/automatisations${statusFilter ? `?statut=${statusFilter}` : ""}#journal`} className="font-medium text-primary underline-offset-4 hover:underline">
                    Tout afficher
                  </Link>
                </>
              ) : (
                "Chaque exécution, chaque refus avec sa raison. 60 dernières lignes."
              )}
            </p>
          </div>
          <Segmented
            label="Filtrer le journal"
            size="sm"
            value={statusFilter ?? "ALL"}
            options={[
              { value: "ALL", label: "Tout", href: qs(null) },
              { value: "SENT", label: "Exécutées", href: qs("SENT") },
              { value: "SKIPPED", label: "Ignorées", href: qs("SKIPPED") },
              { value: "FAILED", label: "Échecs", href: qs("FAILED") },
            ]}
          />
        </div>
        {logs.length === 0 ? (
          <EmptyState icon={ScrollText} title="Rien dans le journal" description="Les exécutions apparaîtront ici dès qu'une automatisation active sera déclenchée." />
        ) : (
          <Table minWidth={760}>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Automatisation</TH>
                <TH>Concerne</TH>
                <TH>Résultat</TH>
                <TH>Détail</TH>
              </tr>
            </THead>
            <TBody>
              {logs.map((l) => {
                const p = (l.payload ?? {}) as LogPayload;
                const detail = l.status === "SENT" ? (p.results ?? []).filter((r) => r.status !== "skipped").map((r) => r.detail).join(" ; ") : (l.error ?? "");
                const trig = TRIGGER_META[(l.payload as { trigger?: keyof typeof TRIGGER_META } | null)?.trigger ?? "order.created"];
                return (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-ink-muted">
                      <time dateTime={l.createdAt.toISOString()} title={formatDateTime(l.createdAt)}>
                        {relativeTime(l.createdAt)}
                      </time>
                    </TD>
                    <TD>
                      <span className="font-medium text-ink">{p.name ?? names.get(p.automationId ?? "") ?? "Supprimée"}</span>
                      <span className="block text-xs text-ink-faint">{trig?.label}</span>
                    </TD>
                    <TD className="text-ink-muted">{p.label ?? "-"}</TD>
                    <TD>
                      {l.status === "SENT" ? <Badge tone="success" dot>Exécutée</Badge> : l.status === "SKIPPED" ? <Badge tone="neutral" dot>Ignorée</Badge> : <Badge tone="danger" dot>Échec</Badge>}
                    </TD>
                    <TD className="max-w-[420px] text-[13px] leading-snug text-ink-muted [overflow-wrap:anywhere]">{detail || "-"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}
