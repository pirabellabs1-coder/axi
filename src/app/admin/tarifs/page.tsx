import type { Metadata } from "next";
import { Check, History, Minus, Lock } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { PLANS, PLAN_ORDER, ADD_ONS, ADD_ON_BILLING_LABEL, CREDIT_LABELS, ZONE_LABEL, ZONE_CURRENCY, TRIAL_DAYS, TRIAL_PLAN, YEARLY_MONTHS_PAID, PAST_DUE_GRACE_DAYS, RENEWAL_LINK_DAYS_BEFORE, SELF_SERVE_PLANS, getAddOn, type PlanId, type PlanLimits, type PricingZone } from "@/config/plans";
import { loadActiveOverrides, effectiveFromRows } from "@/lib/pricing/catalog";
import { priceForInterval } from "@/lib/pricing/rules";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/app/admin-bits";
import { PriceCell } from "@/components/admin/price-cell";

export const metadata: Metadata = { title: "Catalogue des prix" };

const ZONES: PricingZone[] = ["WORLD", "AFRICA"];

const LIMIT_ROWS: { key: keyof PlanLimits; label: string }[] = [
  { key: "stores", label: "Boutiques" },
  { key: "products", label: "Produits" },
  { key: "ordersPerMonth", label: "Commandes par mois" },
  { key: "members", label: "Membres" },
  { key: "whatsappMessagesPerMonth", label: "Messages WhatsApp inclus" },
  { key: "aiCreditsPerMonth", label: "Crédits IA inclus" },
  { key: "automations", label: "Automatisations" },
];

function itemName(itemType: string, itemId: string) {
  return itemType === "plan" ? `Plan ${PLANS[itemId as PlanId]?.name ?? itemId}` : (getAddOn(itemId)?.name ?? itemId);
}

