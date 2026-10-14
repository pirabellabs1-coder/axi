import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wallet, Info } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { APP_PLATFORM_FEE_PCT } from "@/lib/apps/types";
import { computeDeveloperEarnings, type EarningsInstall } from "@/lib/apps/billing";
import { PageHeader, EmptyState, Alert, Money } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { AppIcon } from "@/app/app/[storeId]/applications/app-visuals";

export const metadata: Metadata = { title: "Revenus" };

export default async function DeveloperRevenuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  // Isolation stricte : uniquement les apps de ce développeur, avec leurs installations ACTIVE.
  const apps = await db.app.findMany({
    where: { developerUserId: user.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      iconUrl: true,
      category: true,
      pricingType: true,
      priceInterval: true,
      installs: { where: { status: "ACTIVE" }, select: { billingStatus: true, priceAmount: true } },
    },
  });

  const rows = apps.map((app) => {
    const installs: EarningsInstall[] = app.installs.map((i) => ({
      billingStatus: i.billingStatus,
      priceAmount: i.priceAmount,
      pricingType: app.pricingType,
      priceInterval: app.priceInterval,
    }));
    return { app, earnings: computeDeveloperEarnings(installs, APP_PLATFORM_FEE_PCT) };
  });

  const total = rows.reduce(
    (acc, r) => ({
      activePaidInstalls: acc.activePaidInstalls + r.earnings.activePaidInstalls,
      grossMonthly: acc.grossMonthly + r.earnings.grossMonthly,
      feeMonthly: acc.feeMonthly + r.earnings.feeMonthly,
      netMonthly: acc.netMonthly + r.earnings.netMonthly,
    }),
    { activePaidInstalls: 0, grossMonthly: 0, feeMonthly: 0, netMonthly: 0 },
  );

  return (
    <>
      <PageHeader
        title="Revenus"
        description={`Revenu mensuel récurrent estimé de vos applications payantes, net de la commission plateforme (${APP_PLATFORM_FEE_PCT} %).`}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Aucune application"
          description="Créez une application payante pour suivre ici vos revenus d'abonnement."
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th scope="col" className="px-4 py-3 font-medium">Application</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Abonnements actifs</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Brut / mois</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Commission ({APP_PLATFORM_FEE_PCT} %)</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Net / mois</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ app, earnings }) => (
                    <tr key={app.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <AppIcon name={app.name} iconUrl={app.iconUrl} category={app.category} size={32} />
                          <span className="truncate font-medium text-ink">{app.name}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">{earnings.activePaidInstalls}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink"><Money amount={earnings.grossMonthly} currency="XOF" /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-muted">− <Money amount={earnings.feeMonthly} currency="XOF" /></td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink"><Money amount={earnings.netMonthly} currency="XOF" /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-strong bg-surface-2 font-semibold">
                    <td className="px-4 py-3 text-ink">Total</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{total.activePaidInstalls}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink"><Money amount={total.grossMonthly} currency="XOF" /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-muted">− <Money amount={total.feeMonthly} currency="XOF" /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink"><Money amount={total.netMonthly} currency="XOF" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Alert tone="info" className="mt-5">
            <span className="inline-flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Montants indicatifs : revenu mensuel récurrent des abonnements actifs (essais et abonnements annulés exclus ;
                un abonnement annuel est ramené au mois). Les paiements uniques ne sont pas comptés dans ce récurrent.
                Les reversements réels sont opérés par la plateforme, hors de ce reporting.
              </span>
            </span>
          </Alert>
        </>
      )}
    </>
  );
}
