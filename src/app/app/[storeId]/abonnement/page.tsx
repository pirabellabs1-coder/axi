import type { Metadata } from "next";
import Link from "next/link";
import { Receipt, CalendarClock, ArrowUpRight } from "lucide-react";
import { getStoreContext, effectivePlanId } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS, PLAN_ORDER, PAST_DUE_GRACE_DAYS, ZONE_LABEL, ZONE_CURRENCY, type Interval, type PlanId } from "@/config/plans";
import { getUsage } from "@/lib/commerce/quotas";
import { effectiveLimits } from "@/lib/addons/service";
import { syncStoreBilling } from "@/lib/billing/lifecycle";
import { addOnInvoiceIds, getScheduledChange, nonDebtInvoiceIds, pendingPlanChange, quotePlanChange } from "@/lib/billing/service";
import { billingZone, graceEndsAt } from "@/lib/billing/rules";
import { getEffectivePlanPriceFor } from "@/lib/pricing/catalog";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader, Bezel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PlanComparison, CancelControls, type QuoteDTO } from "./plans-client";
import { BillingTabs } from "./billing-tabs";
import { INV_LABEL, INV_TONE, UsageMeter } from "./billing-ui";

export const metadata: Metadata = { title: "Abonnement" };

const DAY = 86_400_000;

