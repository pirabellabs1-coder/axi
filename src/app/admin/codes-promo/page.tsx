import type { Metadata } from "next";
import { TicketPercent } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { INVOICE_DISCOUNT_ACTION } from "@/lib/pricing/coupons";
import { sumByCurrency } from "@/lib/admin/metrics";
import { PageHeader, EmptyState, Kpi } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CouponDialogButton, CouponRowActions, type CouponDTO } from "@/components/admin/coupon-controls";

export const metadata: Metadata = { title: "Codes promo" };

export default async function AdminCoupons() {
  const ctx = await getAdminContext();
  const canEdit = ctx.can("coupons.manage");
  const now = new Date();
  const [coupons, discounts] = await Promise.all([
    db.saasCoupon.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] }),
    db.auditLog.findMany({ where: { action: INVOICE_DISCOUNT_ACTION }, select: { target: true, metadata: true } }),
  ]);
  // Remises réellement accordées (factures non annulées)
  const invoiceIds = discounts.map((d) => d.target!).filter(Boolean);
  const live = invoiceIds.length ? new Set((await db.invoice.findMany({ where: { id: { in: invoiceIds }, status: { not: "VOID" } }, select: { id: true } })).map((i) => i.id)) : new Set<string>();
  const granted = discounts.filter((d) => d.target && live.has(d.target)).map((d) => d.metadata as { couponId?: string; discount?: number; currency?: string });
  const byCoupon = new Map<string, { n: number; rows: { amount: number; currency: string }[] }>();
  for (const g of granted) {
    if (!g.couponId) continue;
    const e = byCoupon.get(g.couponId) ?? { n: 0, rows: [] };
    e.n += 1;
    e.rows.push({ amount: g.discount ?? 0, currency: g.currency ?? "EUR" });
    byCoupon.set(g.couponId, e);
  }
  const totalGranted = sumByCurrency(granted.map((g) => ({ amount: g.discount ?? 0, currency: g.currency ?? "EUR" })));
  const activeCount = coupons.filter((c) => c.active && (!c.expiresAt || c.expiresAt > now)).length;
  const redemptions = coupons.reduce((a, c) => a + c.redemptions, 0);

  const dto = (c: (typeof coupons)[number]): CouponDTO => ({ ...c, expiresAt: c.expiresAt?.toISOString() ?? null });

  return (
    <>
      <PageHeader
        title="Codes promo"
        description="Remises sur les abonnements (lancement, partenaires, revendeurs). Saisies par le marchand au moment de choisir son plan ; chaque remise apparaît en ligne sur la facture."
        actions={<CouponDialogButton canEdit={canEdit} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Codes actifs" value={activeCount} icon={TicketPercent} hint={`${coupons.length} au total`} />
        <Kpi label="Utilisations" value={redemptions} hint="Toutes boutiques confondues" />
        <Kpi className="col-span-2 lg:col-span-1" label="Remises accordées" value={Object.keys(totalGranted).length ? Object.entries(totalGranted).map(([c, a]) => formatMoney(a, c)).join(" + ") : formatMoney(0, "EUR")} hint={`${granted.length} facture${granted.length > 1 ? "s" : ""} remisée${granted.length > 1 ? "s" : ""}`} />
      </div>

      {coupons.length === 0 ? (
        <EmptyState icon={TicketPercent} title="Aucun code promo" description="Créez un premier code, par exemple -20 % sur les 3 premières factures du plan Business en zone Afrique." action={<CouponDialogButton canEdit={canEdit} />} />
      ) : (
        <Table minWidth={940}>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Remise</TH>
              <TH>Ciblage</TH>
              <TH align="right">Utilisations</TH>
              <TH>Validité</TH>
              <TH>État</TH>
              <TH align="right"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {coupons.map((c) => {
              const expired = !!c.expiresAt && c.expiresAt <= now;
              const exhausted = c.maxRedemptions != null && c.redemptions >= c.maxRedemptions;
              const stats = byCoupon.get(c.id);
              const sums = stats ? sumByCurrency(stats.rows) : {};
              return (
                <TR key={c.id}>
                  <TD>
                    <span className="font-mono text-[13px] font-semibold tracking-wide text-ink">{c.code}</span>
                    {c.description && <span className="block max-w-[240px] truncate text-xs text-ink-muted">{c.description}</span>}
                  </TD>
                  <TD>
                    <span className="tabular font-medium">{c.percentOff ? `-${c.percentOff} %` : c.amountOff != null ? `-${formatMoney(c.amountOff, c.zone === "AFRICA" ? "XOF" : "EUR")}` : "-"}</span>
                    <span className="block text-xs text-ink-muted">{c.durationMonths > 1 ? `sur ${c.durationMonths} factures` : "sur 1 facture"}</span>
                  </TD>
                  <TD>
                    <span className="block text-sm">{c.zone === "AFRICA" ? "Afrique (FCFA)" : c.zone === "WORLD" ? "Monde (EUR)" : "Toutes zones"}</span>
                    <span className="block text-xs text-ink-muted">{c.plans.length ? c.plans.map((p) => PLANS[p as PlanId]?.name ?? p).join(", ") : "Tous les plans payants"}</span>
                  </TD>
                  <TD align="right">
                    {c.redemptions}
                    {c.maxRedemptions != null && <span className="text-ink-muted"> / {c.maxRedemptions}</span>}
                    {stats && <span className="block text-xs text-ink-muted">{Object.entries(sums).map(([cur, a]) => formatMoney(a, cur)).join(" + ")} remis</span>}
                  </TD>
                  <TD><span className="text-ink-muted">{c.expiresAt ? `Jusqu'au ${formatDate(c.expiresAt)}` : "Sans fin"}</span></TD>
                  <TD>{!c.active ? <Badge tone="neutral">Désactivé</Badge> : expired ? <Badge tone="warning">Expiré</Badge> : exhausted ? <Badge tone="sun">Épuisé</Badge> : <Badge tone="success" dot>Actif</Badge>}</TD>
                  <TD align="right"><CouponRowActions coupon={dto(c)} canEdit={canEdit} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {!canEdit && <p className="mt-4 text-sm text-ink-muted">Lecture seule : les rôles Finance et Super-administrateur gèrent les codes promo.</p>}
    </>
  );
}
