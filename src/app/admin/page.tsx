import Link from "next/link";
import { Store, ShoppingBag, Receipt, TrendingUp, AlertTriangle, ListChecks, BellOff, ArrowRight, LifeBuoy, Puzzle, Users, Repeat, Flag, ShieldX, UserPlus, TrendingDown, CheckCircle2 } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { PLANS, PLAN_ORDER, TRIAL_DAYS, getAddOn } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils";
import { mrrBreakdown, addOnMrrEur, sumByCurrency, conversionRate, monthStarts, weekStarts, dayStarts, bucketCounts, mrrSeriesFromInvoices, payingStoresAt, churn, arpa, funnel, type PaidPlanInvoice } from "@/lib/admin/metrics";
import { Kpi, PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { STORE_STATUS, SUB_STATUS, INVOICE_STATUS, StatusBadge, BarList, SectionTitle } from "@/components/app/admin-bits";
import { AreaChart, BarChart, type ChartPoint } from "@/components/admin/charts";
import { ActivationFunnel } from "@/components/admin/funnel";

const DAY = 86_400_000;
const monthShort = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function AdminHome() {
  await getAdminContext();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const months = monthStarts(12, now);
  const weeks = weekStarts(12, now);
  const days = dayStarts(30, now);
  const monthStart = months[months.length - 1];
  const trialCutoff = new Date(now.getTime() - TRIAL_DAYS * DAY);

  const [subs, storesTotal, storesSuspended, matureStores, signups30, overdueInvoices, openInvoices, jobsDead, notifsFailed, openTickets, openReports, badWebhooks, activeAddOns, pendingAddOns, addOnInvoiceRows, paidInvoices, signupDates, publishedDates, orderDays, funnelCounts, topStores, recentStores, recentInvoices, recentAudit] = await Promise.all([
    db.subscription.findMany({ select: { planId: true, interval: true, zone: true, status: true, storeId: true, trialEndsAt: true } }),
    db.store.count({ where: { status: { not: "ARCHIVED" } } }),
    db.store.count({ where: { status: "SUSPENDED" } }),
    db.store.findMany({ where: { status: { not: "ARCHIVED" }, createdAt: { lte: trialCutoff } }, select: { id: true } }),
    db.user.count({ where: { createdAt: { gte: since30 }, isPlatformAdmin: false } }),
    db.invoice.count({ where: { status: "OPEN", dueAt: { lt: now } } }),
    db.invoice.count({ where: { status: "OPEN" } }),
    db.job.count({ where: { status: { in: ["FAILED", "DEAD"] } } }),
    db.notification.count({ where: { status: "FAILED" } }),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
    db.storeReport.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
    db.providerEvent.count({ where: { signatureValid: false, receivedAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.addOnPurchase.findMany({ where: { status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { addOnId: true, quantity: true } }),
    db.addOnPurchase.count({ where: { status: "PENDING" } }),
    db.addOnPurchase.findMany({ where: { invoiceId: { not: null } }, select: { invoiceId: true } }),
    db.invoice.findMany({ where: { status: "PAID", periodEnd: { gt: months[0] } }, select: { id: true, amount: true, currency: true, periodStart: true, periodEnd: true, paidAt: true, subscription: { select: { storeId: true } } } }),
    db.user.findMany({ where: { createdAt: { gte: weeks[0] }, isPlatformAdmin: false }, select: { createdAt: true } }),
    db.store.findMany({ where: { publishedAt: { gte: weeks[0] } }, select: { publishedAt: true } }),
    db.$queryRaw<{ d: Date; n: bigint }[]>`SELECT date_trunc('day', "createdAt") AS d, count(*)::bigint AS n FROM "Order" WHERE "createdAt" >= ${days[0]} GROUP BY 1`,
    Promise.all([
      db.user.count({ where: { isPlatformAdmin: false } }),
      db.user.count({ where: { isPlatformAdmin: false, memberships: { some: { role: "OWNER" } } } }),
      db.user.count({ where: { isPlatformAdmin: false, memberships: { some: { role: "OWNER", store: { publishedAt: { not: null } } } } } }),
      db.user.count({ where: { isPlatformAdmin: false, memberships: { some: { role: "OWNER", store: { orders: { some: {} } } } } } }),
    ]),
    db.order.groupBy({ by: ["storeId"], where: { createdAt: { gte: since30 }, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { total: true }, orderBy: { _count: { storeId: "desc" } }, take: 6 }),
    db.store.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, slug: true, city: true, status: true, createdAt: true, subscription: { select: { planId: true, status: true } } } }),
    db.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { subscription: { select: { storeId: true, store: { select: { name: true } } } } } }),
    db.auditLog.findMany({ where: { action: { startsWith: "admin." } }, orderBy: { createdAt: "desc" }, take: 6, include: { actor: { select: { name: true } }, store: { select: { name: true } } } }),
  ]);

  // Factures d'abonnement payées (hors options) : base du MRR facturé, du churn et des revenus.
  const addOnIds = new Set(addOnInvoiceRows.map((r) => r.invoiceId!).filter(Boolean));
  const planInvoices: PaidPlanInvoice[] = paidInvoices.filter((i) => !addOnIds.has(i.id)).map((i) => ({ storeId: i.subscription.storeId, amount: i.amount, currency: i.currency, periodStart: i.periodStart, periodEnd: i.periodEnd }));
  const addOnRevenue = sumByCurrency(paidInvoices.filter((i) => addOnIds.has(i.id) && i.paidAt && i.paidAt >= since30));

  const series = mrrSeriesFromInvoices(planInvoices, months, now);
  const toPoints = (values: number[] | undefined): ChartPoint[] => months.map((m, i) => ({ label: monthShort.format(m).replace(".", ""), full: monthLong.format(m), value: values?.[i] ?? 0 }));
  const mrrEurPoints = toPoints(series.EUR);
  const mrrXofPoints = toPoints(series.XOF);
  const lastEur = mrrEurPoints.at(-1)?.value ?? 0;
  const lastXof = mrrXofPoints.at(-1)?.value ?? 0;

  const signupPoints = bucketCounts(signupDates.map((u) => u.createdAt), weeks).map((value, i) => ({ label: dayMonth.format(weeks[i]).replace(".", ""), full: `Semaine du ${dayMonth.format(weeks[i])}`, value }));
  const publishedPoints = bucketCounts(publishedDates.map((s) => s.publishedAt), weeks).map((value, i) => ({ label: dayMonth.format(weeks[i]).replace(".", ""), full: `Semaine du ${dayMonth.format(weeks[i])}`, value }));
  const orderMap = new Map(orderDays.map((r) => [new Date(r.d).toISOString().slice(0, 10), Number(r.n)]));
  const orderPoints = days.map((d) => ({ label: String(d.getUTCDate()), full: dayLong.format(d), value: orderMap.get(d.toISOString().slice(0, 10)) ?? 0 }));
  const orders30 = orderPoints.reduce((a, p) => a + p.value, 0);

  const mrr = mrrBreakdown(subs);
  const addOnMrr = addOnMrrEur(activeAddOns);
  const payingStoreIds = new Set(subs.filter((s) => s.status === "ACTIVE" && s.planId !== "FREE").map((s) => s.storeId));
  const converted = matureStores.filter((s) => payingStoreIds.has(s.id)).length;
  const conversion = conversionRate(converted, matureStores.length);
  const trials = subs.filter((s) => s.status === "TRIALING");
  const trialsEndingSoon = trials.filter((s) => s.trialEndsAt && s.trialEndsAt.getTime() - now.getTime() < 4 * DAY).length;
  const monthChurn = churn(payingStoresAt(planInvoices, monthStart), payingStoresAt(planInvoices, now));
  const arpaEur = arpa(mrr.consolidatedEur, mrr.paying);

  const funnelSteps = funnel([
    { key: "signup", label: "Comptes inscrits", count: funnelCounts[0] },
    { key: "store", label: "Boutique créée", count: funnelCounts[1] },
    { key: "published", label: "Boutique publiée", count: funnelCounts[2] },
    { key: "order", label: "Première commande reçue", count: funnelCounts[3] },
  ]);

  const topStoreRows = topStores.length ? await db.store.findMany({ where: { id: { in: topStores.map((t) => t.storeId) } }, select: { id: true, name: true, currency: true, city: true } }) : [];
  const topBars = topStores.map((t) => {
    const s = topStoreRows.find((x) => x.id === t.storeId);
    return { key: t.storeId, label: s?.name ?? "Boutique", value: t._count._all, display: `${t._count._all} cmd`, hint: s ? `${formatMoney(t._sum.total ?? 0, s.currency)} de ventes${s.city ? `, ${s.city}` : ""}` : undefined, href: `/admin/boutiques/${t.storeId}` };
  });

  const alerts = [
    overdueInvoices > 0 && { href: "/admin/abonnements?status=OPEN", label: `${overdueInvoices} facture${overdueInvoices > 1 ? "s" : ""} en retard de paiement`, icon: Receipt, tone: "danger" as const },
    openReports > 0 && { href: "/admin/signalements", label: `${openReports} signalement${openReports > 1 ? "s" : ""} à examiner`, icon: Flag, tone: "danger" as const },
    jobsDead > 0 && { href: "/admin/taches", label: `${jobsDead} tâche${jobsDead > 1 ? "s" : ""} en échec`, icon: ListChecks, tone: "warning" as const },
    badWebhooks > 0 && { href: "/admin/paiements", label: `${badWebhooks} webhook${badWebhooks > 1 ? "s" : ""} à signature invalide (7 j)`, icon: ShieldX, tone: "warning" as const },
    notifsFailed > 0 && { href: "/admin/taches#notifications", label: `${notifsFailed} notification${notifsFailed > 1 ? "s" : ""} non envoyée${notifsFailed > 1 ? "s" : ""}`, icon: BellOff, tone: "warning" as const },
    openTickets > 0 && { href: "/admin/tickets", label: `${openTickets} ticket${openTickets > 1 ? "s" : ""} à traiter`, icon: LifeBuoy, tone: "neutral" as const },
    pendingAddOns > 0 && { href: "/admin/options?status=PENDING", label: `${pendingAddOns} option${pendingAddOns > 1 ? "s" : ""} en attente de paiement`, icon: Puzzle, tone: "neutral" as const },
    trialsEndingSoon > 0 && { href: "/admin/abonnements?sub=TRIALING", label: `${trialsEndingSoon} essai${trialsEndingSoon > 1 ? "s" : ""} se termine${trialsEndingSoon > 1 ? "nt" : ""} sous 4 jours`, icon: Repeat, tone: "neutral" as const },
    storesSuspended > 0 && { href: "/admin/boutiques?status=SUSPENDED", label: `${storesSuspended} boutique${storesSuspended > 1 ? "s" : ""} suspendue${storesSuspended > 1 ? "s" : ""}`, icon: AlertTriangle, tone: "neutral" as const },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Receipt; tone: "danger" | "warning" | "neutral" }[];

  const planBars = PLAN_ORDER.filter((p) => p !== "FREE").map((p) => ({
    key: p,
    label: PLANS[p].name,
    value: mrr.byPlan[p].count,
    display: `${mrr.byPlan[p].count} client${mrr.byPlan[p].count > 1 ? "s" : ""}`,
    hint: mrr.byPlan[p].count ? `${formatMoney(mrr.byPlan[p].consolidatedEur, "EUR")} par mois au tarif Monde` : undefined,
    href: `/admin/abonnements?plan=${p}`,
  }));
  const addOnCounts = new Map<string, number>();
  for (const a of activeAddOns) addOnCounts.set(a.addOnId, (addOnCounts.get(a.addOnId) ?? 0) + a.quantity);
  const addOnBars = [...addOnCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ key: id, label: getAddOn(id)?.name ?? id, value: n, display: `${n} active${n > 1 ? "s" : ""}` }));
  const revenueParts = Object.entries(addOnRevenue).sort((a, b) => (a[0] === "XOF" ? -1 : b[0] === "XOF" ? 1 : 0)).map(([c, a]) => formatMoney(a, c));
  const revenueLabel = revenueParts[0] ?? formatMoney(0, "EUR");
  const revenueExtra = revenueParts.slice(1).join(" + ");

  const link = "inline-flex min-h-9 items-center text-sm text-primary hover:underline";

  return (
    <>
      <PageHeader title="Vue d'ensemble" description={`Revenus récurrents, activation et points d'attention. Données au ${formatDateTime(now)}.`} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="MRR consolidé" value={formatMoney(mrr.consolidatedEur + addOnMrr, "EUR")} icon={TrendingUp} hint={`Tarif Monde, dont options ${formatMoney(addOnMrr, "EUR")}`} />
        <Kpi label="Clients payants" value={mrr.paying} icon={Users} hint={arpaEur != null ? `ARPA ${formatMoney(arpaEur, "EUR")} par mois` : `${trials.length} en essai`} href="/admin/abonnements?sub=ACTIVE" />
        <Kpi label="Churn du mois" value={monthChurn.rate == null ? "-" : `${monthChurn.rate.toLocaleString("fr-FR")} %`} icon={TrendingDown} hint={monthChurn.base ? `${monthChurn.lost} sur ${monthChurn.base} payants au 1er` : "Aucun payant au 1er du mois"} />
        <Kpi label="Conversion essai" value={conversion == null ? "-" : `${conversion.toLocaleString("fr-FR")} %`} icon={Repeat} hint={`${converted} sur ${matureStores.length} boutiques de plus de ${TRIAL_DAYS} j`} />
        <Kpi label="Inscriptions (30 j)" value={signups30.toLocaleString("fr-FR")} icon={UserPlus} hint={`${storesTotal} boutiques au total`} href="/admin/utilisateurs" />
        <Kpi label="Commandes (30 j)" value={orders30.toLocaleString("fr-FR")} icon={ShoppingBag} hint="Toutes boutiques, tous statuts" />
        <Kpi label="Revenus options (30 j)" value={revenueLabel} icon={Puzzle} hint={revenueExtra ? `et ${revenueExtra}, ${activeAddOns.length} actives` : `${activeAddOns.length} option${activeAddOns.length > 1 ? "s" : ""} active${activeAddOns.length > 1 ? "s" : ""}`} href="/admin/options" />
        <Kpi label="Factures à encaisser" value={openInvoices} icon={Receipt} hint={overdueInvoices ? `${overdueInvoices} en retard` : "Aucune en retard"} href="/admin/abonnements?status=OPEN" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card as="section" aria-labelledby="mrr-title" className="xl:col-span-2">
          <CardHeader
            title={<span id="mrr-title">MRR facturé sur 12 mois</span>}
            description="Reconstruit depuis les factures d'abonnement payées, ramenées au mois. Une courbe par devise, sans conversion."
          />
          <div className="grid grid-cols-1 gap-6 px-5 pb-5 pt-3 sm:px-6 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-muted">Facturé en euros</p>
              <p className="tabular mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">{formatMoney(lastEur, "EUR")}</p>
              <AreaChart className="mt-3" data={mrrEurPoints} format={{ kind: "money", currency: "EUR" }} label="MRR facturé en euros, 12 derniers mois" summary={`Ce mois-ci : ${formatMoney(lastEur, "EUR")}.`} height={180} emptyLabel="Aucune facture payée en euros." />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-muted">Facturé en FCFA</p>
              <p className="tabular mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">{formatMoney(lastXof, "XOF")}</p>
              <AreaChart className="mt-3" data={mrrXofPoints} format={{ kind: "money", currency: "XOF" }} label="MRR facturé en FCFA, 12 derniers mois" summary={`Ce mois-ci : ${formatMoney(lastXof, "XOF")}.`} height={180} emptyLabel="Aucune facture payée en FCFA." />
            </div>
          </div>
        </Card>

        <Card as="section" aria-labelledby="todo">
          <CardHeader title={<span id="todo">À traiter</span>} description={alerts.length ? "Points d'attention, du plus urgent au moins urgent." : undefined} />
          {alerts.length === 0 ? (
            <div className="flex items-center gap-3 px-5 pb-6 pt-3 text-sm text-ink-muted sm:px-6">
              <CheckCircle2 className="size-5 text-primary" aria-hidden /> Rien d&apos;urgent. Tout est à jour.
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {alerts.map((a) => (
                <li key={a.href}>
                  <Link href={a.href} className="flex min-h-12 items-center gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-surface-2/60 sm:px-6">
                    <span className={a.tone === "danger" ? "text-danger" : a.tone === "warning" ? "text-warning" : "text-ink-muted"}>
                      <a.icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex-1 font-medium text-ink">{a.label}</span>
                    <ArrowRight className="size-4 text-ink-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card as="section" aria-labelledby="signups">
          <CardHeader title={<span id="signups">Inscriptions par semaine</span>} description="12 dernières semaines, hors équipe." />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <BarChart data={signupPoints} format={{ kind: "count", singular: "inscription", plural: "inscriptions" }} label="Inscriptions par semaine" summary={`${signupPoints.reduce((a, p) => a + p.value, 0)} inscriptions en 12 semaines.`} />
          </div>
        </Card>
        <Card as="section" aria-labelledby="published">
          <CardHeader title={<span id="published">Boutiques publiées par semaine</span>} description="Première mise en ligne." />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <BarChart data={publishedPoints} format={{ kind: "count", singular: "boutique", plural: "boutiques" }} label="Boutiques publiées par semaine" summary={`${publishedPoints.reduce((a, p) => a + p.value, 0)} boutiques publiées en 12 semaines.`} />
          </div>
        </Card>
        <Card as="section" aria-labelledby="orders" className="lg:col-span-2 xl:col-span-1">
          <CardHeader title={<span id="orders">Commandes de la plateforme</span>} description="Par jour, 30 derniers jours." />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <BarChart data={orderPoints} format={{ kind: "count", singular: "commande", plural: "commandes" }} label="Commandes par jour" summary={`${orders30} commandes en 30 jours.`} />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card as="section" aria-labelledby="funnel">
          <CardHeader title={<span id="funnel">Entonnoir d&apos;activation</span>} description="Tous les comptes marchands, de l'inscription à la première commande." />
          <ActivationFunnel steps={funnelSteps} />
        </Card>
        <Card as="section" aria-labelledby="top-stores">
          <CardHeader title={<span id="top-stores">Boutiques les plus actives</span>} description="Commandes des 30 derniers jours." action={<Link href="/admin/boutiques" className={link}>Toutes</Link>} />
          <BarList items={topBars} label="Boutiques par volume de commandes" empty="Aucune commande sur 30 jours." />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="by-plan">
          <CardHeader title={<span id="by-plan">Clients payants par plan</span>} description="Abonnements actifs, hors essai." />
          <BarList items={planBars} label="Clients payants par plan" empty="Aucun client payant pour le moment." />
        </Card>
        <Card as="section" aria-labelledby="addons-top">
          <CardHeader title={<span id="addons-top">Options les plus vendues</span>} description="Options actives aujourd'hui." action={<Link href="/admin/options" className={link}>Tout voir</Link>} />
          <BarList items={addOnBars} label="Options actives" empty="Aucune option active." />
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section aria-labelledby="recent-invoices" className="min-w-0">
          <SectionTitle id="recent-invoices" title="Dernières factures" action={<Link href="/admin/abonnements" className={link}>Tout voir</Link>} />
          {recentInvoices.length === 0 ? (
            <EmptyState icon={Receipt} title="Aucune facture" description="Les factures d'abonnement et d'options apparaîtront ici." />
          ) : (
            <Table minWidth={520}>
              <THead>
                <TR>
                  <TH>Facture</TH>
                  <TH>Boutique</TH>
                  <TH>Statut</TH>
                  <TH align="right">Montant</TH>
                </TR>
              </THead>
              <TBody>
                {recentInvoices.map((inv) => (
                  <TR key={inv.id}>
                    <TD><span className="font-mono text-xs">{inv.number}</span><span className="block text-xs text-ink-muted">{relativeTime(inv.createdAt)}</span></TD>
                    <TD><Link href={`/admin/boutiques/${inv.subscription.storeId}`} className="hover:text-primary">{inv.subscription.store.name}</Link></TD>
                    <TD><StatusBadge map={INVOICE_STATUS} value={inv.status} /></TD>
                    <TD align="right">{formatMoney(inv.amount, inv.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        <section aria-labelledby="recent-stores" className="min-w-0">
          <SectionTitle id="recent-stores" title="Dernières boutiques" action={<Link href="/admin/boutiques" className={link}>Tout voir</Link>} />
          {recentStores.length === 0 ? (
            <EmptyState icon={Store} title="Aucune boutique" description="Les boutiques créées apparaîtront ici." />
          ) : (
            <Table minWidth={520}>
              <THead>
                <TR>
                  <TH>Boutique</TH>
                  <TH>Plan</TH>
                  <TH>Statut</TH>
                  <TH align="right">Créée</TH>
                </TR>
              </THead>
              <TBody>
                {recentStores.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/admin/boutiques/${s.id}`} className="font-medium text-ink hover:text-primary">{s.name}</Link>
                      <span className="block text-xs text-ink-muted">{s.city ?? `/${s.slug}`}</span>
                    </TD>
                    <TD>
                      {s.subscription ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {PLANS[s.subscription.planId].name}
                          {s.subscription.status !== "ACTIVE" && <StatusBadge map={SUB_STATUS} value={s.subscription.status} />}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TD>
                    <TD><StatusBadge map={STORE_STATUS} value={s.status} /></TD>
                    <TD align="right"><span className="text-ink-muted">{relativeTime(s.createdAt)}</span></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      </div>

      <section aria-labelledby="recent-audit" className="mt-8">
        <SectionTitle id="recent-audit" title="Actions de l'équipe" action={<Link href="/admin/audit" className={link}>Journal complet</Link>} />
        {recentAudit.length === 0 ? (
          <EmptyState title="Aucune action" description="Les actions de l'équipe plateforme sont journalisées ici." />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {recentAudit.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm sm:px-6">
                  <span className="font-mono text-xs text-ink-muted">{a.action}</span>
                  <span className="text-ink">{a.actor?.name ?? "Système"}</span>
                  {a.store && <span className="text-ink-muted">{a.store.name}</span>}
                  <span className="ml-auto text-xs text-ink-faint">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      <p className="mt-6 text-xs text-ink-faint">MRR consolidé : abonnements actifs valorisés au tarif Monde (base comparable entre zones). Mis à jour le {formatDate(now)}.</p>
    </>
  );
}
