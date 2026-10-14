import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Package, Printer, Link2 } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { listLocations } from "@/lib/locations/service";
import { shippedQuantities } from "@/lib/shipping/service";
import { FULFILLMENT_STATUS_LABELS, SHIPMENT_STATUS_LABELS, nextShipmentStatuses, remainingToShip, type FulfillmentStatusValue, type ShipmentStatusValue } from "@/lib/shipping/state";
import { orderWeightGrams, missingWeightWarning } from "@/lib/shipping/rates";
import { ShipmentTimeline } from "@/components/app/shipment-timeline";
import { isValidMediaKey } from "@/lib/storage/keys";
import { getStorage } from "@/lib/storage";
import { CreateShipmentForm, RevokeCourierLink, ShipmentStatusForm } from "./expeditions-client";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Expéditions de la commande" };

const TONE: Record<ShipmentStatusValue, "neutral" | "info" | "success" | "warning" | "danger" | "primary"> = {
  PENDING: "neutral",
  LABEL_CREATED: "info",
  PICKED_UP: "info",
  IN_TRANSIT: "info",
  OUT_FOR_DELIVERY: "primary",
  DELIVERED: "success",
  FAILED_ATTEMPT: "warning",
  RETURNED: "warning",
  CANCELLED: "neutral",
};

/** URL publique d'une clé de média ; `null` si le stockage n'est pas configuré (jamais d'erreur de page). */
function mediaPublicUrl(key: string): string | null {
  try {
    return getStorage().publicUrl(key);
  } catch {
    return null;
  }
}

/**
 * Expéditions d'une commande (lot 3 §1.2) : expéditions partielles, étiquette interne imprimable,
 * lien de la page livreur, chronologie des événements et changements d'état contrôlés par la machine
 * d'états (`canTransitionShipment`).
 */