export default async function SubscriptionPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx0 = await getStoreContext(storeId, "billing.manage");
  // Met à jour échéances, impayés et changements programmés avant affichage (en attendant le cron).
  await syncStoreBilling(ctx0.store.id).catch((e) => console.error("[billing] sync", e));
  const store = await db.store.findUniqueOrThrow({ where: { id: ctx0.store.id }, include: { subscription: true } });
  const sub = store.subscription;
  const planId = effectivePlanId(sub);
  const plan = PLANS[planId];
  // Zone figée sur l'abonnement (changée uniquement par l'admin), devise boutique en repli.
  const zone = billingZone(sub, store.currency);
  const currency = ZONE_CURRENCY[zone];
  const now = new Date();

  const [limits, ordersUsed, productsCount, membersCount, waUsed, aiUsed, invoicesRaw, scheduled, automationsActive, pending] = await Promise.all([
    effectiveLimits(store.id, planId),
    getUsage(store.id, "orders"),
    db.product.count({ where: { storeId: store.id, status: "ACTIVE" } }),
    db.membership.count({ where: { storeId: store.id, role: { not: "SUPPORT" } } }),
    getUsage(store.id, "whatsapp_messages"),
    getUsage(store.id, "ai_credits"),
    sub ? db.invoice.findMany({ where: { subscriptionId: sub.id }, orderBy: { createdAt: "desc" }, take: 36 }) : Promise.resolve([]),
    getScheduledChange(sub),
    db.automation.count({ where: { storeId: store.id, active: true } }),
    sub ? pendingPlanChange(sub.id) : Promise.resolve(null),
  ]);
  const [addonIds, notDebt] = await Promise.all([addOnInvoiceIds(invoicesRaw.map((i) => i.id)), nonDebtInvoiceIds(invoicesRaw.map((i) => i.id))]);
  const invoices = invoicesRaw.filter((i) => i.status !== "VOID" || i.paidAt);

  const combos = PLAN_ORDER.flatMap((p) => (["MONTHLY", "YEARLY"] as Interval[]).map((i) => [p, i] as const));
  const quotes: QuoteDTO[] = (await Promise.all(combos.map(([p, i]) => quotePlanChange(store.id, sub, zone, p, i, now)))).map((q) => ({
    ...q,
    effectiveAt: q.effectiveAt ? q.effectiveAt.toISOString() : null,
  }));
  // Prix effectifs (surcharges /admin/tarifs comprises), calculés côté serveur pour les cartes client.
  const cards = await Promise.all(
    PLAN_ORDER.map(async (id) => {
      const [m, y] = await Promise.all([getEffectivePlanPriceFor(id, zone, "MONTHLY"), getEffectivePlanPriceFor(id, zone, "YEARLY")]);
      return { id, monthly: m.amount, yearly: y.amount, yearlyPerMonth: y.perMonth };
    }),
  );

  const isTrial = sub?.status === "TRIALING" && !!sub.trialEndsAt && sub.trialEndsAt > now;
  const trialDaysLeft = isTrial ? Math.max(0, Math.ceil((sub!.trialEndsAt!.getTime() - now.getTime()) / DAY)) : null;
  const pastDue = sub?.status === "PAST_DUE";
  const suspended = sub?.status === "SUSPENDED";
  // Dette d'abonnement = factures de plan hors options et hors demande de changement en attente.
  const openPlanInvoices = invoices.filter((i) => i.status === "OPEN" && !notDebt.has(i.id)).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const openInvoice = openPlanInvoices[0] ?? invoices.find((i) => i.status === "OPEN" && i.id !== pending?.id);
  const graceEnd = pastDue && openPlanInvoices[0] ? graceEndsAt(openPlanInvoices[0]) : null;
  const pendingPlan = pending ? (pending.planId as PlanId) : null;
  const interval = (sub?.interval ?? "MONTHLY") as Interval;
  const currentPrice = await getEffectivePlanPriceFor((sub?.planId as PlanId) ?? planId, zone, interval);

  const statusBadge = suspended ? (
    <Badge tone="danger" dot>Suspendu</Badge>
  ) : isTrial ? (
    <Badge tone="sun" dot>Essai, {trialDaysLeft} j restants</Badge>
  ) : pastDue ? (
    <Badge tone="danger" dot>Paiement en retard</Badge>
  ) : scheduled ? (
    <Badge tone="warning" dot>Changement programmé</Badge>
  ) : (
    <Badge tone="success" dot>Actif</Badge>
  );

  return (
    <>
      <PageHeader title="Abonnement" description="Votre plan, votre consommation du mois et vos factures. Aucune commission sur vos ventes." />
      <BillingTabs storeId={store.id} />

      <div className="mt-6 space-y-3">
        {suspended && (
          <Alert tone="danger" title="Fonctions payantes suspendues">
            La facture {openInvoice?.number ?? ""} n'a pas été réglée dans le délai de grâce de {PAST_DUE_GRACE_DAYS} jours. Votre boutique fonctionne sur le plan Gratuit, toutes vos données sont conservées.{" "}
            {openInvoice && <Link href={`/app/${store.id}/abonnement/factures/${openInvoice.id}`} className="font-semibold underline underline-offset-2">Régler la facture pour tout réactiver</Link>}
          </Alert>
        )}
        {pastDue && (
          <Alert tone="danger" title="Paiement en retard">
            Vos fonctions restent actives jusqu'au {graceEnd ? formatDate(graceEnd) : `${PAST_DUE_GRACE_DAYS}e jour après l'échéance`}, puis elles seront suspendues (données conservées).{" "}
            {openInvoice && <Link href={`/app/${store.id}/abonnement/factures/${openInvoice.id}`} className="font-semibold underline underline-offset-2">Payer la facture {openInvoice.number}</Link>}
          </Alert>
        )}
        {isTrial && (
          <Alert tone="info" title={`Essai ${PLANS[sub!.planId as PlanId].name} : ${trialDaysLeft} jour${trialDaysLeft === 1 ? "" : "s"} restant${trialDaysLeft === 1 ? "" : "s"}`}>
            À la fin de l'essai, la boutique passe au plan Gratuit sans perte de données (produits au-delà de 15 mis en brouillon). Choisissez un plan pour continuer sans interruption.
          </Alert>
        )}
        {pending && pendingPlan && (
          <Alert tone="warning" title={`Plan ${PLANS[pendingPlan].name} en attente de paiement`}>
            Facture {pending.number} de {formatMoney(pending.amount, pending.currency)}, à régler avant le {formatDate(pending.dueAt)}. Votre plan actuel ({isTrial ? `essai ${PLANS[sub!.planId as PlanId].name}` : plan.name}) reste en place jusqu'à la confirmation du paiement ; le plan {PLANS[pendingPlan].name} démarre à ce moment-là.{" "}
            <Link href={`/app/${store.id}/abonnement/factures/${pending.id}`} className="font-semibold underline underline-offset-2">Payer la facture {pending.number}</Link>
          </Alert>
        )}
        {!pastDue && !suspended && openInvoice && (
          <Alert tone="warning" title={`Facture ${openInvoice.number} à régler`}>
            {formatMoney(openInvoice.amount, openInvoice.currency)}, échéance le {formatDate(openInvoice.dueAt)}.{" "}
            <Link href={`/app/${store.id}/abonnement/factures/${openInvoice.id}`} className="font-semibold underline underline-offset-2">Payer maintenant</Link>
          </Alert>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Bezel as="section" coreClassName="flex flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-ink-muted">Plan actuel</h2>
              <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.04em] text-ink">{plan.name}</p>
            </div>
            {statusBadge}
          </div>
          <p className="mt-2 text-sm text-ink-muted">{plan.tagline}</p>

          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 text-sm">
            <div>
              <dt className="text-ink-muted">Prix</dt>
              <dd className="mt-0.5 font-medium text-ink tabular">
                {isTrial ? "Offert pendant l'essai" : currentPrice.amount ? `${formatMoney(currentPrice.amount, currency)} / ${interval === "YEARLY" ? "an" : "mois"}` : "Gratuit"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Facturation</dt>
              <dd className="mt-0.5 font-medium text-ink">{planId === "FREE" ? "Aucune" : interval === "YEARLY" ? "Annuelle" : "Mensuelle"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{isTrial ? "Fin de l'essai" : "Prochaine échéance"}</dt>
              <dd className="mt-0.5 font-medium text-ink">{isTrial ? formatDate(sub!.trialEndsAt!) : sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "Aucune"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Zone tarifaire</dt>
              <dd className="mt-0.5 font-medium text-ink">{ZONE_LABEL[zone]}</dd>
            </div>
          </dl>

          {scheduled && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 ring-1 ring-inset ring-line">
              <p className="flex items-start gap-2 text-sm text-ink">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                <span>
                  Passage au plan <strong>{PLANS[scheduled.to].name}</strong> le {scheduled.effectiveAt ? formatDate(scheduled.effectiveAt) : "prochain renouvellement"}.
                </span>
              </p>
              <CancelControls storeId={store.id} cancelAtPeriodEnd />
            </div>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
            <ButtonLink href="#plans" variant="primary" size="sm">Changer de plan</ButtonLink>
            <ButtonLink href={`/app/${store.id}/options`} variant="outline" size="sm">Options et crédits</ButtonLink>
            {sub && sub.planId !== "FREE" && !isTrial && !scheduled && <CancelControls storeId={store.id} cancelAtPeriodEnd={false} />}
          </div>
        </Bezel>

        <Card as="section" aria-labelledby="usage-title">
          <CardHeader
            title={<span id="usage-title">Utilisation ce mois-ci</span>}
            description={`Remise à zéro le 1er du mois. ${planId === "FREE" ? "Au-delà de 20 commandes, les nouvelles commandes sont marquées « hors quota »." : ""}`}
            action={<Link href="#plans" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">Augmenter <ArrowUpRight className="size-3.5" aria-hidden /></Link>}
          />
          <CardBody className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <UsageMeter label="Commandes" used={ordersUsed} limit={limits.ordersPerMonth} />
            <UsageMeter label="Produits en ligne" used={productsCount} limit={limits.products} />
            <UsageMeter label="Membres d'équipe" used={membersCount} limit={limits.members} hint={limits.extraMembers ? `Dont ${limits.extraMembers} en option` : undefined} />
            <UsageMeter label="Messages WhatsApp inclus" used={waUsed} limit={limits.whatsappMessagesPerMonth} hint="Packs de messages : Options et crédits" />
            <UsageMeter label="Crédits IA inclus" used={aiUsed} limit={limits.aiCreditsPerMonth} />
            <UsageMeter label="Automatisations" used={automationsActive} limit={limits.automations} />
          </CardBody>
        </Card>
      </div>

      <section id="plans" className="mt-12 scroll-mt-24" aria-labelledby="plans-title">
        <h2 id="plans-title" className="mb-1 text-xl font-semibold tracking-[-0.025em] text-ink">Comparer les plans</h2>
        <p className="mb-5 text-sm text-ink-muted">Montée en gamme dès la confirmation du paiement, avec le temps restant déduit. Descente appliquée à la fin de la période payée.</p>
        <PlanComparison
          storeId={store.id}
          plans={cards}
          quotes={quotes}
          currentPlan={(sub?.planId as PlanId) ?? "FREE"}
          currentInterval={interval}
          isTrial={isTrial}
          scheduledTo={scheduled?.to ?? null}
          pendingTo={pendingPlan}
          currency={currency}
          zoneLabel={zone === "AFRICA" ? "en FCFA (zone Afrique francophone)" : "en euros (zone Monde)"}
        />
      </section>

      <section className="mt-12" aria-labelledby="inv-title">
        <h2 id="inv-title" className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-[-0.025em] text-ink">
          <Receipt className="size-5 text-ink-muted" aria-hidden /> Factures
        </h2>
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="Aucune facture" description="Les plans payants et les options génèrent une facture numérotée, imprimable en PDF." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Numéro</TH>
                <TH>Objet</TH>
                <TH>Période</TH>
                <TH align="right">Montant</TH>
                <TH>Statut</TH>
                <TH align="right">Échéance</TH>
              </tr>
            </THead>
            <TBody>
              {invoices.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Link href={`/app/${store.id}/abonnement/factures/${i.id}`} className="inline-flex min-h-11 items-center font-mono text-[13px] font-medium text-primary hover:underline">
                      {i.number}
                    </Link>
                  </TD>
                  <TD>{addonIds.has(i.id) ? "Option" : `Plan ${PLANS[i.planId as PlanId].name}`}</TD>
                  <TD className="whitespace-nowrap text-ink-muted">
                    {i.periodEnd.getTime() - i.periodStart.getTime() < DAY ? formatDate(i.periodStart) : `${formatDate(i.periodStart)} au ${formatDate(i.periodEnd)}`}
                  </TD>
                  <TD align="right" className="font-mono text-[13px] tabular">{formatMoney(i.amount, i.currency)}</TD>
                  <TD>
                    <Badge tone={INV_TONE[i.status]} dot>{INV_LABEL[i.status]}</Badge>
                  </TD>
                  <TD align="right" className="whitespace-nowrap text-ink-muted">{i.paidAt ? `Payée le ${formatDate(i.paidAt)}` : formatDate(i.dueAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}
