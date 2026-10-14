import type { Metadata } from "next";
import Link from "next/link";
import type { FulfillmentType, OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { Plus, Search, ShoppingBag, ChevronLeft, ChevronRight, SearchX, X } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime, formatPhone, relativeTime } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE, ACTIVE_STATUSES } from "@/lib/commerce/order-state";
import { PLANS } from "@/config/plans";
import { requiredPlanFor } from "@/components/app/plan-gate";
import { PageHeader, EmptyState, Money } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TH, TBody, TR, TD, RowLink, rowLink, TableToolbar, TableFooter } from "@/components/ui/table";
import { QuickConfirm } from "./quick-confirm";
import { ExportMenu } from "./export-menu";
import { FULFILLMENT_ICON } from "./fulfillment";

export const metadata: Metadata = { title: "Commandes" };

const PAGE_SIZE = 20;
const TABS: { key: string; label: string; statuses: OrderStatus[] | null }[] = [
  { key: "", label: "Toutes", statuses: null },
  { key: "a-traiter", label: "À traiter", statuses: ["NEW"] },
  { key: "en-cours", label: "En cours", statuses: ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] },
  { key: "terminees", label: "Terminées", statuses: ["DELIVERED", "REFUNDED"] },
  { key: "annulees", label: "Annulées", statuses: ["CANCELLED"] },
];
const PAYMENT_FILTERS: PaymentStatus[] = ["UNPAID", "PENDING", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"];
const MODE_FILTERS: FulfillmentType[] = ["PICKUP", "DELIVERY", "WHATSAPP"];
const MODE_SHORT: Record<FulfillmentType, string> = { PICKUP: "Retrait", DELIVERY: "Livraison", WHATSAPP: "WhatsApp", DIGITAL: "Numérique" };
const PERIODS: { key: string; label: string; days: number }[] = [
  { key: "aujourdhui", label: "Aujourd'hui", days: 0 },
  { key: "7j", label: "7 derniers jours", days: 7 },
  { key: "30j", label: "30 derniers jours", days: 30 },
  { key: "90j", label: "90 derniers jours", days: 90 },
];
const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];

