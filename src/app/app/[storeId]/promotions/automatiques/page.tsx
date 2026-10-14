import type { Metadata } from "next";
import { BadgePercent, Zap, CalendarClock, TrendingDown } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { currencyDecimals, formatMoney } from "@/lib/money";
import { localParts } from "@/lib/reports/daily";
import { readDiscountConfig, KIND_LABELS } from "@/lib/discounts/schema";
import { describeDiscount, discountStatus, STATUS_LABELS, type DiscountStatus } from "@/lib/discounts/summary";
import { allowedDiscountKinds } from "@/lib/discounts/service";
import { PageHeader, Kpi, EmptyState } from "@/components/ui/misc";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { PromotionsTabs } from "../_components/promotions-tabs";
import { loadPromoPickOptions } from "../_components/pick-options";
import { DiscountDialog, DiscountRowActions, type DiscountDTO } from "./discount-dialog";

export const metadata: Metadata = { title: "Remises automatiques" };

const DESCRIPTION = "Remises appliquées sans code : sur des produits, par paliers de panier, « X achetés = Y offerts » et lots.";
const TONES: Record<DiscountStatus, BadgeTone> = { active: "success", scheduled: "info", expired: "warning", exhausted: "warning", inactive: "neutral" };

export default async function AutomaticDiscountsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "coupons.manage");
  const store = ctx.store;
  const kinds = allowedDiscountKinds(ctx.planId);

  const [rows, couponCount, offersCount, applied] = await Promise.all([
    db.automaticDiscount.findMany({ where: { storeId: store.id }, orderBy: [{ active: "desc" }, { priority: "desc" }, { createdAt: "desc" }], include: { _count: { select: { applications: true } } }, take: 200 }),
    db.coupon.count({ where: { storeId: store.id } }),
    db.cartOffer.count({ where: { storeId: store.id } }),
    db.orderDiscount.aggregate({ where: { storeId: store.id, source: "automatic", order: { status: { not: "CANCELLED" } } }, _sum: { amount: true } }),
  ]);
  const counts = { coupons: couponCount, automatic: rows.length, offers: offersCount };

  // Plan sans remises automatiques : écran d'upsell, mais les remises existantes restent désactivables.
  if (kinds.size === 0 && rows.length === 0) {
    return (
      <>
        <PageHeader title="Promotions" description={DESCRIPTION} />
        <PromotionsTabs storeId={store.id} counts={counts} />
        <PlanGate
          storeId={store.id}
          feature="automaticDiscounts"
          description={`Les remises automatiques sont incluses à partir du plan Starter. Votre plan actuel (${PLANS[ctx.planId].name}) ne les propose pas encore. Le changement est immédiat et vos données restent intactes.`}
          unlocks={["Remise en % ou en montant sur des produits ou collections", `Paliers de panier (−5 % dès ${formatMoney(currencyDecimals(store.currency) === 0 ? 20_000 : 5_000, store.currency)}…)`, "Lots et « 2 achetés = 1 offert » (plan Business)", "Messages de progression au panier"]}
        />
      </>
    );
  }

  const options = await loadPromoPickOptions(store.id);
  const productName = new Map(options.products.map((o) => [o.id, o.label]));
  const collectionName = new Map(options.collections.map((o) => [o.id, o.label]));
  const names = { currency: store.currency, timeZone: store.timezone, productName: (id: string) => productName.get(id), collectionName: (id: string) => collectionName.get(id) };
  const dctx = { storeId: store.id, currency: store.currency, timeZone: store.timezone, options, allowedKinds: [...kinds] };
  const now = new Date();

  const list = rows.map((r) => {
    const parsed = readDiscountConfig(r.kind, r.config);
    const dto: DiscountDTO = {
      id: r.id,
      title: r.title,
      kind: r.kind,
      config: r.config,
      priority: r.priority,
      combinesWithCoupons: r.combinesWithCoupons,
      combinesWithOtherAutomatic: r.combinesWithOtherAutomatic,
      startsOn: r.startsAt ? localParts(r.startsAt, store.timezone).date : null,
      endsOn: r.endsAt ? localParts(r.endsAt, store.timezone).date : null,
      maxUses: r.maxUses,
      active: r.active,
      applications: r._count.applications,
    };
    const status = discountStatus(r, now);
    const summary = parsed ? describeDiscount(parsed, names, { startsAt: r.startsAt, endsAt: r.endsAt }) : "Configuration invalide : modifiez la remise.";
    const uses = `${r.usesCount.toLocaleString("fr-FR")}${r.maxUses != null ? ` / ${r.maxUses.toLocaleString("fr-FR")}` : ""}`;
    const locked = !kinds.has(r.kind);
    return { r, dto, status, summary, uses, locked };
  });

  const active = list.filter((x) => x.status === "active").length;
  const scheduled = list.filter((x) => x.status === "scheduled").length;
  const lockedCount = list.filter((x) => x.locked && x.r.active).length;

  return (
    <>
      <PageHeader title="Promotions" description={DESCRIPTION} actions={kinds.size > 0 ? <DiscountDialog ctx={dctx} /> : undefined} />
      <PromotionsTabs storeId={store.id} counts={counts} />

      {kinds.size === 0 && (
        <PlanGate compact className="mb-6" storeId={store.id} feature="automaticDiscounts" description="Votre plan n'inclut plus les remises automatiques : elles ne s'appliquent plus au checkout. Vous pouvez toujours les désactiver ou les supprimer." />
      )}
      {kinds.size > 0 && lockedCount > 0 && (
        <PlanGate compact className="mb-6" storeId={store.id} feature="advancedDiscounts" description={`${lockedCount} remise(s) active(s) de type lot ou « X achetés = Y offerts » ne s'appliquent pas avec votre plan actuel.`} />
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Remises actives" value={active} hint={`${rows.length} au total`} icon={Zap} />
        <Kpi label="Programmées" value={scheduled} hint="Démarrent plus tard" icon={CalendarClock} />
        <Kpi label="Utilisations" value={rows.reduce((s, r) => s + r.usesCount, 0).toLocaleString("fr-FR")} hint="Commandes remisées" icon={BadgePercent} />
        <Kpi label="Remises accordées" value={formatMoney(applied._sum.amount ?? 0, store.currency)} hint="Hors commandes annulées" icon={TrendingDown} />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={BadgePercent}
          title="Aucune remise automatique"
          description={`Créez par exemple « 2 accessoires achetés = 1 offert » ou « −10 % dès ${formatMoney(currencyDecimals(store.currency) === 0 ? 50_000 : 10_000, store.currency)} » : la remise s'applique seule au panier.`}
          action={<DiscountDialog ctx={dctx} />}
        />
      ) : (
        <>
          <Card as="section" aria-label="Remises automatiques" className="md:hidden">
            <ul className="divide-y divide-line">
              {list.map(({ r, dto, status, summary, uses }) => (
                <li key={r.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink [overflow-wrap:anywhere]">{r.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{KIND_LABELS[r.kind]}</p>
                    </div>
                    <Badge tone={TONES[status]} dot>
                      {STATUS_LABELS[status]}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink">{summary}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    <span className="tabular">{uses}</span> utilisation{r.usesCount > 1 ? "s" : ""}
                  </p>
                  <div className="mt-2 -mr-2 flex justify-end">
                    <DiscountRowActions ctx={dctx} discount={dto} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Table className="hidden md:block" minWidth={860}>
            <THead>
              <tr>
                <TH>Remise</TH>
                <TH>Conditions</TH>
                <TH align="right">Utilisations</TH>
                <TH>Statut</TH>
                <TH align="right" sticky>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.map(({ r, dto, status, summary, uses, locked }) => (
                <TR key={r.id}>
                  <TD>
                    <span className="font-semibold text-ink">{r.title}</span>
                    <span className="block text-xs text-ink-muted">
                      {KIND_LABELS[r.kind]}
                      {r.priority !== 0 ? ` · priorité ${r.priority}` : ""}
                      {locked ? " · plan supérieur requis" : ""}
                    </span>
                  </TD>
                  <TD className="max-w-md text-sm text-ink">{summary}</TD>
                  <TD align="right" className="tabular">
                    {uses}
                  </TD>
                  <TD>
                    <Badge tone={TONES[status]} dot>
                      {STATUS_LABELS[status]}
                    </Badge>
                  </TD>
                  <TD align="right" sticky>
                    <DiscountRowActions ctx={dctx} discount={dto} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </>
  );
}
