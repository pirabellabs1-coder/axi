import type { Metadata } from "next";
import { ShoppingBag, MousePointerClick, Coins, Layers } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { PLACEMENT_LABELS, type CartOfferMode } from "@/lib/discounts/schema";
import { PageHeader, Kpi, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { PromotionsTabs } from "../_components/promotions-tabs";
import { loadPromoPickOptions } from "../_components/pick-options";
import { OfferDialog, OfferRowActions, type OfferDTO } from "./offer-dialog";
import { discountRequiresProducts } from "@/lib/discounts/offer-link";

export const metadata: Metadata = { title: "Offres au panier" };

const DESCRIPTION = "Ventes croisées et montées en gamme sur la fiche produit, au panier et au paiement.";

function names(ids: string[], map: Map<string, string>, max = 3): string {
  const list = ids.map((id) => map.get(id) ?? "élément retiré");
  return list.length > max ? `${list.slice(0, max).join(", ")} +${list.length - max}` : list.join(", ");
}

export default async function CartOffersPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "coupons.manage");
  const store = ctx.store;
  const enabled = PLANS[ctx.planId].features.cartOffers;

  const [offers, couponCount, automaticCount] = await Promise.all([
    db.cartOffer.findMany({ where: { storeId: store.id }, orderBy: [{ active: "desc" }, { position: "asc" }, { createdAt: "desc" }], take: 100 }),
    db.coupon.count({ where: { storeId: store.id } }),
    db.automaticDiscount.count({ where: { storeId: store.id } }),
  ]);
  const counts = { coupons: couponCount, automatic: automaticCount, offers: offers.length };

  if (!enabled && offers.length === 0) {
    return (
      <>
        <PageHeader title="Promotions" description={DESCRIPTION} />
        <PromotionsTabs storeId={store.id} counts={counts} />
        <PlanGate
          storeId={store.id}
          feature="cartOffers"
          description={`Les offres au panier sont incluses à partir du plan Business. Votre plan actuel (${PLANS[ctx.planId].name}) ne les propose pas encore. Le changement est immédiat et vos données restent intactes.`}
          unlocks={["« Souvent achetés ensemble » sur la fiche produit", "Suggestions au panier et au paiement", "Montée en gamme en un clic", "Mesure des conversions et du chiffre d'affaires"]}
        />
      </>
    );
  }

  const [options, discounts] = await Promise.all([
    loadPromoPickOptions(store.id),
    db.automaticDiscount.findMany({ where: { storeId: store.id, kind: "PRODUCT_AMOUNT" }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, config: true }, take: 100 }),
  ]);
  const productName = new Map(options.products.map((o) => [o.id, o.label]));
  const collectionName = new Map(options.collections.map((o) => [o.id, o.label]));
  // Remise liée conditionnée aux produits du panier (`requiresProductsInCart`).
  const requiresById = new Map(discounts.map((d) => [d.id, discountRequiresProducts(d.config)]));
  const octx = { storeId: store.id, products: options.products, collections: options.collections, discounts: discounts.map((d) => ({ id: d.id, label: d.title })) };

  const list = offers.map((o) => {
    const dto: OfferDTO = {
      id: o.id,
      title: o.title,
      placement: o.placement,
      mode: (o.mode === "replace" ? "replace" : "add") as CartOfferMode,
      triggerProductIds: o.triggerProductIds,
      triggerCollectionIds: o.triggerCollectionIds,
      offerProductIds: o.offerProductIds,
      automaticDiscountId: o.automaticDiscountId,
      discountRequiresTrigger: o.automaticDiscountId ? (requiresById.get(o.automaticDiscountId) ?? false) : false,
      position: o.position,
      active: o.active,
      conversions: o.conversions,
    };
    const triggers = [o.triggerProductIds.length ? names(o.triggerProductIds, productName) : null, o.triggerCollectionIds.length ? `collection ${names(o.triggerCollectionIds, collectionName)}` : null].filter(Boolean).join(" ; ");
    return { o, dto, triggers, proposed: names(o.offerProductIds, productName) };
  });

  const activeCount = offers.filter((o) => o.active).length;
  const conversions = offers.reduce((s, o) => s + o.conversions, 0);
  const revenue = offers.reduce((s, o) => s + o.revenue, 0);

  return (
    <>
      <PageHeader title="Promotions" description={DESCRIPTION} actions={enabled ? <OfferDialog ctx={octx} /> : undefined} />
      <PromotionsTabs storeId={store.id} counts={counts} />
      {!enabled && <PlanGate compact className="mb-6" storeId={store.id} feature="cartOffers" description="Votre plan n'inclut plus les offres au panier : elles ne sont plus affichées. Vous pouvez toujours les désactiver ou les supprimer." />}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Offres actives" value={activeCount} hint={`${offers.length} au total`} icon={Layers} />
        <Kpi label="Conversions" value={conversions.toLocaleString("fr-FR")} hint="Commandes avec un produit proposé" icon={MousePointerClick} />
        <Kpi label="Chiffre d'affaires" value={formatMoney(revenue, store.currency)} hint="Produits proposés vendus" icon={Coins} />
        <Kpi label="Panier moyen ajouté" value={formatMoney(conversions ? Math.round(revenue / conversions) : 0, store.currency)} hint="Par conversion" icon={ShoppingBag} />
      </div>

      {list.length === 0 ? (
        <EmptyState icon={Layers} title="Aucune offre au panier" description="Proposez par exemple un foulard assorti quand une robe est au panier." action={enabled ? <OfferDialog ctx={octx} /> : undefined} />
      ) : (
        <>
          <Card as="section" aria-label="Offres au panier" className="md:hidden">
            <ul className="divide-y divide-line">
              {list.map(({ o, dto, triggers, proposed }) => (
                <li key={o.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink [overflow-wrap:anywhere]">{o.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{PLACEMENT_LABELS[o.placement]}</p>
                    </div>
                    <Badge tone={o.active ? "success" : "neutral"} dot>
                      {o.active ? "Active" : "Désactivée"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink">
                    Si {triggers || "aucun déclencheur"} : {proposed}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {o.conversions.toLocaleString("fr-FR")} conversion{o.conversions > 1 ? "s" : ""} · {formatMoney(o.revenue, store.currency)}
                  </p>
                  <div className="mt-2 -mr-2 flex justify-end">
                    <OfferRowActions ctx={octx} offer={dto} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Table className="hidden md:block" minWidth={860}>
            <THead>
              <tr>
                <TH>Offre</TH>
                <TH>Déclencheurs</TH>
                <TH>Produits proposés</TH>
                <TH align="right">Conversions</TH>
                <TH align="right">Chiffre d&apos;affaires</TH>
                <TH>Statut</TH>
                <TH align="right" sticky>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.map(({ o, dto, triggers, proposed }) => (
                <TR key={o.id}>
                  <TD>
                    <span className="font-semibold text-ink">{o.title}</span>
                    <span className="block text-xs text-ink-muted">
                      {PLACEMENT_LABELS[o.placement]} · {o.mode === "replace" ? "Montée en gamme" : "Vente croisée"}
                    </span>
                  </TD>
                  <TD className="max-w-xs text-sm">{triggers || "Aucun"}</TD>
                  <TD className="max-w-xs text-sm">{proposed}</TD>
                  <TD align="right" className="tabular">
                    {o.conversions.toLocaleString("fr-FR")}
                  </TD>
                  <TD align="right" className="tabular">
                    {formatMoney(o.revenue, store.currency)}
                  </TD>
                  <TD>
                    <Badge tone={o.active ? "success" : "neutral"} dot>
                      {o.active ? "Active" : "Désactivée"}
                    </Badge>
                  </TD>
                  <TD align="right" sticky>
                    <OfferRowActions ctx={octx} offer={dto} />
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