export default async function OrderShipmentsPage({ params }: { params: Promise<{ storeId: string; orderId: string }> }) {
  const { storeId, orderId } = await params;
  const ctx = await getStoreContext(storeId, "orders.manage");
  const plan = PLANS[ctx.planId];

  const order = await db.order.findFirst({
    where: { id: orderId, storeId: ctx.store.id },
    select: {
      id: true,
      reference: true,
      fulfillmentStatus: true,
      fulfillmentType: true,
      customerName: true,
      deliveryAddress: true,
      deliveryZoneName: true,
      items: {
        select: { id: true, name: true, variantName: true, quantity: true, kind: true, locationId: true, product: { select: { weightGrams: true } }, variant: { select: { weightGrams: true } } },
      },
    },
  });
  if (!order) notFound();

  const [shipments, carriers, locations, shipped] = await Promise.all([
    db.shipment.findMany({
      where: { orderId: order.id, storeId: ctx.store.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        carrier: true,
        status: true,
        trackingNumber: true,
        trackingUrl: true,
        courierName: true,
        courierPhone: true,
        courierToken: true,
        courierTokenExpiresAt: true,
        deliveryCodeHash: true,
        proofPhotoUrl: true,
        weightGrams: true,
        createdAt: true,
        location: { select: { name: true } },
        items: { select: { quantity: true, orderItem: { select: { id: true, name: true, variantName: true } } } },
        events: { orderBy: { occurredAt: "desc" }, take: 20, select: { id: true, status: true, message: true, locationLabel: true, source: true, occurredAt: true } },
      },
    }),
    db.carrierAccount.findMany({ where: { storeId: ctx.store.id, active: true }, select: { id: true, name: true, carrier: true } }),
    listLocations(ctx.store.id),
    shippedQuantities(db, order.id),
  ]);

  const shippableItems = order.items
    .filter((i) => i.kind === "PHYSICAL")
    .map((i) => ({ id: i.id, label: `${i.name}${i.variantName ? ` (${i.variantName})` : ""}`, remaining: remainingToShip(i.quantity, shipped.get(i.id) ?? 0), quantity: i.quantity }));
  const weight = orderWeightGrams(order.items.map((i) => ({ quantity: i.quantity, variantWeightGrams: i.variant?.weightGrams ?? null, productWeightGrams: i.product?.weightGrams ?? null, shippable: i.kind === "PHYSICAL" })));
  const warning = missingWeightWarning(weight.missingWeight);
  const fulfillment = order.fulfillmentStatus as FulfillmentStatusValue;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Expéditions — ${order.reference}`}
        description={`${FULFILLMENT_STATUS_LABELS[fulfillment]} · ${order.customerName}${order.deliveryZoneName ? ` · ${order.deliveryZoneName}` : ""}`}
        back={{ href: `/app/${storeId}/commandes/${order.id}`, label: "Commande" }}
      />

      {warning && <Alert tone="warning">{warning}</Alert>}

      <Card>
        <CardHeader title="Nouvelle expédition" description="Expédiez tout ou partie de la commande. Une commande peut comporter plusieurs expéditions." />
        <CardBody>
          {shippableItems.every((i) => i.remaining === 0) ? (
            <p className="text-sm text-ink-muted">Tous les articles physiques de cette commande sont déjà expédiés.</p>
          ) : (
            <CreateShipmentForm
              storeId={storeId}
              orderId={order.id}
              items={shippableItems}
              carriers={carriers}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              defaultLocationId={order.items.find((i) => i.locationId)?.locationId ?? null}
              canUseDeliveryCode={plan.features.couriers}
            />
          )}
        </CardBody>
      </Card>

      {shipments.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={Package} title="Aucune expédition" description="Créez une expédition pour imprimer l'étiquette et suivre la livraison." />
          </CardBody>
        </Card>
      ) : (
        shipments.map((shipment) => {
          const status = shipment.status as ShipmentStatusValue;
          const courierUrl = shipment.courierToken ? `/livraison/${shipment.courierToken}` : null;
          // `proofPhotoUrl` ne contient qu'une CLÉ interne du stockage (mineur n° 5) : l'URL publique est
          // dérivée par le pilote, et une valeur qui n'est pas une clé valide n'est jamais affichée.
          const proofUrl = isValidMediaKey(shipment.proofPhotoUrl ?? "") ? mediaPublicUrl(shipment.proofPhotoUrl!) : null;
          return (
            <Card key={shipment.id}>
              <CardHeader
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    Expédition {shipment.trackingNumber ?? shipment.id.slice(-6).toUpperCase()}
                    <Badge tone={TONE[status]}>{SHIPMENT_STATUS_LABELS[status]}</Badge>
                    {shipment.deliveryCodeHash && <Badge tone="accent">Code de remise</Badge>}
                  </span>
                }
                description={`${shipment.carrier === "manual" ? "Livreur interne" : shipment.carrier}${shipment.courierName ? ` · ${shipment.courierName}` : ""}${shipment.location ? ` · depuis ${shipment.location.name}` : ""} · créée le ${formatDateTime(shipment.createdAt)}`}
                action={
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink href={`/app/${storeId}/commandes/${order.id}/expeditions/${shipment.id}/etiquette`} variant="secondary" size="sm" className="h-11 sm:h-9">
                      <Printer className="size-4" aria-hidden /> Étiquette
                    </ButtonLink>
                  </div>
                }
              />
              <CardBody className="space-y-4">
                <ul className="text-sm text-ink-muted">
                  {shipment.items.map((item) => (
                    <li key={item.orderItem.id}>
                      {item.quantity} × {item.orderItem.name}
                      {item.orderItem.variantName ? ` (${item.orderItem.variantName})` : ""}
                    </li>
                  ))}
                </ul>
                {courierUrl ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      <Link href={courierUrl} className="inline-flex items-center gap-1.5 underline" target="_blank" rel="noreferrer">
                        <Link2 className="size-4" aria-hidden /> Lien livreur
                      </Link>
                      <span className="text-ink-muted"> — à envoyer au livreur{shipment.courierTokenExpiresAt ? `, valable jusqu'au ${formatDateTime(shipment.courierTokenExpiresAt)}` : ""}.</span>
                    </p>
                    {/* Mineur n° 6 : le lien donne accès, sans compte, à l'adresse et au téléphone du
                        client — il doit pouvoir être coupé sans attendre les 7 jours d'expiration. */}
                    <RevokeCourierLink storeId={storeId} shipmentId={shipment.id} />
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">Lien livreur révoqué ou purgé : plus aucun accès par jeton.</p>
                )}
                {proofUrl && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-ink">Preuve de remise</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proofUrl} alt={`Photo de preuve de remise de l'expédition ${shipment.id.slice(-6).toUpperCase()}`} className="max-h-64 w-auto rounded-[var(--radius-md)] ring-1 ring-inset ring-line" loading="lazy" />
                    <p className="text-xs text-ink-muted">Photo téléversée par le livreur dans le stockage de la plateforme (aucune URL extérieure n&apos;est acceptée).</p>
                  </div>
                )}
                <ShipmentTimeline events={shipment.events.map((e) => ({ id: e.id, status: e.status as ShipmentStatusValue, message: e.message, locationLabel: e.locationLabel, source: e.source, occurredAt: e.occurredAt.toISOString() }))} />
                <ShipmentStatusForm storeId={storeId} shipmentId={shipment.id} options={[...nextShipmentStatuses(status)]} />
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
