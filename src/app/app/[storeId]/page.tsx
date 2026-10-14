import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle, Rocket, PackageX, Clock, ArrowRight, Plus, MessageCircle, CheckCircle2, Circle, ExternalLink, Inbox,
} from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { formatDate, relativeTime, addDays, currentPeriod, cn } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/commerce/order-state";
import { Alert, Avatar, Kpi, Money } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Progress } from "@/components/ui/progress";
import { SalesChart } from "./sales-chart";
import { DateRangeFilter } from "./date-range-filter";
import { thumbUrl } from "@/lib/image-loader";
import { lowStockItems, storeLowStockThreshold } from "@/lib/inventory/service";

export const metadata: Metadata = { title: "Tableau de bord" };

const PERIODS = [1, 7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** Clé de jour (AAAA-MM-JJ) dans le fuseau de la boutique. */
function dayKey(d: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Analyse une date AAAA-MM-JJ (minuit local) ; null si invalide. */
function parseDay(s?: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ periode?: string; debut?: string; fin?: string; denied?: string }>;
}) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "store.view");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const now = new Date();

  // ── Plage analysée : soit une plage personnalisée (calendrier : ?debut&fin), soit une période prédéfinie.
  const customStart = parseDay(sp.debut);
  const customEnd = parseDay(sp.fin);
  const isCustom = !!(customStart && customEnd && customStart <= customEnd);
  let since: Date;
  let until: Date; // borne haute exclusive
  let days: number;
  let mode: string; // valeur active du contrôle segmenté ("1" | "7" | "30" | "90" | "custom")
  if (isCustom) {
    since = new Date(customStart!);
    since.setHours(0, 0, 0, 0);
    until = addDays(customEnd!, 1);
    until.setHours(0, 0, 0, 0);
    days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400000));
    mode = "custom";
  } else {
    const d: Period = PERIODS.includes(Number(sp.periode) as Period) ? (Number(sp.periode) as Period) : 30;
    days = d;
    since = addDays(now, -(days - 1));
    since.setHours(0, 0, 0, 0);
    until = addDays(now, 1);
    until.setHours(0, 0, 0, 0);
    mode = String(d);
  }
  const prevSince = addDays(since, -days);
  const partial = store.createdAt > since;
  const base = `/app/${store.id}`;
  const rangeLabel = isCustom
    ? `du ${formatDate(since)} au ${formatDate(customEnd!)}`
    : days === 1
      ? "aujourd'hui"
      : `${days} derniers jours`;
  const canOrders = ctx.can("orders.view");
  const canCatalog = ctx.can("products.manage") || ctx.role === "SUPPORT";

  const [
    orders, prevOrders, toProcess, toProcessCount, outOfStock, unreadConvs, outOfQuotaCount, recurring, prevRecurring,
    ordersUsage, productsCount, membersCount, waUsage, productsActive, zonesCount, paymentsCount, anyOrder,
  ] = await Promise.all([
    db.order.findMany({
      where: { storeId: store.id, createdAt: { gte: since, lt: until } },
      select: { total: true, status: true, paymentStatus: true, createdAt: true },
    }),
    db.order.findMany({
      where: { storeId: store.id, createdAt: { gte: prevSince, lt: since } },
      select: { total: true, status: true, paymentStatus: true },
    }),
    canOrders
      ? db.order.findMany({
          where: { storeId: store.id, status: { in: ["NEW", "CONFIRMED", "PREPARING", "READY"] } },
          orderBy: [{ createdAt: "asc" }],
          take: 6,
          select: { id: true, reference: true, customerName: true, total: true, currency: true, status: true, createdAt: true, fulfillmentType: true, outOfQuota: true },
        })
      : Promise.resolve([]),
    canOrders ? db.order.count({ where: { storeId: store.id, status: { in: ["NEW", "CONFIRMED", "PREPARING", "READY"] } } }) : Promise.resolve(0),
    // Stock bas, ruptures et surventes (seuil du produit, sinon de la boutique), les plus urgents d'abord.
    storeLowStockThreshold(store.id).then((t) => lowStockItems(store.id, { storeThreshold: t, scope: "active", limit: 5 })),
    db.conversation
      .findMany({
        where: { storeId: store.id, unreadCount: { gt: 0 }, status: { not: "CLOSED" } },
        orderBy: { lastMessageAt: "desc" },
        take: 5,
        select: { id: true, name: true, lastPreview: true, lastMessageAt: true, unreadCount: true },
      })
      .catch(() => []),
    db.order.count({ where: { storeId: store.id, outOfQuota: true, createdAt: { gte: addDays(now, -7) } } }),
    db.customer.count({ where: { storeId: store.id, ordersCount: { gte: 2 }, lastOrderAt: { gte: since, lt: until } } }),
    db.customer.count({ where: { storeId: store.id, ordersCount: { gte: 2 }, lastOrderAt: { gte: prevSince, lt: since } } }),
    db.usageCounter.findUnique({ where: { storeId_metric_period: { storeId: store.id, metric: "orders", period: currentPeriod() } } }).then((r) => r?.value ?? 0),
    db.product.count({ where: { storeId: store.id, status: { not: "ARCHIVED" } } }),
    db.membership.count({ where: { storeId: store.id, role: { not: "SUPPORT" } } }),
    db.usageCounter
      .findUnique({ where: { storeId_metric_period: { storeId: store.id, metric: "whatsapp_messages", period: currentPeriod() } } })
      .then((r) => r?.value ?? 0),
    db.product.count({ where: { storeId: store.id, status: "ACTIVE" } }),
    db.deliveryZone.count({ where: { storeId: store.id, active: true } }),
    db.paymentMethod.count({ where: { storeId: store.id, active: true } }),
    db.order.findFirst({ where: { storeId: store.id }, select: { id: true } }),
  ]);
  // Commandes livrées (ou retirées) mais jamais encaissées : typiquement un paiement à la livraison oublié.
  const deliveredUnpaid = canOrders
    ? await db.order.count({ where: { storeId: store.id, status: "DELIVERED", paymentStatus: { in: ["UNPAID", "PENDING"] } } })
    : 0;

  // ── Indicateurs (période courante vs précédente)
  const sum = (list: { total: number }[]) => list.reduce((s, o) => s + o.total, 0);
  const valid = orders.filter((o) => o.status !== "CANCELLED");
  const prevValid = prevOrders.filter((o) => o.status !== "CANCELLED");
  const isPaid = (o: { paymentStatus: string }) => o.paymentStatus === "PAID" || o.paymentStatus === "PARTIALLY_REFUNDED";
  const gross = sum(valid);
  const prevGross = sum(prevValid);
  const paid = sum(orders.filter(isPaid));
  const prevPaid = sum(prevOrders.filter(isPaid));
  const avg = valid.length ? Math.round(gross / valid.length) : 0;
  const prevAvg = prevValid.length ? Math.round(prevGross / prevValid.length) : 0;
  const hasPrev = store.createdAt <= prevSince || prevOrders.length > 0;
  const d = (cur: number, prev: number) => (hasPrev ? pctChange(cur, prev) : null);

  // ── Série par jour
  const tz = store.timezone || "Africa/Porto-Novo";
  const byDay = new Map<string, { value: number; orders: number }>();
  for (let k = 0; k < days; k++) {
    const dd = addDays(since, k);
    dd.setHours(12, 0, 0, 0); // midi : évite les décalages de fuseau sur les bornes de jour
    byDay.set(dayKey(dd, tz), { value: 0, orders: 0 });
  }
  for (const o of valid) {
    const k = dayKey(o.createdAt, tz);
    const cur = byDay.get(k);
    if (cur) {
      cur.value += o.total;
      cur.orders += 1;
    }
  }
  const series = [...byDay.entries()].map(([date, v]) => ({ date, ...v }));

  // ── Salutation (fuseau de la boutique)
  const hour = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  const greeting = hour >= 18 || hour < 4 ? "Bonsoir" : "Bonjour";
  const firstName = ctx.user.name.split(" ")[0];

  const sub = store.subscription;
  const trialDaysLeft = sub?.status === "TRIALING" && sub.trialEndsAt ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86400000)) : null;

  // ── Checklist de démarrage (si non publiée)
  const steps = [
    { done: !!store.whatsappNumber, label: "Ajouter votre numéro WhatsApp", href: `${base}/demarrage` },
    { done: productsActive > 0, label: "Ajouter un premier produit", href: `${base}/produits/nouveau` },
    { done: zonesCount > 0 || store.pickupEnabled, label: "Régler la livraison ou le retrait", href: `${base}/livraison` },
    { done: paymentsCount > 0, label: "Choisir vos moyens de paiement", href: `${base}/paiements` },
    { done: store.status === "PUBLISHED", label: "Publier la boutique", href: `${base}/demarrage` },
    { done: !!anyOrder, label: "Passer une commande test", href: `/s/${store.slug}` },
  ];
  const stepsDone = steps.filter((s) => s.done).length;
  const showChecklist = stepsDone < steps.length && (store.status !== "PUBLISHED" || !store.onboardingCompleted) && ctx.can("store.settings");

  const alerts: { tone: "warning" | "info" | "danger"; icon: typeof Rocket; text: string; href: string; cta: string }[] = [];
  if (outOfQuotaCount > 0)
    alerts.push({
      tone: "danger",
      icon: AlertTriangle,
      text: `${outOfQuotaCount} commande${outOfQuotaCount > 1 ? "s" : ""} hors quota cette semaine (plan ${plan.name}). Elles restent visibles 7 jours.`,
      href: `${base}/abonnement`,
      cta: "Voir les plans",
    });
  if (trialDaysLeft != null && trialDaysLeft <= 5)
    alerts.push({
      tone: "info",
      icon: Clock,
      text: trialDaysLeft === 0 ? `Votre essai ${plan.name} se termine aujourd'hui.` : `Votre essai ${plan.name} se termine dans ${trialDaysLeft} jour${trialDaysLeft > 1 ? "s" : ""}.`,
      href: `${base}/abonnement`,
      cta: "Choisir un plan",
    });
  if (deliveredUnpaid > 0)
    alerts.push({
      tone: "warning",
      icon: AlertTriangle,
      text: `${deliveredUnpaid} commande${deliveredUnpaid > 1 ? "s" : ""} livrée${deliveredUnpaid > 1 ? "s" : ""} mais non encaissée${deliveredUnpaid > 1 ? "s" : ""} : marquez le paiement reçu (espèces à la livraison) ou relancez le client.`,
      href: `${base}/commandes`,
      cta: "Voir les commandes",
    });
  if (sub?.status === "PAST_DUE")
    alerts.push({ tone: "danger", icon: AlertTriangle, text: "Votre dernier paiement d'abonnement n'a pas abouti.", href: `${base}/abonnement`, cta: "Régulariser" });

  const usageRows = [
    { label: "Commandes ce mois", used: ordersUsage, limit: plan.limits.ordersPerMonth },
    { label: "Produits", used: productsCount, limit: plan.limits.products },
    { label: "Membres de l'équipe", used: membersCount, limit: plan.limits.members },
    ...(plan.limits.whatsappMessagesPerMonth ? [{ label: "Messages WhatsApp ce mois", used: waUsage, limit: plan.limits.whatsappMessagesPerMonth }] : []),
  ];
  const nearLimit = usageRows.some((u) => u.limit != null && u.used / Math.max(1, u.limit) >= 0.8);

  const FULFILL: Record<string, string> = { PICKUP: "Retrait", DELIVERY: "Livraison", WHATSAPP: "WhatsApp" };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[30px]">
            {greeting} {firstName}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {toProcessCount > 0 ? (
              <>
                {toProcessCount} commande{toProcessCount > 1 ? "s" : ""} à traiter
                {unreadConvs.length > 0 && `, ${unreadConvs.length} conversation${unreadConvs.length > 1 ? "s" : ""} en attente`}.
              </>
            ) : (
              <>Tout est à jour pour {store.name}.</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Période"
            size="sm"
            value={mode}
            options={[
              { value: "1", label: "Aujourd'hui", href: `${base}?periode=1` },
              { value: "7", label: "7 jours", href: `${base}?periode=7` },
              { value: "30", label: "30 jours", href: base },
              { value: "90", label: "90 jours", href: `${base}?periode=90` },
            ]}
          />
          <DateRangeFilter base={base} start={isCustom ? sp.debut : undefined} end={isCustom ? sp.fin : undefined} />
          {ctx.can("orders.manage") && (
            <ButtonLink href={`${base}/commandes/nouvelle`} size="sm" className="h-10">
              <Plus className="size-4" aria-hidden /> Nouvelle commande
            </ButtonLink>
          )}
        </div>
      </div>

      {sp.denied && <Alert tone="warning">Votre rôle ne permet pas d&apos;accéder à cette page.</Alert>}

      {alerts.length > 0 && (
        <ul className="space-y-2" aria-label="Alertes">
          {alerts.map((a, i) => (
            <li key={i}>
              <Alert tone={a.tone}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    <a.icon className="size-4 shrink-0" aria-hidden /> {a.text}
                  </span>
                  <Link href={a.href} className="inline-flex min-h-8 items-center gap-1 font-semibold underline-offset-4 hover:underline">
                    {a.cta} <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </Alert>
            </li>
          ))}
        </ul>
      )}

      {/* Checklist de démarrage */}
      {showChecklist && (
        <section aria-labelledby="checklist-title" className="overflow-hidden rounded-[var(--radius-xl)] bg-forest text-white">
          <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,320px)_1fr] xl:gap-10">
            <div>
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-lime">
                <Rocket className="size-5" aria-hidden />
              </span>
              <h2 id="checklist-title" className="mt-4 text-xl font-semibold tracking-[-0.025em]">
                Plus que {steps.length - stepsDone} étape{steps.length - stepsDone > 1 ? "s" : ""} avant vos premières ventes
              </h2>
              <p className="mt-1.5 text-sm text-white/70">Votre boutique est prête à {Math.round((stepsDone / steps.length) * 100)} %.</p>
              <div
                className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={steps.length}
                aria-valuenow={stepsDone}
                aria-label="Progression du démarrage"
              >
                <div className="h-full origin-left rounded-full bg-lime transition-transform duration-700 ease-out-expo" style={{ transform: `scaleX(${stepsDone / steps.length})` }} />
              </div>
              <ButtonLink href={`${base}/demarrage`} variant="accent" size="sm" trailing className="mt-5">
                Reprendre le démarrage
              </ButtonLink>
            </div>
            <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {steps.map((s, i) => (
                <li key={i}>
                  <Link
                    href={s.href}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-sm transition-colors duration-150",
                      s.done ? "text-white/60" : "bg-white/[0.06] text-white ring-1 ring-inset ring-white/10 hover:bg-white/10",
                    )}
                  >
                    {s.done ? <CheckCircle2 className="size-5 shrink-0 text-lime" aria-hidden /> : <Circle className="size-5 shrink-0 text-white/40" aria-hidden />}
                    <span className={cn("flex-1", s.done && "line-through decoration-white/30")}>{s.label}</span>
                    <span className="sr-only">{s.done ? "(fait)" : "(à faire)"}</span>
                    {!s.done && <ArrowRight className="size-4 shrink-0 text-white/50" aria-hidden />}
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* KPI */}
      <section aria-label="Indicateurs clés">
        {partial && (
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-sun-soft px-3 py-1 text-xs font-medium text-warning">
            <Clock className="size-3.5" aria-hidden /> Données partielles : boutique créée le {formatDate(store.createdAt)}.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Kpi className="col-span-2 xl:col-span-1" label="Ventes" value={formatMoney(gross, store.currency)} delta={d(gross, prevGross)} />
          <Kpi className="col-span-2 sm:col-span-1" label="Encaissé" value={formatMoney(paid, store.currency)} delta={d(paid, prevPaid)} />
          <Kpi label="Commandes" value={valid.length.toLocaleString("fr-FR")} delta={d(valid.length, prevValid.length)} href={canOrders ? `${base}/commandes` : undefined} />
          <Kpi className="col-span-2 max-sm:order-last sm:col-span-1" label="Panier moyen" value={formatMoney(avg, store.currency)} delta={d(avg, prevAvg)} />
          <Kpi label="Clients récurrents" value={recurring.toLocaleString("fr-FR")} delta={d(recurring, prevRecurring)} href={canCatalog ? `${base}/clients` : undefined} />
        </div>
      </section>

      {/* Graphique + à traiter */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card as="section" aria-labelledby="chart-title">
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 sm:px-6">
            <div>
              <h2 id="chart-title" className="text-[15px] font-semibold tracking-tight text-ink">Ventes par jour</h2>
              <p className="mt-0.5 text-sm text-ink-muted">Commandes non annulées, {rangeLabel}</p>
            </div>
            <p className="tabular text-right text-2xl font-semibold tracking-[-0.03em] text-ink">{formatMoney(gross, store.currency)}</p>
          </div>
          <div className="px-3 pb-4 pt-4 sm:px-4">
            <SalesChart series={series} currency={store.currency} />
          </div>
        </Card>

        <Card as="section" aria-labelledby="todo-title" className="flex flex-col">
          <CardHeader
            title={<span id="todo-title">Commandes à traiter</span>}
            description={toProcessCount ? `${toProcessCount} en cours, les plus anciennes d'abord` : undefined}
            action={
              canOrders && toProcessCount > 0 ? (
                <Link href={`${base}/commandes`} className="inline-flex min-h-8 items-center text-sm font-medium text-primary hover:underline">
                  Tout voir
                </Link>
              ) : undefined
            }
          />
          {toProcess.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Inbox className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-sm font-medium text-ink">Aucune commande en attente</p>
              <p className="mt-1 text-sm text-ink-muted">Les nouvelles commandes apparaîtront ici.</p>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {toProcess.map((o) => (
                <li key={o.id}>
                  <Link href={`${base}/commandes/${o.id}`} className="flex min-h-14 items-center gap-3 px-5 py-2.5 transition-colors duration-150 hover:bg-surface-2/60 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-ink">{o.reference}</span>
                        {o.outOfQuota && <Badge tone="danger">Hors quota</Badge>}
                      </p>
                      <p className="truncate text-[13px] text-ink-muted">
                        {o.customerName}, {FULFILL[o.fulfillmentType] ?? o.fulfillmentType.toLowerCase()},{" "}
                        <time dateTime={o.createdAt.toISOString()}>{relativeTime(o.createdAt)}</time>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money amount={o.total} currency={o.currency} className="block text-sm font-semibold" />
                      <Badge tone={ORDER_STATUS_TONE[o.status]} className="mt-0.5">
                        {ORDER_STATUS_LABELS[o.status]}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Bas de page : ruptures, conversations, usage */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card as="section" aria-labelledby="stock-title">
          <CardHeader
            title={<span id="stock-title">Stock bas et ruptures</span>}
            action={
              outOfStock.length > 0 && canCatalog ? (
                <Link href={`${base}/produits/stock?vue=bas`} className="inline-flex min-h-8 items-center text-sm font-medium text-primary hover:underline">
                  Gérer
                </Link>
              ) : undefined
            }
          />
          {outOfStock.length === 0 ? (
            <p className="flex items-center gap-2 px-5 pb-5 pt-2 text-sm text-ink-muted sm:px-6">
              <CheckCircle2 className="size-4 text-primary" aria-hidden /> Aucun article suivi sous son seuil d&apos;alerte.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {outOfStock.map((p) => {
                const img = p.imageUrl ?? (Array.isArray(p.images) ? (p.images[0] as { url?: string } | undefined)?.url : undefined);
                return (
                  <li key={p.variantId ?? p.productId}>
                    <Link href={`${base}/produits/${p.productId}/stock`} className="flex min-h-12 items-center gap-3 px-5 py-2 transition-colors hover:bg-surface-2/60 sm:px-6">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl(img)} alt="" className="size-9 shrink-0 rounded-[10px] object-cover ring-1 ring-line" loading="lazy" />
                      ) : (
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-faint">
                          <PackageX className="size-4" aria-hidden />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {p.name}
                        {p.variantName && <span className="font-normal text-ink-muted"> · {p.variantName}</span>}
                      </span>
                      {p.stock < 0 ? (
                        <Badge tone="danger">Survente</Badge>
                      ) : p.stock === 0 ? (
                        p.policy === "CONTINUE" ? <Badge tone="info">Précommande</Badge> : <Badge tone="danger">Épuisé</Badge>
                      ) : (
                        <Badge tone="warning">{`Plus que ${p.stock}`}</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card as="section" aria-labelledby="conv-title">
          <CardHeader
            title={<span id="conv-title">Conversations non lues</span>}
            action={
              <Link href={`${base}/conversations`} className="inline-flex min-h-8 items-center text-sm font-medium text-primary hover:underline">
                Ouvrir la boîte
              </Link>
            }
          />
          {unreadConvs.length === 0 ? (
            <p className="flex items-center gap-2 px-5 pb-5 pt-2 text-sm text-ink-muted sm:px-6">
              <MessageCircle className="size-4 text-ink-faint" aria-hidden /> Aucun message en attente de réponse.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {unreadConvs.map((c) => (
                <li key={c.id}>
                  <Link href={`${base}/conversations?c=${c.id}`} className="flex min-h-14 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/60 sm:px-6">
                    <Avatar name={c.name} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
                        <time className="shrink-0 text-xs text-ink-faint" dateTime={c.lastMessageAt.toISOString()}>
                          {relativeTime(c.lastMessageAt)}
                        </time>
                      </p>
                      <p className="truncate text-[13px] text-ink-muted">{c.lastPreview ?? "Nouveau message"}</p>
                    </div>
                    <span className="tabular inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-on-accent">
                      {c.unreadCount}
                      <span className="sr-only"> non lus</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" aria-labelledby="usage-title" className="md:col-span-2 xl:col-span-1">
          <CardHeader
            title={<span id="usage-title">Usage du plan {plan.name}</span>}
            description={trialDaysLeft != null ? `Essai gratuit, ${trialDaysLeft} jour${trialDaysLeft > 1 ? "s" : ""} restant${trialDaysLeft > 1 ? "s" : ""}` : "Remis à zéro chaque mois"}
          />
          <div className="space-y-4 px-5 pb-5 pt-3 sm:px-6">
            {usageRows.map((u) => (
              <Progress key={u.label} label={u.label} showValue value={u.used} max={u.limit} />
            ))}
            {ctx.role === "OWNER" && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <ButtonLink href={`${base}/abonnement`} size="sm" variant={nearLimit ? "accent" : "outline"} trailing={nearLimit ? true : undefined}>
                  {nearLimit ? "Augmenter mes limites" : "Comparer les plans"}
                </ButtonLink>
                <ButtonLink href={`${base}/options`} size="sm" variant="ghost">
                  Options et crédits
                </ButtonLink>
              </div>
            )}
          </div>
        </Card>
      </div>

      {store.status === "PUBLISHED" && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          Votre boutique est en ligne :
          <Link href={`/s/${store.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline-offset-4 hover:underline">
            /s/{store.slug} <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(nouvel onglet)</span>
          </Link>
        </p>
      )}
    </div>
  );
}
