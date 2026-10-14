import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText, Megaphone, Sparkles, Users, Smartphone, Store, HardDrive, Globe, LayoutTemplate, Wand2, Wallet, History, PackageCheck, AlertTriangle, type LucideIcon } from "lucide-react";
import { getStoreContext, effectivePlanId } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { ADD_ON_BILLING_LABEL, CREDIT_LABELS, PLANS, PLAN_ORDER, getAddOn, zoneForCurrency, ZONE_CURRENCY, type AddOn, type AddOnId, type CreditType, type PlanId, type PricingZone } from "@/config/plans";
import { getUsage } from "@/lib/commerce/quotas";
import { creditBalances, eligibleAddOns, LOW_CREDIT_THRESHOLD, PACK_VALIDITY_MONTHS } from "@/lib/addons/service";
import { syncStoreBilling } from "@/lib/billing/lifecycle";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { BillingTabs } from "../abonnement/billing-tabs";
import { BuyAddOn, CancelAddOnButton, ResumeAddOnButton } from "./options-client";

export const metadata: Metadata = { title: "Options et crédits" };

const ICONS: Record<AddOnId, LucideIcon> = {
  EXTRA_MEMBER: Users,
  EXTRA_WHATSAPP_NUMBER: Smartphone,
  EXTRA_STORE: Store,
  PACK_WA_UTILITY_500: MessageSquareText,
  PACK_WA_MARKETING_200: Megaphone,
  PACK_AI_1000: Sparkles,
  STORAGE_10GB: HardDrive,
  DOMAIN_NAME: Globe,
  SECTOR_TEMPLATE: LayoutTemplate,
  DONE_FOR_YOU: Wand2,
};
const CREDIT_ICON: Record<CreditType, LucideIcon> = { WA_UTILITY: MessageSquareText, WA_MARKETING: Megaphone, AI: Sparkles };
const PACK_FOR: Record<CreditType, AddOnId> = { WA_UTILITY: "PACK_WA_UTILITY_500", WA_MARKETING: "PACK_WA_MARKETING_200", AI: "PACK_AI_1000" };
const REASON_LABEL: Record<string, string> = {
  plan_monthly: "Dotation du plan",
  pack_purchase: "Achat de pack",
  usage: "Consommation",
  expiration: "Expiration",
  refund: "Remboursement",
  admin: "Ajustement Axi",
};
const GROUPS: { title: string; description: string; ids: AddOnId[] }[] = [
  { title: "Packs de crédits", description: `Rechargez votre portefeuille. Crédits valables ${PACK_VALIDITY_MONTHS} mois, utilisés après ceux inclus dans votre plan.`, ids: ["PACK_WA_UTILITY_500", "PACK_WA_MARKETING_200", "PACK_AI_1000"] },
  { title: "Capacité", description: "Ajoutez de la place à votre plan, sans changer de formule. Résiliable à tout moment, effectif en fin de période.", ids: ["EXTRA_MEMBER", "EXTRA_WHATSAPP_NUMBER", "EXTRA_STORE", "STORAGE_10GB"] },
  { title: "Services", description: "Nous le faisons pour vous. Notre équipe vous contacte après le paiement.", ids: ["DOMAIN_NAME", "SECTOR_TEMPLATE", "DONE_FOR_YOU"] },
];

function minPlanFor(a: AddOn): PlanId {
  return PLAN_ORDER.find((p) => a.plans.includes(p)) ?? "BUSINESS";
}

