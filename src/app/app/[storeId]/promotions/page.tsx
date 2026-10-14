import type { Metadata } from "next";
import { Ticket, TrendingDown, Hash, CalendarClock } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { PageHeader, Kpi, EmptyState } from "@/components/ui/misc";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { CouponDialog, CouponRowActions, type CouponDTO } from "./coupon-dialog";
import { PromotionsTabs } from "./_components/promotions-tabs";
import { loadPromoPickOptions } from "./_components/pick-options";

export const metadata: Metadata = { title: "Codes promo" };

function idList(raw: unknown, key: "productIds" | "collectionIds"): string[] {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const TYPE_LABEL = { PERCENT: "Pourcentage", FIXED: "Montant fixe", FREE_DELIVERY: "Livraison offerte" } as const;
const DESCRIPTION = "Remises en pourcentage, montant fixe ou livraison offerte, avec limites d'utilisation et période de validité.";

type Status = { label: string; tone: BadgeTone };

function nowMs() {
  return Date.now();
}

export default async function PromotionsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "coupons.manage");
  const store = ctx.store;

  if (!PLANS[ctx.planId].features.coupons) {
    return (
      <>
        <PageHeader title="Promotions" description={DESCRIPTION} />
        <PromotionsTabs storeId={store.id} />
        <PlanGate
          storeId={store.id}
          feature="coupons"
          description={`Les codes promo sont inclus à partir du plan Starter. Votre plan actuel (${PLANS[ctx.planId].name}) ne les propose pas encore. Le changement est immédiat et vos données restent intactes.`}
          unlocks={[
            "Remise en pourcentage, montant fixe ou livraison offerte",
            "Limite d'utilisations totale et par client",
            "Période de validité programmable",
            "Suivi des remises accordées et des utilisations",
          ]}
        />
      </>
    );
  }

  const [coupons, agg, options, automaticCount, offersCount] = await Promise.all([
    db.coupon.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { redemptions: true } } } }),
    db.couponRedemption.aggregate({ where: { coupon: { storeId: store.id } }, _sum: { amount: true }, _count: true }),
    loadPromoPickOptions(store.id),
    db.automaticDiscount.count({ where: { storeId: store.id } }),
    db.cartOffer.count({ where: { storeId: store.id } }),
  ]);
  const pick = { products: options.products, collections: options.collections };

  const now = nowMs();
  const statusOf = (c: (typeof coupons)[number]): Status => {
    if (!c.active) return { label: "Inactif", tone: "neutral" };
    if (c.startsAt && c.startsAt.getTime() > now) return { label: "Programmé", tone: "info" };
    if (c.endsAt && c.endsAt.getTime() < now) return { label: "Expiré", tone: "warning" };
    if (c.maxUses != null && c.usesCount >= c.maxUses) return { label: "Épuisé", tone: "warning" };
    return { label: "Actif", tone: "success" };
  };

  const rows = coupons.map((c) => {
    const dto: CouponDTO = {
      id: c.id,
      code: c.code,
      type: c.type,
      value: c.value,
      minSubtotal: c.minSubtotal,
      maxUses: c.maxUses,
      maxUsesPerCustomer: c.maxUsesPerCustomer,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      active: c.active,
      usesCount: c.usesCount,
      redemptions: c._count.redemptions,
      combinesWithAutomatic: c.combinesWithAutomatic,
      firstOrderOnly: c.firstOrderOnly,
      appliesToProductIds: idList(c.appliesTo, "productIds"),
      appliesToCollectionIds: idList(c.appliesTo, "collectionIds"),
    };
    const discount = c.type === "PERCENT" ? `-${c.value} %` : c.type === "FIXED" ? `-${formatMoney(c.value, store.currency)}` : "Livraison offerte";
    const period = c.startsAt || c.endsAt ? `${c.startsAt ? formatDate(c.startsAt) : "Dès maintenant"} au ${c.endsAt ? formatDate(c.endsAt) : "sans fin"}` : "Sans limite de date";
    const uses = `${c.usesCount.toLocaleString("fr-FR")}${c.maxUses != null ? ` / ${c.maxUses.toLocaleString("fr-FR")}` : ""}`;
    return { c, dto, status: statusOf(c), discount, period, uses };
  });

  const activeCount = rows.filter((r) => r.status.label === "Actif").length;
  const scheduled = rows.filter((r) => r.status.label === "Programmé").length;

  return (
    <>
      <PageHeader title="Promotions" description={DESCRIPTION} actions={<CouponDialog storeId={store.id} currency={store.currency} options={pick} />} />
      <PromotionsTabs storeId={store.id} counts={{ coupons: coupons.length, automatic: automaticCount, offers: offersCount }} />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Codes actifs" value={activeCount} hint={`${coupons.length} au total`} icon={Ticket} />
        <Kpi label="Programmés" value={scheduled} hint="Démarrent plus tard" icon={CalendarClock} />
        <Kpi label="Utilisations" value={agg._count.toLocaleString("fr-FR")} hint="Depuis la création" icon={Hash} />
        <Kpi label="Remises accordées" value={formatMoney(agg._sum.amount ?? 0, store.currency)} hint="Montant cumulé" icon={TrendingDown} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="Aucun code promo"
          description="Créez un premier code, par exemple BIENVENUE10 pour 10 % de remise sur la première commande."
          action={<CouponDialog storeId={store.id} currency={store.currency} options={pick} />}
        />
      ) : (
        <>
          {/* Mobile : liste en cartes */}
          <Card as="section" aria-label="Codes promo" className="md:hidden">
            <ul className="divide-y divide-line">
              {rows.map(({ c, dto, status, discount, period, uses }) => (
                <li key={c.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{c.code}</p>
                      <p className="mt-0.5 text-sm text-ink">
                        {discount} <span className="text-ink-muted">· {TYPE_LABEL[c.type]}</span>
                      </p>
                    </div>
                    <Badge tone={status.tone} dot>{status.label}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    <span className="tabular">{uses}</span> utilisation{c.usesCount > 1 ? "s" : ""} · {period}
                    {c.minSubtotal > 0 ? ` · dès ${formatMoney(c.minSubtotal, store.currency)}` : ""}
                  </p>
                  <div className="mt-2 -mr-2 flex justify-end">
                    <CouponRowActions storeId={store.id} coupon={dto} currency={store.currency} options={pick} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* Tablette et bureau : tableau dense */}
          <Table className="hidden md:block" minWidth={760}>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Remise</TH>
                <TH align="right">Minimum</TH>
                <TH align="right">Utilisations</TH>
                <TH>Période</TH>
                <TH>Statut</TH>
                <TH align="right" sticky>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rows.map(({ c, dto, status, discount, period, uses }) => (
                <TR key={c.id}>
                  <TD className="font-mono font-semibold">{c.code}</TD>
                  <TD>
                    <span className="tabular">{discount}</span>
                    <span className="block text-xs text-ink-muted">{TYPE_LABEL[c.type]}</span>
                  </TD>
                  <TD align="right" className="text-ink-muted">{c.minSubtotal > 0 ? formatMoney(c.minSubtotal, store.currency) : "Aucun"}</TD>
                  <TD align="right">{uses}</TD>
                  <TD className="whitespace-nowrap text-ink-muted">{period}</TD>
                  <TD>
                    <Badge tone={status.tone} dot>{status.label}</Badge>
                  </TD>
                  <TD align="right" sticky>
                    <CouponRowActions storeId={store.id} coupon={dto} currency={store.currency} options={pick} />
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
