import type { Metadata } from "next";
import Link from "next/link";
import { Warehouse, ArrowRightLeft } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { listLocations, locationLimit, LOCATION_TYPE_LABELS } from "@/lib/locations/service";
import { findLevelDiscrepancies } from "@/lib/inventory/levels";
import { LocationDialog, LocationRowActions, AssignStockDialog, CountDialog } from "./depots-client";

export const metadata: Metadata = { title: "Dépôts et stock" };

const ITEMS_LIMIT = 40;

/**
 * Dépôts et stock par dépôt (lot 3 §1.1). Le stock total d'un article reste la référence de
 * disponibilité de la boutique ; cette page montre comment il se répartit entre les dépôts et
 * signale tout écart d'invariant (réconciliation).
 */
export default async function LocationsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const plan = PLANS[ctx.planId];
  const limit = locationLimit(ctx.planId);

  const [locations, levels, discrepancies] = await Promise.all([
    listLocations(ctx.store.id),
    db.inventoryLevel.findMany({
      where: { storeId: ctx.store.id },
      take: 500,
      select: { locationId: true, itemKey: true, available: true, productId: true, variantId: true, product: { select: { name: true } }, variant: { select: { name: true } } },
    }),
    findLevelDiscrepancies(ctx.store.id, 50),
  ]);

  // Articles répartis (ou suivis sans niveau) : une ligne par article, une colonne par dépôt.
  const byItem = new Map<string, { itemKey: string; productId: string; variantId: string | null; label: string; perLocation: Map<string, number> }>();
  for (const level of levels) {
    const row = byItem.get(level.itemKey) ?? {
      itemKey: level.itemKey,
      productId: level.productId,
      variantId: level.variantId,
      label: `${level.product.name}${level.variant ? ` (${level.variant.name})` : ""}`,
      perLocation: new Map<string, number>(),
    };
    row.perLocation.set(level.locationId, level.available);
    byItem.set(level.itemKey, row);
  }
  const items = [...byItem.values()].sort((a, b) => a.label.localeCompare(b.label, "fr")).slice(0, ITEMS_LIMIT);
  const canAddLocation = limit == null || locations.length < limit;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dépôts et stock"
        description="Répartissez votre stock entre entrepôts, magasins et points de retrait. Le stock total d'un article reste la référence pour la vente en ligne."
        actions={
          <div className="flex flex-wrap gap-2">
            {plan.features.stockTransfers && (
              <ButtonLink href={`/app/${storeId}/stock/transferts`} variant="secondary" size="sm" className="h-11 sm:h-9">
                <ArrowRightLeft className="size-4" aria-hidden /> Transferts
              </ButtonLink>
            )}
            <LocationDialog storeId={storeId} disabled={!canAddLocation} limit={limit} planName={plan.name} />
          </div>
        }
      />

      {discrepancies.length > 0 && (
        <Alert tone="warning" title="Écart entre le stock total et la somme des dépôts">
          {discrepancies.length} article{discrepancies.length > 1 ? "s" : ""} présente{discrepancies.length > 1 ? "nt" : ""} un écart (par exemple{" "}
          {discrepancies[0].name} : stock {discrepancies[0].aggregate}, dépôts {discrepancies[0].levelsSum}
          {discrepancies[0].inTransit ? ` + ${discrepancies[0].inTransit} en transit` : ""}). Lancez un inventaire du dépôt concerné pour corriger.
        </Alert>
      )}

      <Card>
        <CardHeader title="Vos dépôts" description={limit == null ? "Nombre illimité sur votre plan." : `${locations.length} / ${limit} dépôt${limit > 1 ? "s" : ""} sur le plan ${plan.name}.`} />
        <CardBody>
          {locations.length === 0 ? (
            <EmptyState
              icon={Warehouse}
              title="Aucun dépôt"
              description="Créez votre dépôt principal : votre stock actuel y sera rattaché."
              action={<LocationDialog storeId={storeId} disabled={false} limit={limit} planName={plan.name} />}
            />
          ) : (
            <Table minWidth={720}>
              <THead>
                <TR>
                  <TH>Dépôt</TH>
                  <TH>Type</TH>
                  <TH>Rôle</TH>
                  <TH align="right">Articles</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {locations.map((location) => {
                  const units = levels.filter((l) => l.locationId === location.id).reduce((s, l) => s + l.available, 0);
                  return (
                    <TR key={location.id}>
                      <TD>
                        <span className="font-medium text-ink">{location.name}</span>
                        {location.city && <span className="block text-sm text-ink-muted">{location.city}</span>}
                      </TD>
                      <TD>{LOCATION_TYPE_LABELS[location.type]}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {location.isDefault && <Badge tone="primary">Par défaut</Badge>}
                          {!location.active && <Badge tone="neutral">Archivé</Badge>}
                          {location.fulfillsOnlineOrders && <Badge tone="info">Commandes en ligne</Badge>}
                          {location.pickupEnabled && <Badge tone="accent">Retrait</Badge>}
                        </div>
                      </TD>
                      <TD align="right" className="tabular">
                        {units}
                      </TD>
                      <TD align="right">
                        <div className="flex items-center justify-end gap-1">
                          <CountDialog storeId={storeId} location={location} items={items.map((i) => ({ itemKey: i.itemKey, label: i.label, available: i.perLocation.get(location.id) ?? 0 }))} />
                          <LocationDialog storeId={storeId} location={location} disabled={false} limit={limit} planName={plan.name} />
                          <LocationRowActions storeId={storeId} location={location} />
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Répartition du stock"
          description="Déplacer une quantité d'un dépôt à l'autre ne change jamais le stock total : la contrepartie est prise sur le dépôt par défaut."
        />
        <CardBody>
          {locations.length < 2 ? (
            <p className="text-sm text-ink-muted">
              Créez un second dépôt pour répartir votre stock.{" "}
              <Link href={`/app/${storeId}/produits`} className="underline">
                Gérer le stock total
              </Link>
            </p>
          ) : items.length === 0 ? (
            <EmptyState icon={Warehouse} title="Aucun article réparti" description="Les articles suivis en stock apparaîtront ici après la migration des dépôts." />
          ) : (
            <Table minWidth={640}>
              <THead>
                <TR>
                  <TH>Article</TH>
                  {locations.map((l) => (
                    <TH key={l.id} align="right">
                      {l.name}
                    </TH>
                  ))}
                  <TH align="right">Total</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.itemKey}>
                    <TD>{item.label}</TD>
                    {locations.map((l) => {
                      const qty = item.perLocation.get(l.id) ?? 0;
                      return (
                        <TD key={l.id} align="right" className={`tabular ${qty < 0 ? "text-danger" : ""}`}>
                          {qty}
                        </TD>
                      );
                    })}
                    <TD align="right" className="tabular font-medium">
                      {[...item.perLocation.values()].reduce((s, v) => s + v, 0)}
                    </TD>
                    <TD align="right">
                      <AssignStockDialog storeId={storeId} item={{ itemKey: item.itemKey, productId: item.productId, variantId: item.variantId, label: item.label }} locations={locations.map((l) => ({ id: l.id, name: l.name, available: item.perLocation.get(l.id) ?? 0 }))} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
