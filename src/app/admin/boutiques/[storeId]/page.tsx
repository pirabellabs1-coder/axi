import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, ShoppingBag, ScrollText } from "lucide-react";
import { requirePlatformAdmin, ROLE_LABELS } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS, getAddOn, ADD_ON_BILLING_LABEL } from "@/config/plans";
import { getCountry } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatPhone, currentPeriod } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/commerce/order-state";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { STORE_STATUS, SUB_STATUS, INVOICE_STATUS, ADDON_STATUS, CREDIT_SHORT, ZONE_SHORT, StatusBadge, DL, JsonDetails } from "@/components/app/admin-bits";
import { walletBalance } from "@/lib/admin/metrics";
import { CreditAdjustButton } from "@/components/app/admin-credit-adjust";
import { ZoneSwitchButton } from "@/components/app/admin-zone-form";
import { StoreAdminActions } from "./store-actions";

export const metadata: Metadata = { title: "Fiche boutique" };

export default async function AdminStoreDetail({ params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requirePlatformAdmin();
  const { storeId } = await params;
  const period = currentPeriod();

  const store = await db.store.findUnique({
    where: { id: storeId },
    include: {
      subscription: { include: { invoices: { orderBy: { createdAt: "desc" }, take: 5 } } },
      memberships: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } },
      usageCounters: { where: { period } },
      _count: { select: { products: true, orders: true, customers: true } },
    },
  });
  if (!store) notFound();

  const now = new Date();
  const [orders, addOns, live, auditLogs] = await Promise.all([
    db.order.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.addOnPurchase.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.creditLedger.groupBy({ by: ["type"], where: { storeId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, _sum: { delta: true } }),
    db.auditLog.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: 15, include: { actor: { select: { name: true } } } }),
  ]);

  const owner = store.memberships.find((m) => m.role === "OWNER");
  const sub = store.subscription;
  const plan = sub ? PLANS[sub.planId] : null;
  const supportMembership = store.memberships.find((m) => m.userId === admin.id && m.role === "SUPPORT" && m.expiresAt && m.expiresAt > new Date());
  const usage = (metric: string) => store.usageCounters.find((u) => u.metric === metric)?.value ?? 0;
  const country = getCountry(store.country);
  const balances = { WA_UTILITY: 0, WA_MARKETING: 0, AI: 0 } as Record<"WA_UTILITY" | "WA_MARKETING" | "AI", number>;
  for (const l of live) balances[l.type] = walletBalance(l._sum.delta);

  return (
    <>
      <PageHeader
        title={store.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge map={STORE_STATUS} value={store.status} />
            <span>/{store.slug} · {country.name}{store.city ? ` · ${store.city}` : ""}</span>
          </span>
        }
        back={{ href: "/admin/boutiques", label: "Boutiques" }}
        actions={
          <>
            <ButtonLink href={`/s/${store.slug}`} variant="outline" size="sm" target="_blank">
              <ExternalLink className="size-4" aria-hidden /> Voir la boutique
            </ButtonLink>
            <ButtonLink href={`/app/${store.id}`} variant="secondary" size="sm">
              Ouvrir l'espace marchand
            </ButtonLink>
          </>
        }
      />

      {store.status === "SUSPENDED" && store.statusReason && (
        <Alert tone="danger" title="Boutique suspendue" className="mb-5">{store.statusReason}</Alert>
      )}
      {supportMembership && (
        <Alert tone="info" className="mb-5">
          Accès support actif jusqu'au {formatDateTime(supportMembership.expiresAt!)}{supportMembership.reason ? `. Motif : ${supportMembership.reason}` : ""}.
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader title="Actions" description="Chaque action est journalisée dans l'audit avec votre identité." />
        <CardBody>
          <StoreAdminActions storeId={store.id} status={store.status} isFeatured={store.isFeatured} listedInMarketplace={store.listedInMarketplace} supportUntil={supportMembership?.expiresAt?.toISOString() ?? null} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Informations" />
          <CardBody>
            <DL
              items={[
                { label: "Secteur", value: store.sector },
                { label: "Catégorie marketplace", value: store.category },
                { label: "Thème", value: store.themeId },
                { label: "WhatsApp", value: store.whatsappNumber ? formatPhone(store.whatsappNumber) : null },
                { label: "E-mail de contact", value: store.contactEmail },
                { label: "Devise", value: store.currency },
                { label: "Fuseau", value: store.timezone },
                { label: "Marketplace", value: `${store.listedInMarketplace ? "Listée" : "Non listée"}${store.isFeatured ? " · Vedette" : ""}` },
                { label: "Onboarding", value: store.onboardingCompleted ? "Terminé" : `Étape ${store.onboardingStep}` },
                { label: "Créée le", value: formatDateTime(store.createdAt) },
                { label: "Publiée le", value: store.publishedAt ? formatDateTime(store.publishedAt) : "Jamais" },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Propriétaire et équipe" description={`${store.memberships.length} membre${store.memberships.length > 1 ? "s" : ""}`} />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {store.memberships.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/utilisateurs/${m.user.id}`} className="font-medium text-ink hover:text-primary">{m.user.name}</Link>
                    <span className="block truncate text-xs text-ink-muted">{m.user.email}</span>
                  </div>
                  <Badge tone={m.role === "OWNER" ? "primary" : m.role === "SUPPORT" ? "sun" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                  {m.expiresAt && <span className="text-xs text-ink-faint">jusqu'au {formatDateTime(m.expiresAt)}</span>}
                </li>
              ))}
            </ul>
            {!owner && <p className="px-5 py-3 text-sm text-danger">Aucun propriétaire : anomalie à corriger.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Abonnement" action={<Link href="/admin/abonnements" className="text-sm text-primary hover:underline">Gérer</Link>} />
          <CardBody>
            {sub && plan ? (
              <>
                <DL
                  items={[
                    { label: "Plan", value: plan.name },
                    { label: "Zone tarifaire", value: <span className="inline-flex flex-wrap items-center gap-2">{ZONE_SHORT[sub.zone] ?? sub.zone}<ZoneSwitchButton storeId={store.id} zone={sub.zone === "AFRICA" ? "AFRICA" : "WORLD"} /></span> },
                    { label: "Statut", value: <StatusBadge map={SUB_STATUS} value={sub.status} /> },
                    { label: "Intervalle", value: sub.interval === "YEARLY" ? "Annuel" : "Mensuel" },
                    { label: "Fin d'essai", value: sub.trialEndsAt ? formatDate(sub.trialEndsAt) : null },
                    { label: "Période", value: `${formatDate(sub.currentPeriodStart)} → ${sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "sans échéance"}` },
                    { label: "Fournisseur", value: sub.provider },
                  ]}
                />
                {sub.invoices.length > 0 && (
                  <ul className="mt-4 divide-y divide-line rounded-[var(--radius-md)] border border-line text-sm">
                    {sub.invoices.map((inv) => (
                      <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <span className="font-mono text-xs">{inv.number}</span>
                        <span className="flex-1">{formatMoney(inv.amount, inv.currency)}</span>
                        <StatusBadge map={INVOICE_STATUS} value={inv.status} />
                        <span className="text-xs text-ink-faint">échéance {formatDate(inv.dueAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-muted">Aucun abonnement (plan Gratuit implicite).</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Usage" description={`Période ${period}`} />
          <CardBody>
            <DL
              items={[
                { label: "Produits", value: `${store._count.products}${plan?.limits.products != null ? ` / ${plan.limits.products}` : ""}` },
                { label: "Commandes ce mois", value: `${usage("orders")}${plan?.limits.ordersPerMonth != null ? ` / ${plan.limits.ordersPerMonth}` : ""}` },
                { label: "Commandes (total)", value: store._count.orders },
                { label: "Clients", value: store._count.customers },
                { label: "Messages WhatsApp", value: usage("whatsapp_messages") },
                { label: "Crédits IA", value: usage("ai_credits") },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Portefeuille de crédits" description="Crédits non expirés (inclus du mois, packs, gestes commerciaux)." action={<CreditAdjustButton storeId={store.id} storeName={store.name} balances={balances} />} />
          <CardBody>
            <DL items={(["WA_UTILITY", "WA_MARKETING", "AI"] as const).map((t) => ({ label: CREDIT_SHORT[t], value: <span className="tabular">{balances[t].toLocaleString("fr-FR")}</span> }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Options" description={`${addOns.filter((a) => a.status === "ACTIVE").length} active(s)`} action={<Link href="/admin/options" className="inline-flex min-h-9 items-center text-sm text-primary hover:underline">Toutes les options</Link>} />
          <CardBody className="pt-3">
            {addOns.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucune option achetée.</p>
            ) : (
              <ul className="divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line text-sm">
                {addOns.map((a) => {
                  const def = getAddOn(a.addOnId);
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-ink">{def?.name ?? a.addOnId}</span>
                        <span className="block text-xs text-ink-muted">{def ? ADD_ON_BILLING_LABEL[def.billing] : ""}{a.endsAt ? `, jusqu'au ${formatDate(a.endsAt)}` : ""}</span>
                      </span>
                      <span className="tabular">{formatMoney(a.unitPrice * a.quantity, a.currency)}</span>
                      <StatusBadge map={ADDON_STATUS} value={a.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <section className="mt-6" aria-labelledby="store-orders">
        <h2 id="store-orders" className="mb-3 font-display text-lg font-semibold">10 dernières commandes</h2>
        {orders.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Aucune commande" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Référence</TH>
                <TH>Client</TH>
                <TH>Statut</TH>
                <TH>Paiement</TH>
                <TH align="right">Total</TH>
                <TH align="right">Date</TH>
              </TR>
            </THead>
            <TBody>
              {orders.map((o) => (
                <TR key={o.id}>
                  <TD><span className="font-mono text-xs">{o.reference}</span>{o.outOfQuota && <Badge tone="warning" className="ml-2">Hors quota</Badge>}</TD>
                  <TD>{o.customerName}<span className="block text-xs text-ink-muted">{formatPhone(o.customerPhone)}</span></TD>
                  <TD><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></TD>
                  <TD><Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge></TD>
                  <TD align="right">{formatMoney(o.total, o.currency)}</TD>
                  <TD align="right"><span className="text-ink-muted">{formatDateTime(o.createdAt)}</span></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="mt-6" aria-labelledby="store-audit">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="store-audit" className="font-display text-lg font-semibold">Journal d'audit</h2>
          <Link href={`/admin/audit?storeId=${store.id}`} className="text-sm text-primary hover:underline">Tout voir</Link>
        </div>
        {auditLogs.length === 0 ? (
          <EmptyState icon={ScrollText} title="Aucune entrée" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Acteur</TH>
                <TH>Action</TH>
                <TH>Cible</TH>
                <TH>Métadonnées</TH>
              </TR>
            </THead>
            <TBody>
              {auditLogs.map((a) => (
                <TR key={a.id}>
                  <TD><span className="text-ink-muted">{formatDateTime(a.createdAt)}</span></TD>
                  <TD>{a.actor?.name ?? "Système"}</TD>
                  <TD><span className="font-mono text-xs">{a.action}</span></TD>
                  <TD><span className="font-mono text-xs text-ink-muted">{a.target ?? "-"}</span></TD>
                  <TD><JsonDetails value={a.metadata} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}