export default async function AdminPricing() {
  const ctx = await getAdminContext();
  const canEdit = ctx.can("pricing.manage");
  const [subs, addOns, overrides, history] = await Promise.all([
    db.subscription.groupBy({ by: ["planId", "zone"], where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, _count: true }),
    db.addOnPurchase.groupBy({ by: ["addOnId"], where: { status: "ACTIVE" }, _sum: { quantity: true } }),
    loadActiveOverrides(),
    db.priceOverride.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const actorIds = [...new Set(history.map((h) => h.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const subCount = (planId: string, zone?: string) => subs.filter((s) => s.planId === planId && (!zone || s.zone === zone)).reduce((n, s) => n + s._count, 0);
  const addOnCount = (id: string) => addOns.find((a) => a.addOnId === id)?._sum.quantity ?? 0;
  const overriddenCount = overrides.length;

  return (
    <>
      <PageHeader
        title="Catalogue des prix"
        description="Prix des plans et des options par zone, modifiables sans déploiement. Un nouveau prix s'applique aux prochaines factures (souscriptions, montées en gamme, renouvellements)."
        actions={overriddenCount > 0 ? <Badge tone="accent">{overriddenCount} prix modifié{overriddenCount > 1 ? "s" : ""}</Badge> : <Badge tone="neutral">Prix par défaut</Badge>}
      />

      {!canEdit && (
        <Alert tone="info" className="mb-6" title="Lecture seule">
          <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden /> Seuls les rôles Finance et Super-administrateur peuvent modifier les prix.</span>
        </Alert>
      )}

      <section aria-labelledby="plans" className="mb-8">
        <SectionTitle id="plans" title="Plans" description={`Prix mensuels. Annuel : ${YEARLY_MONTHS_PAID} mois payés pour 12. Essai ${PLANS[TRIAL_PLAN].name} de ${TRIAL_DAYS} jours. 0 % de commission.`} />
        <Table minWidth={820}>
          <THead>
            <TR>
              <TH>Plan</TH>
              <TH align="right">Monde (EUR)</TH>
              <TH align="right">Afrique (FCFA)</TH>
              <TH>Vente</TH>
              <TH align="right">Abonnés</TH>
            </TR>
          </THead>
          <TBody>
            {PLAN_ORDER.map((id) => {
              const p = PLANS[id];
              return (
                <TR key={id}>
                  <TD>
                    <span className="inline-flex items-center gap-2 font-medium">
                      {p.name}
                      {p.highlight && <Badge tone="primary">Recommandé</Badge>}
                    </span>
                    <span className="block text-xs text-ink-muted">{p.audience}</span>
                  </TD>
                  {ZONES.map((z) => {
                    const e = effectiveFromRows(overrides, "plan", id, z);
                    const y = priceForInterval(e.amount, z, "YEARLY");
                    return (
                      <TD key={z} align="right">
                        <PriceCell
                          itemType="plan"
                          itemId={id}
                          itemName={p.name}
                          zone={z}
                          currency={ZONE_CURRENCY[z]}
                          amount={e.amount}
                          defaultAmount={e.defaultAmount}
                          overridden={e.overridden}
                          canEdit={canEdit && id !== "FREE"}
                          fromPrice={p.fromPrice}
                          sub={y.amount ? `${formatMoney(y.amount, y.currency)} par an` : undefined}
                        />
                      </TD>
                    );
                  })}
                  <TD>{SELF_SERVE_PLANS.includes(id) ? <Badge tone="success">Libre-service</Badge> : <Badge tone="neutral">Sur devis</Badge>}</TD>
                  <TD align="right">
                    {subCount(id)}
                    <span className="block text-xs text-ink-muted">{subCount(id, "WORLD")} Monde, {subCount(id, "AFRICA")} Afrique</span>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </section>

      <section aria-labelledby="addons" className="mb-8">
        <SectionTitle id="addons" title="Options payantes" description="Crédits des packs valables 12 mois. Les options mensuelles et annuelles se renouvellent par facture." />
        <Table minWidth={900}>
          <THead>
            <TR>
              <TH>Option</TH>
              <TH>Facturation</TH>
              <TH align="right">Monde (EUR)</TH>
              <TH align="right">Afrique (FCFA)</TH>
              <TH>Plans éligibles</TH>
              <TH align="right">Actives</TH>
            </TR>
          </THead>
          <TBody>
            {ADD_ONS.map((a) => (
              <TR key={a.id}>
                <TD>
                  <span className="font-medium">{a.name}</span>
                  <span className="block max-w-[320px] text-xs text-ink-muted">{a.credits ? `${a.credits.amount.toLocaleString("fr-FR")} ${CREDIT_LABELS[a.credits.type].toLowerCase()}` : a.description}</span>
                </TD>
                <TD>{ADD_ON_BILLING_LABEL[a.billing]}</TD>
                {ZONES.map((z) => {
                  const e = effectiveFromRows(overrides, "addon", a.id, z);
                  return (
                    <TD key={z} align="right">
                      <PriceCell itemType="addon" itemId={a.id} itemName={a.name} zone={z} currency={ZONE_CURRENCY[z]} amount={e.amount} defaultAmount={e.defaultAmount} overridden={e.overridden} canEdit={canEdit} />
                    </TD>
                  );
                })}
                <TD>
                  <span className="flex flex-wrap gap-1">
                    {a.plans.map((p) => (
                      <Badge key={p} tone="neutral">{PLANS[p].name}</Badge>
                    ))}
                  </span>
                </TD>
                <TD align="right">{addOnCount(a.id)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>

      <section aria-labelledby="history" className="mb-8">
        <SectionTitle id="history" title="Historique des changements" description="30 derniers changements, du plus récent au plus ancien. Chaque changement est aussi journalisé (admin.price_changed)." />
        {history.length === 0 ? (
          <EmptyState icon={History} title="Aucun changement" description="Tous les prix sont ceux du catalogue par défaut (src/config/plans.ts)." />
        ) : (
          <Table minWidth={720}>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Article</TH>
                <TH>Zone</TH>
                <TH align="right">Prix</TH>
                <TH>État</TH>
                <TH>Par</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((h) => (
                <TR key={h.id}>
                  <TD><span className="whitespace-nowrap text-ink-muted">{formatDateTime(h.createdAt)}</span></TD>
                  <TD>
                    <span className="font-medium">{itemName(h.itemType, h.itemId)}</span>
                    {h.note && <span className="block max-w-[280px] text-xs text-ink-muted">{h.note}</span>}
                  </TD>
                  <TD>{h.zone === "AFRICA" ? "Afrique" : "Monde"}</TD>
                  <TD align="right">{formatMoney(h.amount, ZONE_CURRENCY[h.zone as PricingZone] ?? "EUR")}</TD>
                  <TD>{h.active ? <Badge tone="success" dot>En vigueur</Badge> : h.note === "Retour au prix par défaut" ? <Badge tone="info">Retour au défaut</Badge> : <Badge tone="neutral">Remplacé</Badge>}</TD>
                  <TD><span className="text-ink-muted">{actors.find((a) => a.id === h.actorId)?.name ?? "-"}</span></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card as="section" aria-labelledby="limits">
          <CardHeader title={<span id="limits">Limites par plan</span>} description="Valeurs appliquées par le contrôle d'accès (PlanGate, quotas). Versionnées avec le code." />
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-y border-line bg-surface-2/50 text-left text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="h-10 px-5 font-medium">Limite</th>
                  {PLAN_ORDER.map((id) => (
                    <th key={id} scope="col" className="h-10 px-3 text-right font-medium">{PLANS[id].name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {LIMIT_ROWS.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="h-11 px-5 text-left font-normal text-ink-muted">{r.label}</th>
                    {PLAN_ORDER.map((id) => {
                      const v = PLANS[id].limits[r.key];
                      return (
                        <td key={id} className="tabular h-11 px-3 text-right text-ink">
                          {v == null ? "Illimité" : v === 0 ? <Minus className="ml-auto size-4 text-ink-faint" aria-label="Non inclus" /> : v.toLocaleString("fr-FR")}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card as="section" aria-labelledby="zones">
          <CardHeader title={<span id="zones">Zones tarifaires et règles</span>} />
          <ul className="space-y-3 px-5 pb-5 pt-3 text-sm sm:px-6">
            {ZONES.map((z) => (
              <li key={z} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-medium text-ink">{ZONE_LABEL[z]}</span>
                  <span className="block text-ink-muted">{z === "AFRICA" ? "Boutiques en XOF ou XAF. Montants entiers, sans décimales." : "Toutes les autres devises. Montants en centimes d'euro."}</span>
                </span>
              </li>
            ))}
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="text-ink-muted">Facture de renouvellement émise {RENEWAL_LINK_DAYS_BEFORE} jours avant l&apos;échéance, impayé suspendu après {PAST_DUE_GRACE_DAYS} jours de grâce.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="text-ink-muted">Les pages publiques /tarifs affichent encore le catalogue par défaut : un prix modifié ici s&apos;applique aux factures et aux devis de l&apos;espace marchand.</span>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
