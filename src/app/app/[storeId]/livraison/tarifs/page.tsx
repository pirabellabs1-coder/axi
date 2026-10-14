import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { listLocations } from "@/lib/locations/service";
import { formatMoney } from "@/lib/money";
import { RateDialog, RateDelete, ZoneLocationForm } from "./tarifs-client";

export const metadata: Metadata = { title: "Tarifs d'expédition" };

/**
 * Tarifs d'expédition par zone (lot 3 §1.2) : poids et sous-total net, livraison offerte, transporteur
 * et dépôt qui sert la zone. Une zone sans tarif actif garde son forfait (aucune régression).
 */
export default async function ShippingRatesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "delivery.manage");
  const currency = ctx.store.currency;
  const locked = ctx.planId === "FREE";

  const [zones, rates, carriers, locations] = await Promise.all([
    db.deliveryZone.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true, fee: true, freeAbove: true, etaLabel: true, locationId: true, active: true } }),
    db.shippingRate.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ position: "asc" }, { price: "asc" }] }),
    db.carrierAccount.findMany({ where: { storeId: ctx.store.id, active: true }, select: { id: true, name: true, carrier: true } }),
    listLocations(ctx.store.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarifs d'expédition"
        description="Facturez la livraison selon le poids du colis et le montant de la commande. Sans tarif, la zone garde son forfait."
        back={{ href: `/app/${storeId}/livraison`, label: "Livraison et retrait" }}
      />

      {locked && <PlanGate feature="stockTracking" title="Tarifs par poids et par montant" description={`Les tarifs d'expédition avancés sont inclus à partir du plan Starter (plan actuel : ${PLANS[ctx.planId].name}). Vos zones gardent leur forfait.`} storeId={storeId} />}

      {zones.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={Scale} title="Aucune zone de livraison" description="Créez d'abord une zone depuis la page Livraison et retrait." />
          </CardBody>
        </Card>
      ) : (
        zones.map((zone) => {
          const zoneRates = rates.filter((r) => r.zoneId === zone.id);
          return (
            <Card key={zone.id}>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    {zone.name}
                    {!zone.active && <Badge tone="neutral">Inactive</Badge>}
                  </span>
                }
                description={`Forfait actuel : ${formatMoney(zone.fee, currency)}${zone.freeAbove ? ` · offerte dès ${formatMoney(zone.freeAbove, currency)}` : ""}`}
                action={!locked && <RateDialog storeId={storeId} zoneId={zone.id} currency={currency} carriers={carriers} />}
              />
              <CardBody className="space-y-4">
                <ZoneLocationForm storeId={storeId} zoneId={zone.id} locationId={zone.locationId} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
                {zoneRates.length === 0 ? (
                  <p className="text-sm text-ink-muted">Aucun tarif : les commandes de cette zone utilisent le forfait ci-dessus.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {zoneRates.map((rate) => (
                      <li key={rate.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="font-medium text-ink">
                            {rate.name} {!rate.active && <Badge tone="neutral">Inactif</Badge>}
                          </p>
                          <p className="text-sm text-ink-muted">
                            {rate.minWeightGrams != null || rate.maxWeightGrams != null
                              ? `Poids ${rate.minWeightGrams ?? 0} g – ${rate.maxWeightGrams != null ? `${rate.maxWeightGrams} g` : "∞"}`
                              : "Tout poids"}
                            {" · "}
                            {rate.minSubtotal != null || rate.maxSubtotal != null
                              ? `Montant ${formatMoney(rate.minSubtotal ?? 0, currency)} – ${rate.maxSubtotal != null ? formatMoney(rate.maxSubtotal, currency) : "∞"}`
                              : "Tout montant"}
                            {rate.freeAbove != null ? ` · offerte dès ${formatMoney(rate.freeAbove, currency)}` : ""}
                            {rate.etaLabel ? ` · ${rate.etaLabel}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="tabular font-semibold text-ink">{formatMoney(rate.price, currency)}</span>
                          {!locked && (
                            <>
                              <RateDialog
                                storeId={storeId}
                                zoneId={zone.id}
                                currency={currency}
                                carriers={carriers}
                                rate={{
                                  id: rate.id,
                                  name: rate.name,
                                  price: rate.price,
                                  minWeightGrams: rate.minWeightGrams,
                                  maxWeightGrams: rate.maxWeightGrams,
                                  minSubtotal: rate.minSubtotal,
                                  maxSubtotal: rate.maxSubtotal,
                                  freeAbove: rate.freeAbove,
                                  etaLabel: rate.etaLabel,
                                  active: rate.active,
                                  carrierAccountId: rate.carrierAccountId,
                                }}
                              />
                              <RateDelete storeId={storeId} rateId={rate.id} name={rate.name} />
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          );
        })
      )}

      <Alert tone="info" title="Comment le tarif est choisi">
        Le poids du colis est la somme des poids des articles (poids de la variante, sinon du produit). Le montant comparé est le sous-total net après remises. Parmi les tarifs applicables, le moins cher est retenu.
      </Alert>
    </div>
  );
}
