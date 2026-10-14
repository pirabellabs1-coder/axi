import "server-only";
import { db } from "@/lib/db";
import { queueNotification, type JobHandlers } from "@/lib/jobs";
import { getCarrierAdapter, carrierCredentials } from "@/lib/carriers/registry";
import { recordShipmentEvent } from "./service";
import { isTerminalShipmentStatus, SHIPMENT_STATUS_LABELS, type ShipmentStatusValue } from "./state";

/**
 * Jobs de l'expédition (lot 3 §4) :
 *  - `shipment.status_changed` : information de l'acheteur (lien de suivi) ;
 *  - `shipment.poll` : relève des transporteurs SANS webhook (repli), bornée et idempotente
 *    (les événements déjà vus sont ignorés par `(shipmentId, providerEventId)`).
 */

const POLL_LIMIT = 50;

export const handlers: JobHandlers = {
  "shipment.status_changed": async (payload) => {
    const shipmentId = typeof payload.shipmentId === "string" ? payload.shipmentId : null;
    if (!shipmentId) return;
    const shipment = await db.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        storeId: true,
        status: true,
        trackingNumber: true,
        order: { select: { reference: true, customerEmail: true, trackingToken: true } },
        store: { select: { name: true } },
      },
    });
    if (!shipment) return;
    const status = shipment.status as ShipmentStatusValue;
    // Une expédition qui vient d'être créée n'intéresse pas encore l'acheteur.
    if (status === "PENDING") return;
    if (!shipment.order.customerEmail) return;
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await queueNotification(shipment.storeId, "email", shipment.order.customerEmail, "customer.shipment_status", {
      subject: `Commande ${shipment.order.reference} : ${SHIPMENT_STATUS_LABELS[status].toLowerCase()}`,
      text: `Votre commande ${shipment.order.reference} chez ${shipment.store.name} : ${SHIPMENT_STATUS_LABELS[status]}.${shipment.trackingNumber ? `\nNuméro de suivi : ${shipment.trackingNumber}.` : ""}\n\nSuivre : ${base}/suivi/${shipment.order.trackingToken}`,
    });
  },

  "shipment.poll": async (payload, job) => {
    const storeId = typeof payload.storeId === "string" ? payload.storeId : job.storeId;
    const shipments = await db.shipment.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED"] },
        providerRef: { not: null },
        carrierAccount: { isNot: null },
      },
      take: POLL_LIMIT,
      orderBy: { updatedAt: "asc" },
      select: { id: true, storeId: true, status: true, carrier: true, providerRef: true, carrierAccount: { select: { credentialsEncrypted: true, active: true } } },
    });
    for (const shipment of shipments) {
      if (!shipment.providerRef || shipment.carrierAccount?.active === false) continue;
      if (isTerminalShipmentStatus(shipment.status as ShipmentStatusValue)) continue;
      const adapter = getCarrierAdapter(shipment.carrier);
      if (!adapter.implemented) continue; // point d'intégration non branché : rien à relever
      try {
        const events = await adapter.track(shipment.providerRef, carrierCredentials(shipment.carrierAccount?.credentialsEncrypted));
        for (const event of events) {
          await recordShipmentEvent({
            storeId: shipment.storeId,
            shipmentId: shipment.id,
            status: event.status,
            source: "poll",
            message: event.message ?? null,
            locationLabel: event.locationLabel ?? null,
            providerEventId: event.providerEventId ?? null,
            occurredAt: event.occurredAt,
          });
        }
      } catch (e) {
        // Transporteur indisponible : on réessaiera au prochain passage (jamais d'échec visible à l'acheteur).
        console.error("[shipment.poll]", shipment.id, e);
      }
    }
  },
};
