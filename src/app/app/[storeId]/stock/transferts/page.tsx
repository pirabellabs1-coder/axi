import type { Metadata } from "next";
import { ArrowRightLeft } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { listLocations } from "@/lib/locations/service";
import { TRANSFER_STATUS_LABELS, type TransferStatusValue } from "@/lib/inventory/transfer";
import { formatDateTime } from "@/lib/utils";
import { TransferDialog, TransferRowActions } from "./transferts-client";

export const metadata: Metadata = { title: "Transferts de stock" };

const TONE: Record<TransferStatusValue, "neutral" | "info" | "success" | "warning"> = {
  DRAFT: "neutral",
  IN_TRANSIT: "info",
  RECEIVED: "success",
  CANCELLED: "warning",
};

/**
 * Transferts de stock entre dépôts (lot 3 §1.1). Une marchandise en transit a quitté le dépôt source
 * sans être encore reçue : elle reste dans le stock total de la boutique (invariant « total = Σ dépôts
 * + en transit »).
 */
export default async function TransfersPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const plan = PLANS[ctx.planId];

  if (!plan.features.stockTransfers) {
    return (
      <div className="space-y-6">
        <PageHeader title="Transferts de stock" description="Déplacez du stock d'un dépôt à l'autre, avec contrôle à la réception." back={{ href: `/app/${storeId}/depots`, label: "Dépôts" }} />
        <PlanGate feature="stockTransfers" storeId={storeId} />
      </div>
    );
  }

  const [locations, transfers, levels] = await Promise.all([
    listLocations(ctx.store.id),
    db.stockTransfer.findMany({
      where: { storeId: ctx.store.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        reference: true,
        status: true,
        createdAt: true,
        shippedAt: true,
        receivedAt: true,
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        items: { select: { id: true, quantity: true, receivedQuantity: true, productId: true, variantId: true } },
      },
    }),
    db.inventoryLevel.findMany({
      where: { storeId: ctx.store.id },
      take: 300,
      select: { locationId: true, itemKey: true, productId: true, variantId: true, available: true, product: { select: { name: true } }, variant: { select: { name: true } } },
    }),
  ]);

  const stockByLocation = locations.map((l) => ({
    id: l.id,
    name: l.name,
    items: levels
      .filter((x) => x.locationId === l.id)
      .map((x) => ({ productId: x.productId, variantId: x.variantId, label: `${x.product.name}${x.variant ? ` (${x.variant.name})` : ""}`, available: x.available }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"))
      .slice(0, 60),
  }));
  const itemLabels = new Map(levels.map((x) => [x.itemKey, `${x.product.name}${x.variant ? ` (${x.variant.name})` : ""}`]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transferts de stock"
        description="Expédiez du stock d'un dépôt à l'autre, puis contrôlez les quantités reçues. L'écart est déclaré en perte, avec motif."
        back={{ href: `/app/${storeId}/depots`, label: "Dépôts" }}
        actions={<TransferDialog storeId={storeId} locations={stockByLocation} />}
      />

      <Card>
        <CardBody>
          {transfers.length === 0 ? (
            <EmptyState icon={ArrowRightLeft} title="Aucun transfert" description="Créez un transfert pour déplacer du stock entre deux dépôts." action={<TransferDialog storeId={storeId} locations={stockByLocation} />} />
          ) : (
            <Table minWidth={760}>
              <THead>
                <TR>
                  <TH>Référence</TH>
                  <TH>Trajet</TH>
                  <TH>État</TH>
                  <TH align="right">Articles</TH>
                  <TH>Dates</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {transfers.map((transfer) => {
                  const status = transfer.status as TransferStatusValue;
                  const units = transfer.items.reduce((s, i) => s + i.quantity, 0);
                  return (
                    <TR key={transfer.id}>
                      <TD className="font-medium text-ink">{transfer.reference}</TD>
                      <TD>
                        {transfer.fromLocation.name} → {transfer.toLocation.name}
                      </TD>
                      <TD>
                        <Badge tone={TONE[status]}>{TRANSFER_STATUS_LABELS[status]}</Badge>
                      </TD>
                      <TD align="right" className="tabular">
                        {units}
                      </TD>
                      <TD className="text-sm text-ink-muted">
                        créé {formatDateTime(transfer.createdAt)}
                        {transfer.shippedAt && <span className="block">expédié {formatDateTime(transfer.shippedAt)}</span>}
                        {transfer.receivedAt && <span className="block">reçu {formatDateTime(transfer.receivedAt)}</span>}
                      </TD>
                      <TD align="right">
                        <TransferRowActions
                          storeId={storeId}
                          transfer={{
                            id: transfer.id,
                            reference: transfer.reference,
                            status,
                            items: transfer.items.map((i) => ({ id: i.id, label: itemLabels.get(i.variantId ?? i.productId) ?? "Article", quantity: i.quantity })),
                          }}
                        />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
