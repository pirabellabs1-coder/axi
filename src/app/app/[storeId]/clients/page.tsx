import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Users, Download, MessageCircle, ChevronLeft, ChevronRight, Repeat, UserPlus, ShoppingBasket, SearchX, Lock } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatPhone, relativeTime, addDays, formatDate } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import { PLANS } from "@/config/plans";
import { PlanGate, requiredPlanFor } from "@/components/app/plan-gate";
import { PageHeader, EmptyState, Avatar, Money, Kpi } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TH, TBody, TR, TD, RowLink, rowLink, TableToolbar, TableFooter } from "@/components/ui/table";
import { CustomerFilters } from "./customer-filters";

export const metadata: Metadata = { title: "Clients" };

const PAGE_SIZE = 25;
type SegmentKey = "" | "fideles" | "inactifs" | "nouveaux";
const SEGMENTS: { key: SegmentKey; label: string }[] = [
  { key: "", label: "Tous" },
  { key: "fideles", label: "Fidèles" },
  { key: "inactifs", label: "Inactifs" },
  { key: "nouveaux", label: "Nouveaux" },
];
const SORTS: Record<string, Prisma.CustomerOrderByWithRelationInput> = {
  recent: { lastOrderAt: { sort: "desc", nulls: "last" } },
  nom: { name: "asc" },
  depenses: { totalSpent: "desc" },
  commandes: { ordersCount: "desc" },
};

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "customers.view");
  const sid = ctx.store.id;
  const base = `/app/${sid}`;
  const currency = ctx.store.currency;
  const crm = planFeature(ctx.planId, "crm");
  const segmentsOn = crm && planFeature(ctx.planId, "segments");
  const loyalty = crm && planFeature(ctx.planId, "loyalty");
  const q = (sp.q ?? "").trim().slice(0, 60);
  const segment: SegmentKey = segmentsOn ? (SEGMENTS.find((s) => s.key === (sp.segment ?? ""))?.key ?? "") : "";
  const sortKey = crm && sp.tri && SORTS[sp.tri] ? sp.tri : "recent";
  const page = Math.max(1, Number(sp.page) || 1);
  const now = new Date();
  const inactiveSince = addDays(now, -60);
  const newSince = addDays(now, -30);

  const segmentWhere: Record<SegmentKey, Prisma.CustomerWhereInput> = {
    "": {},
    fideles: { ordersCount: { gte: 3 } },
    inactifs: { OR: [{ lastOrderAt: { lt: inactiveSince } }, { lastOrderAt: null }] },
    nouveaux: { createdAt: { gte: newSince } },
  };
  const searchWhere: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }, { email: { contains: q, mode: "insensitive" } }] }
    : {};
  const where: Prisma.CustomerWhereInput = { storeId: sid, AND: [searchWhere, segmentWhere[segment]] };
  const scoped = (w: Prisma.CustomerWhereInput) => db.customer.count({ where: { storeId: sid, ...w } });

  const [customers, total, allCount, recurring, newCount, sums, segCounts] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: SORTS[sortKey],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, phone: true, email: true, ordersCount: true, totalSpent: true, lastOrderAt: true, tags: true, loyaltyPoints: true },
    }),
    db.customer.count({ where }),
    scoped({}),
    scoped({ ordersCount: { gte: 2 } }),
    scoped({ createdAt: { gte: newSince } }),
    db.customer.aggregate({ where: { storeId: sid }, _sum: { totalSpent: true, ordersCount: true } }),
    segmentsOn ? Promise.all([scoped(segmentWhere.fideles), scoped(segmentWhere.inactifs)]) : Promise.resolve(null),
  ]);
  const orders = sums._sum.ordersCount ?? 0;
  const avgBasket = orders > 0 ? Math.round((sums._sum.totalSpent ?? 0) / orders) : null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showExport = ctx.can("export");
  const canExport = showExport && planFeature(ctx.planId, "csvExport");

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || undefined, segment: segment || undefined, tri: sortKey === "recent" ? undefined : sortKey, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}/clients${s ? `?${s}` : ""}`;
  };
  const wa = (c: { phone: string; name: string }) => waLink(c.phone, `Bonjour ${c.name}, c'est ${ctx.store.name}.`);

  return (
    <div>
      <PageHeader
        title="Clients"
        description={crm ? "Chaque commande crée ou met à jour une fiche client, dédoublonnée par téléphone." : "Fichier clients simple : la liste de vos acheteurs, créée à chaque commande."}
        actions={
          showExport ? (
            canExport ? (
              <a href={`${base}/clients/export`} className={buttonClasses({ variant: "outline" })}>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            ) : (
              <Button variant="outline" disabled aria-describedby="export-plan-hint">
                <Lock className="size-4" aria-hidden /> Export CSV
                <Badge tone="sun">
                  <span id="export-plan-hint">Plan {PLANS[requiredPlanFor("csvExport")].name}</span>
                </Badge>
              </Button>
            )
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Clients" icon={Users} value={allCount.toLocaleString("fr-FR")} hint={allCount ? "Fiches enregistrées" : "Aucune fiche"} />
        <Kpi label="Récurrents" icon={Repeat} value={recurring.toLocaleString("fr-FR")} hint={allCount ? `${Math.round((recurring / allCount) * 100)} % ont commandé 2 fois ou plus` : "2 commandes ou plus"} />
        <Kpi label="Nouveaux sur 30 jours" icon={UserPlus} value={newCount.toLocaleString("fr-FR")} hint="Première fiche créée" />
        <Kpi label="Panier moyen" icon={ShoppingBasket} value={avgBasket != null ? <Money amount={avgBasket} currency={currency} /> : "Aucun achat"} hint="Total dépensé / commandes" />
      </div>

      {!crm && (
        <PlanGate
          storeId={sid}
          feature="crm"
          compact
          className="mb-5"
          description="Notes, tags, consentements, tri et historique détaillé de chaque client sont inclus dans le CRM. Votre liste actuelle reste consultable."
        />
      )}

      {allCount === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucun client pour l'instant"
          description="Dès votre première commande, une fiche client est créée automatiquement avec son numéro WhatsApp et son historique."
          action={
            <ButtonLink href={`${base}/produits`} variant="outline">
              Compléter mon catalogue
            </ButtonLink>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableToolbar className="gap-y-3">
            {segmentsOn && segCounts ? (
              <Segmented
                label="Segments de clients"
                size="sm"
                value={segment || "all"}
                options={SEGMENTS.map((s, i) => ({
                  value: s.key || "all",
                  label: s.label,
                  href: qs({ segment: s.key || undefined, page: undefined }),
                  count: [allCount, segCounts[0], segCounts[1], newCount][i],
                }))}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Segments de clients" size="sm" value="all" options={[{ value: "all", label: "Tous", href: qs({ page: undefined }), count: allCount }]} />
                {crm && (
                  <Link href={`${base}/abonnement#plans`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-xs text-ink-muted transition-colors hover:text-ink md:min-h-8">
                    <Lock className="size-3.5" aria-hidden /> Segments avec le plan {PLANS[requiredPlanFor("segments")].name}
                  </Link>
                )}
              </div>
            )}
            <CustomerFilters action={`${base}/clients`} q={q} segment={segment || undefined} sort={sortKey} showSort={crm} />
          </TableToolbar>

          {customers.length === 0 ? (
            <EmptyState
              compact
              icon={SearchX}
              title="Aucun client ne correspond"
              description="Modifiez la recherche ou choisissez un autre segment."
              action={
                <ButtonLink href={`${base}/clients`} variant="outline" size="sm">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            <>
              {/* Mobile : cartes */}
              <ul className="divide-y divide-line md:hidden" aria-label="Clients">
                {customers.map((c) => (
                  <li key={c.id} className="relative flex items-center gap-3 px-4 py-3">
                    <Avatar name={c.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <Link href={`${base}/clients/${c.id}`} className="block truncate text-[15px] font-medium text-ink after:absolute after:inset-0 after:content-['']">
                        {c.name}
                      </Link>
                      <p className="tabular truncate text-xs text-ink-muted">
                        {formatPhone(c.phone)} · {c.ordersCount} commande{c.ordersCount > 1 ? "s" : ""}
                      </p>
                      {crm && c.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.tags.slice(0, 2).map((t) => (
                            <Badge key={t} tone="neutral" className="px-2 text-[11px]">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <Money amount={c.totalSpent} currency={currency} className="block text-sm font-semibold text-ink" />
                      <span className="text-xs text-ink-faint">{c.lastOrderAt ? relativeTime(c.lastOrderAt) : "Jamais"}</span>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop : tableau dense */}
              <div className="hidden md:block">
                <Table bare minWidth={loyalty ? 860 : 780}>
                  <THead>
                    <tr>
                      <TH>Client</TH>
                      <TH align="right">Commandes</TH>
                      <TH align="right">Total dépensé</TH>
                      <TH>Dernière commande</TH>
                      {crm && <TH>Tags</TH>}
                      {loyalty && <TH align="right">Points</TH>}
                      <TH align="right" sticky>
                        <span className="sr-only">Actions</span>
                      </TH>
                    </tr>
                  </THead>
                  <TBody>
                    {customers.map((c) => (
                      <TR key={c.id} className={rowLink}>
                        <TD className="py-2">
                          <div className="flex items-center gap-3">
                            <Avatar name={c.name} size={32} />
                            <div className="min-w-0">
                              <RowLink href={`${base}/clients/${c.id}`} className="block max-w-[260px] truncate">
                                {c.name}
                              </RowLink>
                              <span className="tabular block text-xs text-ink-muted">{formatPhone(c.phone)}</span>
                            </div>
                          </div>
                        </TD>
                        <TD align="right">{c.ordersCount}</TD>
                        <TD align="right">
                          <Money amount={c.totalSpent} currency={currency} className="font-medium" />
                        </TD>
                        <TD className="whitespace-nowrap text-ink-muted">
                          {c.lastOrderAt ? (
                            <time dateTime={c.lastOrderAt.toISOString()} title={formatDate(c.lastOrderAt)}>
                              {relativeTime(c.lastOrderAt)}
                            </time>
                          ) : (
                            <span className="text-ink-faint">Jamais</span>
                          )}
                        </TD>
                        {crm && (
                          <TD>
                            {c.tags.length > 0 ? (
                              <span className="flex max-w-[220px] flex-wrap gap-1">
                                {c.tags.slice(0, 3).map((t) => (
                                  <Badge key={t} tone="neutral" className="px-2 text-[11px]">
                                    {t}
                                  </Badge>
                                ))}
                                {c.tags.length > 3 && <span className="text-xs text-ink-faint">+{c.tags.length - 3}</span>}
                              </span>
                            ) : (
                              <span className="text-ink-faint">Aucun</span>
                            )}
                          </TD>
                        )}
                        {loyalty && <TD align="right">{c.loyaltyPoints.toLocaleString("fr-FR")}</TD>}
                        <TD align="right" sticky className="w-14 py-1">
                          <a
                            href={wa(c)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="relative z-[1] inline-flex size-9 items-center justify-center rounded-full text-whatsapp-deep transition-colors hover:bg-primary-soft"
                            aria-label={`Écrire à ${c.name} sur WhatsApp`}
                          >
                            <MessageCircle className="size-4" aria-hidden />
                          </a>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </>
          )}

          {total > 0 && (
            <TableFooter>
              <span className="tabular">
                {pages > 1 ? `${(page - 1) * PAGE_SIZE + 1} à ${Math.min(page * PAGE_SIZE, total)} sur ${total}` : `${total} client${total > 1 ? "s" : ""}`}
              </span>
              {pages > 1 && (
                <nav className="flex items-center gap-2" aria-label="Pagination">
                  {page > 1 ? (
                    <ButtonLink href={qs({ page: String(page - 1) })} variant="outline" size="sm" aria-label="Page précédente">
                      <ChevronLeft className="size-4" aria-hidden /> Précédent
                    </ButtonLink>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <ChevronLeft className="size-4" aria-hidden /> Précédent
                    </Button>
                  )}
                  <span className="tabular px-1 text-xs">
                    {page} / {pages}
                  </span>
                  {page < pages ? (
                    <ButtonLink href={qs({ page: String(page + 1) })} variant="outline" size="sm" aria-label="Page suivante">
                      Suivant <ChevronRight className="size-4" aria-hidden />
                    </ButtonLink>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Suivant <ChevronRight className="size-4" aria-hidden />
                    </Button>
                  )}
                </nav>
              )}
            </TableFooter>
          )}
        </Card>
      )}
    </div>
  );
}