function periodStart(key: string | undefined): Date | undefined {
  const p = PERIODS.find((x) => x.key === key);
  if (!p) return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p.days > 0) d.setDate(d.getDate() - p.days + 1);
  return d;
}

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "orders.view");
  const base = `/app/${ctx.store.id}`;

  // `status` (valeur exacte, ex. ?status=NEW) a priorité sur l'onglet `statut`.
  const exactStatus = ORDER_STATUSES.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : undefined;
  const tab = exactStatus
    ? (TABS.find((t) => t.statuses?.includes(exactStatus)) ?? TABS[0])
    : (TABS.find((t) => t.key === (sp.statut ?? "")) ?? TABS[0]);
  const statusFilter: OrderStatus[] | null = exactStatus ? [exactStatus] : tab.statuses;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const paiement = PAYMENT_FILTERS.includes(sp.paiement as PaymentStatus) ? (sp.paiement as PaymentStatus) : undefined;
  const mode = MODE_FILTERS.includes(sp.mode as FulfillmentType) ? (sp.mode as FulfillmentType) : undefined;
  const periode = PERIODS.some((p) => p.key === sp.periode) ? sp.periode : undefined;
  const since = periodStart(periode);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const hasFilters = Boolean(q || paiement || mode || periode);

  const where: Prisma.OrderWhereInput = {
    storeId: ctx.store.id,
    ...(statusFilter ? { status: { in: statusFilter } } : {}),
    ...(paiement ? { paymentStatus: paiement } : {}),
    ...(mode ? { fulfillmentType: mode } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q.toUpperCase() } },
            { customerName: { contains: q, mode: "insensitive" } },
            { customerPhone: { contains: q.replace(/\D/g, "") || q } },
          ],
        }
      : {}),
  };

  const [orders, total, counts] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        createdAt: true,
        customerName: true,
        customerPhone: true,
        fulfillmentType: true,
        total: true,
        currency: true,
        paymentStatus: true,
        status: true,
        outOfQuota: true,
      },
    }),
    db.order.count({ where }),
    db.order.groupBy({ by: ["status"], where: { storeId: ctx.store.id }, _count: { _all: true } }),
  ]);

  // Nombre d'articles (somme des quantités) : les ids proviennent d'une requête déjà filtrée par storeId.
  const quantities = orders.length
    ? await db.orderItem.groupBy({ by: ["orderId"], where: { orderId: { in: orders.map((o) => o.id) } }, _sum: { quantity: true } })
    : [];
  const qtyOf = new Map(quantities.map((r) => [r.orderId, r._sum.quantity ?? 0]));

  const countFor = (statuses: OrderStatus[] | null) => counts.filter((c) => !statuses || statuses.includes(c.status)).reduce((s, c) => s + c._count._all, 0);
  const grandTotal = countFor(null);
  const activeCount = countFor(ACTIVE_STATUSES);
  const toProcess = countFor(["NEW"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canManage = ctx.can("orders.manage");
  const canExportRole = ctx.can("export");
  const exportAllowed = planFeature(ctx.planId, "csvExport");

  const current: Record<string, string | undefined> = { statut: exactStatus ? undefined : tab.key, status: exactStatus, q, paiement, mode, periode };
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}/commandes${s ? `?${s}` : ""}`;
  };
  const exportQs = new URLSearchParams();
  if (tab.key) exportQs.set("statut", tab.key);
  if (q) exportQs.set("q", q);
  if (paiement) exportQs.set("paiement", paiement);

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <PageHeader
        title="Commandes"
        description={
          grandTotal === 0 ? (
            "Toutes les commandes de votre boutique, du panier à la remise."
          ) : (
            <span className="tabular">
              {grandTotal.toLocaleString("fr-FR")} commande{grandTotal > 1 ? "s" : ""} au total, {activeCount.toLocaleString("fr-FR")} en cours
              {toProcess > 0 && <>, dont {toProcess.toLocaleString("fr-FR")} à traiter</>}
            </span>
          )
        }
        actions={
          <>
            {canExportRole && (
              <ExportMenu
                exportHref={exportAllowed ? `${base}/commandes/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}` : null}
                planName={PLANS[requiredPlanFor("csvExport")].name}
                upgradeHref={`${base}/abonnement#plans`}
              />
            )}
            {canManage && (
              <ButtonLink href={`${base}/commandes/nouvelle`} variant="primary" size="sm" className="h-11 sm:h-9">
                <Plus className="size-4" aria-hidden /> Nouvelle commande
              </ButtonLink>
            )}
          </>
        }
      />

      {grandTotal === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Aucune commande pour l'instant"
          description="Partagez le lien de votre boutique pour recevoir vos premières commandes, ou saisissez une commande reçue par téléphone ou sur WhatsApp."
          action={
            canManage ? (
              <ButtonLink href={`${base}/commandes/nouvelle`}>
                <Plus className="size-4" aria-hidden /> Saisir une commande
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableToolbar className="gap-3 py-3">
            <Segmented
              label="Filtrer par statut"
              size="sm"
              value={tab.key}
              options={TABS.map((t) => ({ value: t.key, label: t.label, count: countFor(t.statuses), href: qs({ statut: t.key || undefined, status: undefined, page: undefined }) }))}
              className="shrink-0"
            />
            <form method="get" action={`${base}/commandes`} role="search" aria-label="Rechercher et filtrer les commandes" className="flex min-w-0 flex-1 flex-wrap items-center gap-2 min-[1600px]:flex-nowrap">
              {tab.key && !exactStatus && <input type="hidden" name="statut" value={tab.key} />}
              {exactStatus && <input type="hidden" name="status" value={exactStatus} />}
              <div className="relative min-w-[200px] flex-1">
                <label htmlFor="orders-q" className="sr-only">
                  Rechercher par référence, client ou téléphone
                </label>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                <Input id="orders-q" name="q" type="search" defaultValue={q} placeholder="Référence, client ou téléphone" className="h-11 pl-9 text-sm sm:h-9" />
              </div>
              <FilterSelect id="orders-paiement" name="paiement" label="Paiement" value={paiement} all="Tous paiements" options={PAYMENT_FILTERS.map((p) => [p, PAYMENT_STATUS_LABELS[p]])} />
              <FilterSelect id="orders-mode" name="mode" label="Mode" value={mode} all="Tous modes" options={MODE_FILTERS.map((m) => [m, MODE_SHORT[m]])} />
              <FilterSelect id="orders-periode" name="periode" label="Période" value={periode} all="Toute période" options={PERIODS.map((p) => [p.key, p.label])} />
              <Button type="submit" variant="secondary" size="sm" className="h-11 sm:h-9">
                Appliquer
              </Button>
              {hasFilters && (
                <ButtonLink href={qs({ q: undefined, paiement: undefined, mode: undefined, periode: undefined, page: undefined })} variant="ghost" size="sm" className="h-11 text-ink-muted sm:h-9">
                  <X className="size-4" aria-hidden /> Effacer
                </ButtonLink>
              )}
            </form>
          </TableToolbar>

          {orders.length === 0 ? (
            <EmptyState
              compact
              icon={SearchX}
              title={hasFilters ? "Aucune commande ne correspond" : exactStatus ? `Aucune commande « ${ORDER_STATUS_LABELS[exactStatus].toLowerCase()} »` : `Aucune commande « ${tab.label.toLowerCase()} »`}
              description={hasFilters ? "Essayez une autre recherche ou élargissez la période." : "Les commandes apparaîtront ici dès qu'elles changeront de statut."}
              action={
                hasFilters ? (
                  <ButtonLink href={qs({ q: undefined, paiement: undefined, mode: undefined, periode: undefined, page: undefined })} variant="outline" size="sm">
                    Effacer les filtres
                  </ButtonLink>
                ) : tab.key || exactStatus ? (
                  <ButtonLink href={`${base}/commandes`} variant="outline" size="sm">
                    Voir toutes les commandes
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Mobile : cartes */}
              <ul className="divide-y divide-line md:hidden" aria-label="Commandes">
                {orders.map((o) => {
                  const Icon = FULFILLMENT_ICON[o.fulfillmentType];
                  const qty = qtyOf.get(o.id) ?? 0;
                  return (
                    <li key={o.id} className="relative px-4 py-3.5 transition-colors active:bg-surface-2/60">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`${base}/commandes/${o.id}`}
                              className="font-mono text-[13px] font-semibold text-ink outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
                            >
                              {o.reference}
                            </Link>
                            {o.outOfQuota && <Badge tone="danger">Hors quota</Badge>}
                          </p>
                          <p className="mt-0.5 truncate text-sm font-medium text-ink">{o.customerName}</p>
                          <p className="text-xs text-ink-muted">
                            {formatPhone(o.customerPhone)} <span aria-hidden>·</span>{" "}
                            <time dateTime={o.createdAt.toISOString()} title={formatDateTime(o.createdAt)}>
                              {relativeTime(o.createdAt)}
                            </time>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <Money amount={o.total} currency={o.currency} className="font-mono text-sm font-semibold text-ink" />
                          <p className="text-xs text-ink-muted tabular">
                            {qty} article{qty > 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={ORDER_STATUS_TONE[o.status]} dot>
                          {ORDER_STATUS_LABELS[o.status]}
                        </Badge>
                        <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge>
                        <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                          <Icon className="size-3.5" aria-hidden /> {MODE_SHORT[o.fulfillmentType]}
                        </span>
                      </div>
                      {canManage && o.status === "NEW" && (
                        <div className="relative z-[1] mt-3">
                          <QuickConfirm storeId={ctx.store.id} orderId={o.id} className="h-11 w-full" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Desktop : tableau dense */}
              <div className="hidden md:block">
                <Table bare minWidth={760}>
                  <caption className="sr-only">Liste des commandes, de la plus récente à la plus ancienne</caption>
                  <THead>
                    <tr>
                      <TH>Référence</TH>
                      <TH>Client</TH>
                      <TH>Date</TH>
                      <TH align="right" className="hidden 2xl:table-cell">Articles</TH>
                      <TH className="hidden xl:table-cell">Mode</TH>
                      <TH>Statut</TH>
                      <TH>Paiement</TH>
                      <TH align="right">Total</TH>
                      {canManage && (
                        <TH align="right" sticky>
                          <span className="sr-only">Actions rapides</span>
                        </TH>
                      )}
                    </tr>
                  </THead>
                  <TBody>
                    {orders.map((o) => {
                      const Icon = FULFILLMENT_ICON[o.fulfillmentType];
                      return (
                        <TR key={o.id} className={rowLink}>
                          <TD className="whitespace-nowrap">
                            <RowLink href={`${base}/commandes/${o.id}`} className="font-mono text-[13px] font-semibold">
                              {o.reference}
                            </RowLink>
                            {o.outOfQuota && (
                              <Badge tone="danger" className="ml-2">
                                Hors quota
                              </Badge>
                            )}
                          </TD>
                          <TD>
                            <span className="block max-w-[220px] truncate font-medium">{o.customerName}</span>
                            <span className="block text-xs text-ink-muted tabular">{formatPhone(o.customerPhone)}</span>
                          </TD>
                          <TD className="whitespace-nowrap text-ink-muted">
                            <time dateTime={o.createdAt.toISOString()} title={formatDateTime(o.createdAt)}>
                              {relativeTime(o.createdAt)}
                            </time>
                          </TD>
                          <TD align="right" className="hidden text-ink-muted 2xl:table-cell">
                            {qtyOf.get(o.id) ?? 0}
                          </TD>
                          <TD className="hidden whitespace-nowrap xl:table-cell">
                            <span className="inline-flex items-center gap-1.5 text-ink-muted">
                              <Icon className="size-4 text-ink-faint" aria-hidden /> {MODE_SHORT[o.fulfillmentType]}
                            </span>
                          </TD>
                          <TD className="whitespace-nowrap">
                            <Badge tone={ORDER_STATUS_TONE[o.status]} dot>
                              {ORDER_STATUS_LABELS[o.status]}
                            </Badge>
                          </TD>
                          <TD className="whitespace-nowrap">
                            <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge>
                          </TD>
                          <TD align="right" className="whitespace-nowrap font-mono text-[13px] font-semibold">
                            <Money amount={o.total} currency={o.currency} />
                          </TD>
                          {canManage && (
                            <TD align="right" sticky className="w-px whitespace-nowrap">
                              {o.status === "NEW" ? <QuickConfirm storeId={ctx.store.id} orderId={o.id} /> : null}
                            </TD>
                          )}
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>

              <TableFooter>
                <span className="tabular">
                  {from.toLocaleString("fr-FR")} à {to.toLocaleString("fr-FR")} sur {total.toLocaleString("fr-FR")} commande{total > 1 ? "s" : ""}
                </span>
                {pages > 1 && (
                  <nav className="flex items-center gap-2" aria-label="Pagination">
                    <span className="mr-1 hidden text-xs sm:inline tabular">
                      Page {page} sur {pages}
                    </span>
                    {page > 1 ? (
                      <ButtonLink href={qs({ page: String(page - 1) })} variant="outline" size="sm" className="h-11 sm:h-9" rel="prev">
                        <ChevronLeft className="size-4" aria-hidden /> Précédent
                      </ButtonLink>
                    ) : (
                      <Button variant="outline" size="sm" className="h-11 sm:h-9" disabled>
                        <ChevronLeft className="size-4" aria-hidden /> Précédent
                      </Button>
                    )}
                    {page < pages ? (
                      <ButtonLink href={qs({ page: String(page + 1) })} variant="outline" size="sm" className="h-11 sm:h-9" rel="next">
                        Suivant <ChevronRight className="size-4" aria-hidden />
                      </ButtonLink>
                    ) : (
                      <Button variant="outline" size="sm" className="h-11 sm:h-9" disabled>
                        Suivant <ChevronRight className="size-4" aria-hidden />
                      </Button>
                    )}
                  </nav>
                )}
              </TableFooter>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function FilterSelect({ id, name, label, value, all, options }: { id: string; name: string; label: string; value?: string; all: string; options: [string, string][] }) {
  return (
    <div className="w-[calc(50%-4px)] sm:w-auto sm:min-w-[150px]">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} name={name} defaultValue={value ?? ""} className="h-11 pl-3 text-sm sm:h-9">
        <option value="">{all}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );
}
