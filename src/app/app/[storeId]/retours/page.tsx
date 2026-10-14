import type { Metadata } from "next";
import Link from "next/link";
import { Undo2, Settings } from "lucide-react";
import type { ReturnStatus } from "@prisma/client";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { RETURN_STATUS_LABELS, RETURN_STATUS_TONE } from "@/lib/returns/state";
import { parseReturnPolicy, RESOLUTION_LABELS, RETURN_REASONS, type ResolutionKind, type ReturnReason } from "@/lib/returns/policy";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, THead, TH, TBody, TR, TD, RowLink, rowLink } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { formatDate, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Retours" };

const TABS: { key: string; statuses: ReturnStatus[] | null; label: string }[] = [
  { key: "", statuses: ["REQUESTED"], label: "À examiner" },
  { key: "approuves", statuses: ["APPROVED"], label: "En attente de réception" },
  { key: "recus", statuses: ["RECEIVED"], label: "À résoudre" },
  { key: "resolus", statuses: ["RESOLVED"], label: "Résolus" },
  { key: "clos", statuses: ["REJECTED", "CANCELLED"], label: "Refusés ou annulés" },
  { key: "tous", statuses: null, label: "Tous" },
];

export default async function ReturnsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "orders.view");
  const store = ctx.store;
  const base = `/app/${store.id}/retours`;
  const hasFeature = PLANS[ctx.planId].features.returnsPortal;
  const policy = parseReturnPolicy(store.returnPolicy);

  const tab = TABS.find((t) => t.key === (sp.statut ?? "")) ?? TABS[0]!;
  const [returns, counts] = await Promise.all([
    db.returnRequest.findMany({
      where: { storeId: store.id, ...(tab.statuses ? { status: { in: tab.statuses } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, reference: true, status: true, resolution: true, reason: true, requestedBy: true, createdAt: true, refundAmount: true, storeCreditAmount: true,
        order: { select: { id: true, reference: true, customerName: true, currency: true } },
        items: { select: { quantity: true } },
      },
    }),
    db.returnRequest.groupBy({ by: ["status"], where: { storeId: store.id }, _count: { _all: true } }),
  ]);
  const countOf = (statuses: ReturnStatus[] | null) => counts.filter((c) => !statuses || statuses.includes(c.status)).reduce((s, c) => s + c._count._all, 0);
  const total = countOf(null);

  if (!hasFeature && total === 0) {
    return (
      <>
        <PageHeader title="Retours" description="Demandes de retour, réceptions, remboursements, avoirs et échanges." />
        <PlanGate
          storeId={store.id}
          feature="returnsPortal"
          description="Vos clients demandent un retour en ligne depuis leur lien de suivi ; vous approuvez, réceptionnez avec remise en stock et résolvez en remboursement, avoir ou échange."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Retours"
        description="Demandes de retour, réceptions, remboursements, avoirs et échanges."
        actions={
          ctx.can("store.settings") ? (
            <ButtonLink href={`/app/${store.id}/parametres/retours`} variant="outline" size="sm" className="h-11 sm:h-9">
              <Settings className="size-4" aria-hidden /> Politique de retours
            </ButtonLink>
          ) : undefined
        }
      />

      {!hasFeature && (
        <Alert tone="info" className="mb-5">
          Votre plan n'inclut plus les retours en libre-service : vous pouvez terminer le traitement des retours existants.{" "}
          <Link href={`/app/${store.id}/abonnement#plans`} className="font-semibold underline underline-offset-4">
            Voir les plans
          </Link>
        </Alert>
      )}
      {hasFeature && !policy.enabled && (
        <Alert tone="info" className="mb-5">
          Les demandes en ligne sont désactivées : vos clients ne voient pas le bouton « Retourner des articles ». Vous pouvez toujours créer un retour depuis une commande livrée.
        </Alert>
      )}

      <LinkTabs className="mb-5" param="statut" items={TABS.map((t) => ({ href: t.key ? `${base}?statut=${t.key}` : base, label: t.label, count: countOf(t.statuses) }))} />

      {returns.length === 0 ? (
        <EmptyState
          icon={Undo2}
          title={total === 0 ? "Aucun retour pour l'instant" : "Aucun retour dans cette liste"}
          description={total === 0 ? "Les demandes de vos clients et les retours enregistrés en boutique apparaîtront ici." : undefined}
        />
      ) : (
        <Table minWidth={760}>
          <THead>
            <tr>
              <TH>Retour</TH>
              <TH>Client</TH>
              <TH>Motif</TH>
              <TH>Résolution</TH>
              <TH>Statut</TH>
              <TH align="right">Créé</TH>
            </tr>
          </THead>
          <TBody>
            {returns.map((r) => {
              const units = r.items.reduce((s, i) => s + i.quantity, 0);
              const res = r.resolution as ResolutionKind;
              return (
                <TR key={r.id} className={rowLink}>
                  <TD>
                    <RowLink href={`${base}/${r.id}`} className="font-mono font-semibold text-ink">
                      {r.reference}
                    </RowLink>
                    <span className="block text-xs text-ink-muted">
                      {r.order.reference} · {units} article{units > 1 ? "s" : ""}
                    </span>
                  </TD>
                  <TD>
                    <span className="block max-w-[22ch] truncate text-ink">{r.order.customerName}</span>
                    <span className="block text-xs text-ink-muted">{r.requestedBy === "customer" ? "Demande en ligne" : "Créé par la boutique"}</span>
                  </TD>
                  <TD className="text-ink-muted">{RETURN_REASONS[r.reason as ReturnReason] ?? r.reason}</TD>
                  <TD className="text-ink-muted">
                    {res === "NONE" ? "-" : r.status === "RESOLVED" ? RESOLUTION_LABELS[res] : `${RESOLUTION_LABELS[res]} (souhaité)`}
                  </TD>
                  <TD>
                    <Badge tone={RETURN_STATUS_TONE[r.status]} dot>
                      {RETURN_STATUS_LABELS[r.status]}
                    </Badge>
                  </TD>
                  <TD align="right" className="text-xs text-ink-muted">
                    <time dateTime={r.createdAt.toISOString()} title={formatDate(r.createdAt)}>
                      {relativeTime(r.createdAt)}
                    </time>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
