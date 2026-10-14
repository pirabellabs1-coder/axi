import type { Metadata } from "next";
import Link from "next/link";
import { Coins } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatDateTime } from "@/lib/utils";
import { walletBalance } from "@/lib/admin/metrics";
import { PageHeader, EmptyState, Kpi } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CREDIT_SHORT, SectionTitle } from "@/components/app/admin-bits";
import { CreditAdjustButton } from "@/components/app/admin-credit-adjust";

export const metadata: Metadata = { title: "Portefeuilles de crédits" };

const TYPES = ["WA_UTILITY", "WA_MARKETING", "AI"] as const;
type T = (typeof TYPES)[number];

const REASON_LABEL: Record<string, string> = {
  plan_monthly: "Inclus dans le plan",
  pack_purchase: "Pack acheté",
  usage: "Consommation",
  expiration: "Expiration",
  refund: "Remboursement",
  admin: "Ajustement admin",
};

export default async function AdminCredits() {
  await requirePlatformAdmin();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [live, used, movements] = await Promise.all([
    db.creditLedger.groupBy({ by: ["storeId", "type"], where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, _sum: { delta: true } }),
    db.creditLedger.groupBy({ by: ["storeId", "type"], where: { delta: { lt: 0 }, reason: "usage", createdAt: { gte: monthStart } }, _sum: { delta: true } }),
    db.creditLedger.findMany({ where: { reason: { not: "usage" } }, orderBy: { createdAt: "desc" }, take: 20, include: { store: { select: { id: true, name: true } } } }),
  ]);
  const storeIds = [...new Set(live.map((l) => l.storeId))];
  const stores = storeIds.length
    ? await db.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true, city: true, subscription: { select: { planId: true, status: true } } }, orderBy: { name: "asc" } })
    : [];

  const wallet = (storeId: string) => {
    const b = {} as Record<T, number>;
    const u = {} as Record<T, number>;
    for (const t of TYPES) {
      b[t] = walletBalance(live.find((l) => l.storeId === storeId && l.type === t)?._sum.delta);
      u[t] = Math.abs(used.find((l) => l.storeId === storeId && l.type === t)?._sum.delta ?? 0);
    }
    return { b, u };
  };
  const totals = TYPES.map((t) => ({ t, used: used.filter((u) => u.type === t).reduce((n, u) => n + Math.abs(u._sum.delta ?? 0), 0), balance: live.filter((l) => l.type === t).reduce((n, l) => n + walletBalance(l._sum.delta), 0) }));

  return (
    <>
      <PageHeader title="Portefeuilles de crédits" description="Soldes par boutique (crédits non expirés) et consommation du mois. Les ajustements sont motivés et journalisés." />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {totals.map((x) => (
          <Kpi key={x.t} label={`${CREDIT_SHORT[x.t]} consommés`} value={x.used.toLocaleString("fr-FR")} hint={`${x.balance.toLocaleString("fr-FR")} disponibles sur la plateforme`} />
        ))}
      </div>

      <section aria-labelledby="wallets" className="mb-8">
        <SectionTitle id="wallets" title="Soldes par boutique" description="Solde disponible, et entre parenthèses la consommation depuis le 1er du mois." />
        {stores.length === 0 ? (
          <EmptyState icon={Coins} title="Aucun portefeuille" description="Les crédits apparaissent dès qu'une boutique a un plan avec messages ou IA inclus, ou achète un pack." />
        ) : (
          <Table minWidth={860}>
            <THead>
              <TR>
                <TH>Boutique</TH>
                <TH>Plan</TH>
                {TYPES.map((t) => (
                  <TH key={t} align="right">{CREDIT_SHORT[t]}</TH>
                ))}
                <TH align="right">Ajustement</TH>
              </TR>
            </THead>
            <TBody>
              {stores.map((s) => {
                const { b, u } = wallet(s.id);
                return (
                  <TR key={s.id}>
                    <TD><Link href={`/admin/boutiques/${s.id}`} className="font-medium hover:text-primary">{s.name}</Link>{s.city && <span className="block text-xs text-ink-muted">{s.city}</span>}</TD>
                    <TD>{s.subscription ? PLANS[s.subscription.planId].name : "-"}{s.subscription?.status === "TRIALING" && <Badge tone="sun" className="ml-2">Essai</Badge>}</TD>
                    {TYPES.map((t) => (
                      <TD key={t} align="right">
                        <span className={b[t] === 0 && u[t] > 0 ? "font-medium text-danger" : undefined}>{b[t].toLocaleString("fr-FR")}</span>
                        <span className="block text-xs text-ink-muted">({u[t].toLocaleString("fr-FR")})</span>
                      </TD>
                    ))}
                    <TD align="right"><CreditAdjustButton storeId={s.id} storeName={s.name} balances={b} /></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="movements">
        <SectionTitle id="movements" title="Derniers mouvements hors consommation" description="Dotations des plans, packs achetés, ajustements." />
        {movements.length === 0 ? (
          <EmptyState icon={Coins} title="Aucun mouvement" />
        ) : (
          <Table minWidth={720}>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Boutique</TH>
                <TH>Type</TH>
                <TH>Origine</TH>
                <TH align="right">Crédits</TH>
                <TH align="right">Échéance</TH>
              </TR>
            </THead>
            <TBody>
              {movements.map((m) => (
                <TR key={m.id}>
                  <TD><span className="text-ink-muted">{formatDateTime(m.createdAt)}</span></TD>
                  <TD><Link href={`/admin/boutiques/${m.store.id}`} className="hover:text-primary">{m.store.name}</Link></TD>
                  <TD>{CREDIT_SHORT[m.type]}</TD>
                  <TD>{m.reason === "admin" ? <Badge tone="sun">{REASON_LABEL.admin}</Badge> : REASON_LABEL[m.reason] ?? m.reason}</TD>
                  <TD align="right"><span className={m.delta < 0 ? "text-danger" : "text-ink"}>{m.delta > 0 ? "+" : ""}{m.delta.toLocaleString("fr-FR")}</span></TD>
                  <TD align="right"><span className="text-ink-muted">{m.expiresAt ? formatDateTime(m.expiresAt) : "Sans échéance"}</span></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}
