import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, History, Boxes, Layers } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { PageHeader, Alert, EmptyState, Kpi } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { StockAdjustForm } from "./stock-form";
import { effectiveLowStockThreshold } from "@/lib/inventory/policy";
import { storeLowStockThreshold } from "@/lib/inventory/service";

export const metadata: Metadata = { title: "Stock" };

const REASON: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  ADJUSTMENT: { label: "Ajustement", tone: "info" },
  SALE: { label: "Vente", tone: "neutral" },
  CANCEL: { label: "Annulation", tone: "warning" },
  RETURN: { label: "Retour", tone: "success" },
  IMPORT: { label: "Import", tone: "neutral" },
};

export default async function StockPage({ params }: { params: Promise<{ storeId: string; productId: string }> }) {
  const { storeId, productId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const product = await db.product.findFirst({
    where: { id: productId, storeId: ctx.store.id },
    select: { id: true, name: true, trackStock: true, stock: true, inventoryPolicy: true, lowStockThreshold: true, variants: { orderBy: { position: "asc" }, select: { id: true, name: true, stock: true, inventoryPolicy: true } } },
  });
  if (!product) notFound();
  const movements = await db.inventoryMovement.findMany({
    where: { storeId: ctx.store.id, productId: product.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { variant: { select: { name: true } } },
  });
  const actorIds = [...new Set(movements.map((m) => m.actorId).filter((x): x is string => !!x))];
  const orderIds = [...new Set(movements.map((m) => m.orderId).filter((x): x is string => !!x))];
  const [actors, orders] = await Promise.all([
    actorIds.length ? db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds }, storeId: ctx.store.id }, select: { id: true, reference: true } }) : Promise.resolve([]),
  ]);
  const actorName = (id: string | null) => (id ? actors.find((a) => a.id === id)?.name ?? "Membre de l'équipe" : "Automatique");
  const hasFeature = planFeature(ctx.planId, "stockTracking");
  const base = `/app/${ctx.store.id}`;
  const totalStock = product.variants.length ? product.variants.reduce((s, v) => s + v.stock, 0) : product.stock;
  const inQty = movements.filter((m) => m.delta > 0).reduce((s, m) => s + m.delta, 0);
  const outQty = movements.filter((m) => m.delta < 0).reduce((s, m) => s - m.delta, 0);
  // Seuil « stock bas » : celui du produit, sinon le seuil par défaut de la boutique.
  const LOW_STOCK = effectiveLowStockThreshold(product.lowStockThreshold, await storeLowStockThreshold(ctx.store.id));
  const oversold = product.variants.length ? product.variants.some((v) => v.stock < 0) : product.stock < 0;
  const stockTone = totalStock <= 0 || oversold ? "danger" : totalStock <= LOW_STOCK ? "warning" : null;

  return (
    <div>
      <PageHeader
        back={{ href: `${base}/produits/${product.id}`, label: product.name }}
        title="Stock et mouvements"
        description="Historique des entrées et sorties. Les ventes, annulations et retours sont enregistrés automatiquement."
        actions={
          <ButtonLink href={`${base}/produits/${product.id}`} variant="outline">
            Modifier le produit
          </ButtonLink>
        }
      />

      {!hasFeature && <PlanGate storeId={ctx.store.id} feature="stockTracking" compact className="mb-6" />}
      {hasFeature && !product.trackStock && (
        <Alert tone="info" className="mb-6" title="Suivi désactivé sur ce produit">
          Activez « Suivre le stock » dans la fiche produit pour enregistrer des ajustements.{" "}
          <Link href={`${base}/produits/${product.id}`} className="font-semibold underline underline-offset-4">
            Ouvrir la fiche
          </Link>
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Stock actuel"
          icon={Boxes}
          value={<span className={stockTone === "danger" ? "text-danger" : stockTone === "warning" ? "text-warning" : undefined}>{totalStock.toLocaleString("fr-FR")}</span>}
          hint={oversold ? "Survente : à réapprovisionner" : stockTone === "danger" ? "En rupture" : stockTone === "warning" ? `Stock bas (seuil ${LOW_STOCK})` : product.variants.length ? `${product.variants.length} variante${product.variants.length > 1 ? "s" : ""}` : "Disponible"}
        />
        <Kpi label="Entrées" icon={ArrowDownLeft} value={`+${inQty.toLocaleString("fr-FR")}`} hint="Sur les mouvements affichés" />
        <Kpi label="Sorties" icon={ArrowUpRight} value={`-${outQty.toLocaleString("fr-FR")}`} hint="Ventes et ajustements" />
        <Kpi label="Mouvements" icon={History} value={movements.length} hint={movements.length >= 100 ? "100 plus récents" : "Depuis la création"} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <CardHeader title="Historique" description={movements.length ? `${movements.length} mouvement${movements.length > 1 ? "s" : ""}, du plus récent au plus ancien.` : undefined} className="pb-4" />
          {movements.length === 0 ? (
            <EmptyState compact icon={History} title="Aucun mouvement" description="Les ajustements, ventes et annulations apparaîtront ici." />
          ) : (
            <>
              {/* Mobile : frise */}
              <ol className="border-t border-line md:hidden" aria-label="Mouvements de stock">
                {movements.map((m) => {
                  const r = REASON[m.reason] ?? { label: m.reason, tone: "neutral" as const };
                  const order = orders.find((o) => o.id === m.orderId);
                  return (
                    <li key={m.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                      <span className={`tabular mt-0.5 w-12 shrink-0 text-right text-sm font-semibold ${m.delta < 0 ? "text-danger" : "text-primary"}`}>
                        {m.delta > 0 ? "+" : ""}
                        {m.delta}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={r.tone}>{r.label}</Badge>
                          {m.variant?.name && <span className="text-xs text-ink-muted">{m.variant.name}</span>}
                        </div>
                        <p className="mt-1 text-xs text-ink-muted">
                          {formatDateTime(m.createdAt)} ·{" "}
                          {order ? (
                            <Link href={`${base}/commandes/${order.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                              {order.reference}
                            </Link>
                          ) : (
                            actorName(m.actorId)
                          )}
                        </p>
                        {m.note && <p className="mt-0.5 text-sm text-ink">{m.note}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* Desktop : tableau dense */}
              <div className="hidden border-t border-line md:block">
                <Table bare minWidth={620}>
                  <THead>
                    <tr>
                      <TH>Date</TH>
                      <TH>Type</TH>
                      <TH>Variante</TH>
                      <TH align="right">Quantité</TH>
                      <TH>Origine</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {movements.map((m) => {
                      const r = REASON[m.reason] ?? { label: m.reason, tone: "neutral" as const };
                      const order = orders.find((o) => o.id === m.orderId);
                      return (
                        <TR key={m.id}>
                          <TD className="whitespace-nowrap text-ink-muted">
                            <time dateTime={m.createdAt.toISOString()} title={formatDateTime(m.createdAt)}>
                              {relativeTime(m.createdAt)}
                            </time>
                          </TD>
                          <TD>
                            <Badge tone={r.tone}>{r.label}</Badge>
                          </TD>
                          <TD className="text-ink-muted">{m.variant?.name ?? <span className="text-ink-faint">Produit</span>}</TD>
                          <TD align="right" className={`font-semibold ${m.delta < 0 ? "text-danger" : "text-primary"}`}>
                            {m.delta > 0 ? "+" : ""}
                            {m.delta}
                          </TD>
                          <TD className="max-w-[260px] text-ink-muted">
                            {order ? (
                              <Link href={`${base}/commandes/${order.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                                {order.reference}
                              </Link>
                            ) : (
                              actorName(m.actorId)
                            )}
                            {m.note && <span className="block truncate text-xs text-ink-faint">{m.note}</span>}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            </>
          )}
        </Card>

        <aside className="space-y-5 lg:sticky lg:top-20">
          {hasFeature && product.trackStock && (
            <Card>
              <CardHeader title="Ajustement rapide" description="Réception, casse, inventaire." />
              <CardBody>
                <StockAdjustForm storeId={ctx.store.id} productId={product.id} variants={product.variants} />
              </CardBody>
            </Card>
          )}
          {product.variants.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Stock par variante" className="pb-3" />
              <ul className="divide-y divide-line border-t border-line">
                {product.variants.map((v) => (
                  <li key={v.id} className="flex min-h-11 items-center justify-between gap-3 px-5 py-2 text-sm">
                    <span className="inline-flex min-w-0 items-center gap-2 text-ink">
                      <Layers className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                      <span className="truncate">{v.name}</span>
                    </span>
                    {v.stock < 0 ? (
                      <Badge tone="danger">Survente ({v.stock})</Badge>
                    ) : v.stock === 0 ? (
                      v.inventoryPolicy === "CONTINUE" ? <Badge tone="info">Précommande</Badge> : <Badge tone="danger">Rupture</Badge>
                    ) : v.stock <= LOW_STOCK ? (
                      <Badge tone="warning">{v.stock}</Badge>
                    ) : (
                      <span className="tabular font-medium text-ink">{v.stock}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
