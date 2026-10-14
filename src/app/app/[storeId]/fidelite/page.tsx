import type { Metadata } from "next";
import Link from "next/link";
import { Award, Gift, Coins, Users, Truck, Undo2, BadgeCheck } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { parseLoyaltyConfig, loyaltyBaseLabel, pointsForAmount } from "@/lib/loyalty/config";
import { PageHeader, EmptyState, Stat, Money, Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { formatMoney } from "@/lib/money";
import { relativeTime, cn } from "@/lib/utils";
import { LoyaltyConfigForm, AdjustPointsButton } from "./loyalty-forms";

export const metadata: Metadata = { title: "Fidélité" };

const REASON_LABELS: Record<string, string> = {
  order: "Commande livrée",
  reward: "Récompense utilisée",
  adjustment: "Ajustement manuel",
  refund: "Retour ou remboursement",
  expiration: "Expiration",
  redeem: "Points utilisés",
  redeem_reversal: "Points restitués",
  return: "Retour d'articles",
};

export default async function LoyaltyPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "customers.view");
  const store = ctx.store;

  if (!PLANS[ctx.planId].features.loyalty) {
    return (
      <>
        <PageHeader title="Fidélité" description="Récompensez vos clients qui reviennent." />
        <PlanGate storeId={store.id} feature="loyalty" description="Vos clients gagnent des points à chaque commande livrée et débloquent une remise. Les retours retirent les points automatiquement, et chaque ajustement est tracé." />
      </>
    );
  }

  const config = parseLoyaltyConfig(store.loyaltyConfig);
  const baseLabel = loyaltyBaseLabel(store.currency);
  const [leaders, moves, totals, members] = await Promise.all([
    db.customer.findMany({
      where: { storeId: store.id, loyaltyPoints: { gt: 0 } },
      orderBy: [{ loyaltyPoints: "desc" }, { totalSpent: "desc" }],
      take: 50,
      select: { id: true, name: true, loyaltyPoints: true, ordersCount: true, totalSpent: true, lastOrderAt: true },
    }),
    db.loyaltyLedger.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 15, include: { customer: { select: { id: true, name: true } } } }),
    db.customer.aggregate({ where: { storeId: store.id, loyaltyPoints: { gt: 0 } }, _sum: { loyaltyPoints: true }, _count: { _all: true } }),
    db.customer.findMany({ where: { storeId: store.id }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, loyaltyPoints: true } }),
  ]);
  const totalPoints = totals._sum.loyaltyPoints ?? 0;
  const eligible = leaders.filter((c) => c.loyaltyPoints >= config.rewardPoints).length;
  const canAdjust = ctx.can("customers.manage");
  const customerOptions = members.map((m) => ({ id: m.id, name: m.name, points: m.loyaltyPoints }));
  const exampleSpend = store.currency === "XOF" || store.currency === "XAF" ? 25000 : 5000;
  const examplePoints = pointsForAmount(exampleSpend, store.currency, { ...config, enabled: true });

  return (
    <>
      <PageHeader
        title="Fidélité"
        description="Des points à chaque commande livrée, une récompense au bout."
        actions={
          <>
            <Badge tone={config.enabled ? "success" : "neutral"} dot>
              {config.enabled ? "Actif" : "Désactivé"}
            </Badge>
            {canAdjust && customerOptions.length > 0 && <AdjustPointsButton storeId={store.id} customers={customerOptions} rewardPoints={config.rewardPoints} />}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Clients avec des points" value={totals._count._all} icon={Users} />
        <Stat label="Points en circulation" value={totalPoints.toLocaleString("fr-FR")} icon={Coins} />
        <Stat label="Récompenses débloquées" value={eligible} icon={Gift} hint={`Clients à ${config.rewardPoints} points ou plus`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Configuration" description="Les changements s'appliquent aux prochaines commandes livrées." />
          <CardBody>
            <LoyaltyConfigForm storeId={store.id} config={config} currency={store.currency} baseLabel={baseLabel} canEdit={ctx.can("store.settings")} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Règles du programme" />
          <CardBody>
            <ul className="space-y-4 text-sm">
              <li className="flex gap-3">
                <Truck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="text-ink-muted">
                  <span className="font-medium text-ink">Gain à la livraison.</span> {config.pointsPer1000} point{config.pointsPer1000 > 1 ? "s" : ""} par tranche de {baseLabel}, crédités quand la commande passe à « Livrée ».
                  {store.currency === "XOF" || store.currency === "XAF" ? ` Exemple : une commande de ${formatMoney(exampleSpend, store.currency)} rapporte ${examplePoints} points.` : ""}
                </span>
              </li>
              <li className="flex gap-3">
                <Gift className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="text-ink-muted">
                  <span className="font-medium text-ink">Récompense.</span> À {config.rewardPoints} points, le client obtient <Money amount={config.rewardValue} currency={store.currency} className="font-medium text-ink" /> de remise, que vous enregistrez avec « Récompense utilisée ».
                </span>
              </li>
              <li className="flex gap-3">
                <Undo2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="text-ink-muted">
                  <span className="font-medium text-ink">Retour ou remboursement.</span> Les points gagnés sur la commande sont retirés automatiquement.
                </span>
              </li>
              <li className="flex gap-3">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="text-ink-muted">
                  <span className="font-medium text-ink">Traçabilité.</span> Chaque mouvement est inscrit au journal ; les ajustements manuels exigent un motif et sont audités.
                </span>
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>

      <section aria-labelledby="leaders-title" className="mb-6">
        <h2 id="leaders-title" className="mb-3 text-lg font-semibold text-ink">
          Classement des clients
        </h2>
        {leaders.length === 0 ? (
          <EmptyState
            icon={Award}
            title="Aucun point distribué pour l'instant"
            description={config.enabled ? "Les points apparaîtront ici après la prochaine commande livrée." : "Activez le programme ci-dessus : vos clients gagneront des points dès leur prochaine commande livrée."}
          />
        ) : (
          <Table className="relative">
            <THead>
              <tr>
                <TH className="w-12">#</TH>
                <TH>Client</TH>
                <TH align="right">Points</TH>
                <TH>Progression</TH>
                <TH align="right">Commandes</TH>
                <TH align="right">Dépensé</TH>
                {canAdjust && (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                )}
              </tr>
            </THead>
            <TBody>
              {leaders.map((c, i) => {
                const pct = Math.min(100, Math.round((c.loyaltyPoints / config.rewardPoints) * 100));
                const rewards = Math.floor(c.loyaltyPoints / config.rewardPoints);
                return (
                  <TR key={c.id}>
                    <TD className="text-ink-faint tabular">{i + 1}</TD>
                    <TD>
                      <Link href={`/app/${store.id}/clients/${c.id}`} className="flex items-center gap-2.5 font-medium text-ink hover:text-primary">
                        <Avatar name={c.name} size={30} />
                        {c.name}
                      </Link>
                    </TD>
                    <TD align="right" className="font-semibold">
                      {c.loyaltyPoints.toLocaleString("fr-FR")}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                          <span className={cn("block h-full rounded-full", rewards > 0 ? "bg-accent" : "bg-primary")} style={{ width: `${pct}%` }} />
                        </span>
                        {rewards > 0 ? (
                          <Badge tone="accent">
                            {rewards} récompense{rewards > 1 ? "s" : ""}
                          </Badge>
                        ) : (
                          <span className="text-xs text-ink-muted">{config.rewardPoints - c.loyaltyPoints} pts restants</span>
                        )}
                      </div>
                    </TD>
                    <TD align="right">{c.ordersCount}</TD>
                    <TD align="right">
                      <Money amount={c.totalSpent} currency={store.currency} />
                    </TD>
                    {canAdjust && (
                      <TD align="right">
                        <AdjustPointsButton storeId={store.id} customers={[{ id: c.id, name: c.name, points: c.loyaltyPoints }]} defaultCustomerId={c.id} rewardPoints={config.rewardPoints} label="Ajuster" />
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      {moves.length > 0 && (
        <Card>
          <CardHeader title="Derniers mouvements" />
          <CardBody className="pt-2">
            <ul className="divide-y divide-line">
              {moves.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={cn("w-16 shrink-0 font-semibold tabular", m.delta >= 0 ? "text-primary" : "text-danger")}>
                    {m.delta >= 0 ? "+" : ""}
                    {m.delta}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/app/${store.id}/clients/${m.customer.id}`} className="font-medium text-ink hover:text-primary">
                      {m.customer.name}
                    </Link>
                    <span className="block text-xs text-ink-muted">{REASON_LABELS[m.reason] ?? m.reason}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">{relativeTime(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
