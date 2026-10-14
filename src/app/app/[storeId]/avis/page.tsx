import type { Metadata } from "next";
import Link from "next/link";
import { Star, MessageSquareText } from "lucide-react";
import type { ReviewStatus } from "@prisma/client";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { getRatingSummary } from "@/lib/reviews/service";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, Bezel } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { PlanGate } from "@/components/app/plan-gate";
import { formatDate, cn } from "@/lib/utils";
import { ModerationButtons, ReplyForm } from "./review-controls";

export const metadata: Metadata = { title: "Avis clients" };

const TABS: { key: string; status: ReviewStatus; label: string }[] = [
  { key: "", status: "PENDING", label: "En attente" },
  { key: "approuves", status: "APPROVED", label: "Publiés" },
  { key: "refuses", status: "REJECTED", label: "Refusés" },
];

function Stars({ rating, size = "size-4" }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn(size, i <= Math.round(rating) ? "fill-sun text-sun" : "fill-none text-line-strong")} aria-hidden />
      ))}
    </span>
  );
}

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "customers.manage");
  const store = ctx.store;
  const base = `/app/${store.id}/avis`;

  if (!PLANS[ctx.planId].features.reviews) {
    return (
      <>
        <PageHeader title="Avis clients" description="Les avis rassurent vos futurs clients." />
        <PlanGate storeId={store.id} feature="reviews" description="Recueillez les avis de vos clients après livraison, modérez-les avant publication et répondez publiquement. Une note moyenne visible augmente la confiance dans votre boutique." />
      </>
    );
  }

  const tab = TABS.find((t) => t.key === (sp.statut ?? "")) ?? TABS[0]!;
  const [reviews, counts, summary] = await Promise.all([
    db.review.findMany({ where: { storeId: store.id, status: tab.status }, orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { id: true, name: true } } } }),
    db.review.groupBy({ by: ["status"], where: { storeId: store.id }, _count: { _all: true } }),
    getRatingSummary(store.id),
  ]);
  const countOf = (s: ReviewStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const orderIds = reviews.map((r) => r.orderId).filter((x): x is string => !!x);
  const orders = orderIds.length ? await db.order.findMany({ where: { storeId: store.id, id: { in: orderIds } }, select: { id: true, reference: true } }) : [];
  const refOf = new Map(orders.map((o) => [o.id, o.reference]));

  return (
    <>
      <PageHeader title="Avis clients" description="Modérez les avis avant publication et répondez au nom de la boutique." />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <Bezel coreClassName="flex flex-col items-center justify-center p-6 text-center">
          <p className="text-sm font-medium text-ink-muted">Note moyenne</p>
          <p className="mt-2 text-5xl font-semibold tracking-[-0.04em] text-ink tabular">{summary.average != null ? summary.average.toLocaleString("fr-FR") : "-"}</p>
          {summary.average != null && <Stars rating={summary.average} size="size-5" />}
          <p className="mt-2 text-xs text-ink-muted">
            {summary.count} avis publié{summary.count > 1 ? "s" : ""}
          </p>
        </Bezel>
        <Card className="p-5 sm:p-6">
          <p className="mb-3 text-sm font-semibold text-ink">Répartition des avis publiés</p>
          <ul className="space-y-2">
            {([5, 4, 3, 2, 1] as const).map((n) => {
              const c = summary.distribution[n];
              const pct = summary.count ? Math.round((c / summary.count) * 100) : 0;
              return (
                <li key={n} className="flex items-center gap-3 text-sm">
                  <span className="flex w-10 shrink-0 items-center gap-1 text-ink-muted tabular">
                    {n} <Star className="size-3.5 fill-sun text-sun" aria-hidden />
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <span className="block h-full rounded-full bg-sun" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-16 shrink-0 text-right text-ink-muted tabular">
                    {c} <span className="sr-only">avis à {n} étoile{n > 1 ? "s" : ""}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <LinkTabs
        className="mb-5"
        param="statut"
        items={TABS.map((t) => ({ href: t.key ? `${base}?statut=${t.key}` : base, label: t.label, count: countOf(t.status) }))}
      />

      {reviews.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title={total === 0 ? "Aucun avis pour l'instant" : tab.status === "PENDING" ? "Aucun avis en attente" : "Aucun avis dans cette liste"}
          description={
            total === 0
              ? "Les avis laissés par vos clients sur votre boutique arrivent ici. Vous choisissez ceux qui sont publiés."
              : tab.status === "PENDING"
                ? "Tous les avis ont été traités."
                : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.id}>
              <Card as="article" className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Stars rating={r.rating} />
                      <p className="font-semibold text-ink">{r.customerName}</p>
                      <span className="text-xs text-ink-faint">{formatDate(r.createdAt)}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      {r.product ? (
                        <Link href={`/app/${store.id}/produits/${r.product.id}`} className="hover:text-primary hover:underline">
                          {r.product.name}
                        </Link>
                      ) : (
                        <span>Avis sur la boutique</span>
                      )}
                      {r.orderId && refOf.get(r.orderId) && (
                        <Badge tone="success" className="px-2 py-0 text-[11px] leading-[18px]">
                          Achat vérifié {refOf.get(r.orderId)}
                        </Badge>
                      )}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">{r.body}</p>
                    {r.reply && (
                      <div className="mt-3 rounded-[var(--radius-md)] border-l-2 border-primary bg-surface-2/70 px-3.5 py-2.5">
                        <p className="text-xs font-semibold text-ink">Réponse de {store.name}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-muted">{r.reply}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <ModerationButtons storeId={store.id} id={r.id} status={r.status} />
                  <ReplyForm storeId={store.id} id={r.id} reply={r.reply} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