export default async function OptionsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "billing.manage");
  await syncStoreBilling(ctx.store.id).catch((e) => console.error("[billing] sync", e));
  const sub = await db.subscription.findUnique({ where: { storeId: ctx.store.id } });
  const planId = effectivePlanId(sub);
  const plan = PLANS[planId];
  const zone = (ctx.store.subscription?.zone as PricingZone | undefined) ?? zoneForCurrency(ctx.store.currency);
  const currency = ZONE_CURRENCY[zone];
  const eligible = new Set(eligibleAddOns(planId).map((a) => a.id));
  const now = new Date();

  const [balances, purchases, ledger, waUsed, aiUsed] = await Promise.all([
    creditBalances(ctx.store.id),
    db.addOnPurchase.findMany({ where: { storeId: ctx.store.id, OR: [{ status: "PENDING" }, { status: "ACTIVE" }, { status: "CANCELLED", endsAt: { gt: now } }] }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.creditLedger.findMany({ where: { storeId: ctx.store.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    getUsage(ctx.store.id, "whatsapp_messages"),
    getUsage(ctx.store.id, "ai_credits"),
  ]);
  const visiblePurchases = purchases.filter((p) => {
    const a = getAddOn(p.addOnId);
    // Les packs actifs vivent dans le portefeuille ; on garde ici les options récurrentes, services et commandes en attente.
    return p.status === "PENDING" || (a && a.billing !== "PACK");
  });
  const invoiceStatus = new Map((await db.invoice.findMany({ where: { id: { in: visiblePurchases.map((p) => p.invoiceId).filter(Boolean) as string[] } }, select: { id: true, status: true } })).map((i) => [i.id, i.status]));

  const included: Record<CreditType, { limit: number | null; used: number }> = {
    WA_UTILITY: { limit: plan.limits.whatsappMessagesPerMonth, used: waUsed },
    WA_MARKETING: { limit: plan.limits.whatsappMessagesPerMonth, used: waUsed },
    AI: { limit: plan.limits.aiCreditsPerMonth, used: aiUsed },
  };
  const alerts = balances.flatMap((b) => {
    const out: { tone: "warning" | "info"; text: string; packId: AddOnId }[] = [];
    const canBuy = eligible.has(PACK_FOR[b.type]);
    if (b.expiringSoon > 0 && b.nextExpiry) out.push({ tone: "info", text: `${b.expiringSoon.toLocaleString("fr-FR")} ${CREDIT_LABELS[b.type].toLowerCase()} expirent le ${formatDate(b.nextExpiry)}.`, packId: PACK_FOR[b.type] });
    if (canBuy && b.granted > 0 && b.balance < LOW_CREDIT_THRESHOLD) out.push({ tone: "warning", text: `Solde bas : ${b.balance.toLocaleString("fr-FR")} ${CREDIT_LABELS[b.type].toLowerCase()} restants.`, packId: PACK_FOR[b.type] });
    return out;
  });

  return (
    <>
      <PageHeader title="Options et crédits" description={`Complétez votre plan ${plan.name} à la carte : packs de messages et de crédits IA, membres, boutiques et services.`} />
      <BillingTabs storeId={ctx.store.id} />

      {/* ───── Portefeuille ───── */}
      <section className="mt-8" aria-labelledby="wallet-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="wallet-title" className="flex items-center gap-2 text-xl font-semibold tracking-[-0.025em] text-ink">
              <Wallet className="size-5 text-ink-muted" aria-hidden /> Portefeuille de crédits
            </h2>
            <p className="mt-1 text-sm text-ink-muted">Les crédits inclus dans votre plan sont consommés en premier, puis ceux des packs (les plus anciens d'abord).</p>
          </div>
        </div>

        {alerts.length > 0 && (
          <div className="mb-4 space-y-2">
            {alerts.map((a, i) => (
              <Alert key={i} tone={a.tone}>
                {a.text}{" "}
                {eligible.has(a.packId) && (
                  <Link href={`#${a.packId}`} className="font-semibold underline underline-offset-2">
                    Recharger
                  </Link>
                )}
              </Alert>
            ))}
          </div>
        )}

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {balances.map((b) => {
            const Icon = CREDIT_ICON[b.type];
            const inc = included[b.type];
            const packId = PACK_FOR[b.type];
            return (
              <li key={b.type} className="bezel">
                <div className="bezel-core flex h-full flex-col p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink-muted">{CREDIT_LABELS[b.type]}</p>
                    <Icon className="size-4 text-ink-faint" aria-hidden />
                  </div>
                  <p className="mt-3 text-[32px] font-semibold leading-none tracking-[-0.04em] text-ink tabular">{b.balance.toLocaleString("fr-FR")}</p>
                  <p className="mt-1.5 text-xs text-ink-muted">crédits de packs disponibles</p>
                  <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">Inclus ce mois</dt>
                      <dd className="font-medium text-ink tabular">{inc.limit == null ? "Illimité" : inc.limit === 0 ? "Non inclus" : `${Math.min(inc.used, inc.limit).toLocaleString("fr-FR")} / ${inc.limit.toLocaleString("fr-FR")}`}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">Prochaine expiration</dt>
                      <dd className="font-medium text-ink">{b.nextExpiry ? formatDate(b.nextExpiry) : "Aucune"}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto pt-4">
                    {eligible.has(packId) ? (
                      <ButtonLink href={`#${packId}`} variant="outline" size="sm" className="w-full">Acheter un pack</ButtonLink>
                    ) : (
                      <p className="text-xs text-ink-muted">Packs disponibles à partir du plan {PLANS[minPlanFor(getAddOn(packId)!)].name}.</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ───── Options actives ───── */}
      <section className="mt-12" aria-labelledby="active-title">
        <h2 id="active-title" className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-[-0.025em] text-ink">
          <PackageCheck className="size-5 text-ink-muted" aria-hidden /> Vos options
        </h2>
        {visiblePurchases.length === 0 ? (
          <EmptyState icon={PackageCheck} title="Aucune option pour l'instant" description="Les options achetées apparaissent ici, avec leur échéance et la possibilité de les résilier." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Option</TH>
                <TH align="right">Qté</TH>
                <TH>Statut</TH>
                <TH>Échéance</TH>
                <TH align="right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {visiblePurchases.map((p) => {
                const a = getAddOn(p.addOnId);
                const recurring = a?.billing === "MONTHLY" || a?.billing === "YEARLY";
                const future = p.startsAt > now;
                const invStatus = p.invoiceId ? invoiceStatus.get(p.invoiceId) : undefined;
                return (
                  <TR key={p.id}>
                    <TD>
                      <p className="font-medium text-ink">{a?.name ?? p.addOnId}</p>
                      <p className="text-xs text-ink-muted tabular">{formatMoney(p.unitPrice * p.quantity, p.currency)} {a ? ADD_ON_BILLING_LABEL[a.billing] : ""}</p>
                    </TD>
                    <TD align="right" className="tabular">{p.quantity}</TD>
                    <TD>
                      {p.status === "PENDING" ? (
                        <Badge tone="sun" dot>{future ? "Renouvellement à payer" : "En attente de paiement"}</Badge>
                      ) : p.status === "CANCELLED" ? (
                        <Badge tone="warning" dot>Résiliée</Badge>
                      ) : (
                        <Badge tone="success" dot>Active</Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {p.status === "PENDING" ? (future ? `Démarre le ${formatDate(p.startsAt)}` : "Dès le paiement") : p.endsAt ? `${p.status === "CANCELLED" ? "Fin le" : recurring ? "Renouvellement le" : "Jusqu'au"} ${formatDate(p.endsAt)}` : "Sans échéance"}
                    </TD>
                    <TD align="right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {p.status === "PENDING" && p.invoiceId && invStatus === "OPEN" && (
                          <ButtonLink href={`/app/${ctx.store.id}/abonnement/factures/${p.invoiceId}`} size="sm" variant="accent">Payer</ButtonLink>
                        )}
                        {(p.status === "PENDING" || (p.status === "ACTIVE" && recurring)) && <CancelAddOnButton storeId={ctx.store.id} purchaseId={p.id} pending={p.status === "PENDING"} endsAt={p.endsAt?.toISOString() ?? null} />}
                        {p.status === "CANCELLED" && recurring && <ResumeAddOnButton storeId={ctx.store.id} purchaseId={p.id} />}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      {/* ───── Catalogue ───── */}
      <section className="mt-12" aria-labelledby="catalog-title">
        <h2 id="catalog-title" className="text-xl font-semibold tracking-[-0.025em] text-ink">Catalogue des options</h2>
        <p className="mt-1 text-sm text-ink-muted">Prix {zone === "AFRICA" ? "en FCFA" : "en euros"}, hors commission : Axi ne prélève rien sur vos ventes.</p>

        <div className="mt-6 space-y-10">
          {GROUPS.map((g) => {
            const items = g.ids.map((id) => getAddOn(id)!).filter(Boolean);
            return (
              <div key={g.title}>
                <h3 className="text-[15px] font-semibold text-ink">{g.title}</h3>
                <p className="mt-0.5 max-w-[70ch] text-sm text-ink-muted">{g.description}</p>
                <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((a) => {
                    const Icon = ICONS[a.id];
                    const ok = eligible.has(a.id);
                    const price = a.price[zone];
                    return (
                      <li key={a.id} id={a.id} className="scroll-mt-24">
                        <Card className={ok ? "flex h-full flex-col p-5 target:ring-2 target:ring-primary" : "flex h-full flex-col bg-surface-2/60 p-5 shadow-none"}>
                          <div className="flex items-start gap-3">
                            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-ink ring-1 ring-inset ring-line">
                              <Icon className="size-[18px]" aria-hidden />
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium text-ink">{a.name}</p>
                              <p className="mt-0.5 text-sm text-ink-muted">{a.description}</p>
                            </div>
                          </div>
                          <div className="mt-5 flex flex-1 flex-wrap items-end justify-between gap-3">
                            <p className="text-ink">
                              <span className="text-xl font-semibold tracking-[-0.03em] tabular">{formatMoney(price, currency)}</span>{" "}
                              <span className="text-sm text-ink-muted">{ADD_ON_BILLING_LABEL[a.billing]}</span>
                            </p>
                            {ok ? (
                              <BuyAddOn storeId={ctx.store.id} addOnId={a.id} unitPrice={price} currency={currency} cadence={ADD_ON_BILLING_LABEL[a.billing]} allowQuantity={a.billing === "PACK" || a.id === "EXTRA_MEMBER" || a.id === "EXTRA_STORE" || a.id === "STORAGE_10GB" || a.id === "EXTRA_WHATSAPP_NUMBER"} />
                            ) : (
                              <Link href={`/app/${ctx.store.id}/abonnement#plans`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
                                Avec le plan {PLANS[minPlanFor(a)].name}
                              </Link>
                            )}
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* ───── Historique ───── */}
      <section className="mt-12" aria-labelledby="history-title">
        <h2 id="history-title" className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-[-0.025em] text-ink">
          <History className="size-5 text-ink-muted" aria-hidden /> Mouvements de crédits
        </h2>
        {ledger.length === 0 ? (
          <EmptyState icon={History} title="Aucun mouvement" description="Achats de packs, consommation et expirations apparaîtront ici." />
        ) : (
          <Card>
            <CardHeader title="30 derniers mouvements" description="Le grand livre est en ajout seul : chaque crédit ajouté ou consommé laisse une trace." />
            <CardBody className="p-0 sm:p-0">
              <Table className="rounded-none shadow-none ring-0">
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Motif</TH>
                    <TH align="right">Mouvement</TH>
                    <TH>Expiration</TH>
                  </tr>
                </THead>
                <TBody>
                  {ledger.map((l) => (
                    <TR key={l.id}>
                      <TD className="whitespace-nowrap text-ink-muted">{formatDate(l.createdAt)}</TD>
                      <TD>{CREDIT_LABELS[l.type as CreditType]}</TD>
                      <TD>{REASON_LABEL[l.reason] ?? l.reason}</TD>
                      <TD align="right" className={l.delta >= 0 ? "font-mono text-[13px] font-medium text-primary tabular" : "font-mono text-[13px] text-ink tabular"}>
                        {l.delta >= 0 ? "+" : "−"}
                        {Math.abs(l.delta).toLocaleString("fr-FR")}
                      </TD>
                      <TD className="whitespace-nowrap text-ink-muted">
                        {l.expiresAt ? (
                          l.expiresAt < now ? (
                            <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3.5" aria-hidden /> Expiré le {formatDate(l.expiresAt)}</span>
                          ) : (
                            formatDate(l.expiresAt)
                          )
                        ) : (
                          "Aucune"
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}
      </section>
    </>
  );
}

