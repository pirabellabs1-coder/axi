import "server-only";
import { db, type Tx } from "@/lib/db";
import { recordStockChangeTx } from "@/lib/inventory/levels";
import { hmacSha256, numericCode, requireAppSecret, safeEqual } from "@/lib/crypto";
import { randomToken } from "@/lib/utils";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { getCarrierAdapter } from "@/lib/carriers/registry";
import {
  applyCarrierStatus,
  canTransitionShipment,
  fulfillmentStatusOf,
  isTerminalShipmentStatus,
  orderStatusFromShipments,
  remainingToShip,
  shippedByItem,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatusValue,
} from "./state";
import { courierTokenExpiry, MAX_DELIVERY_CODE_ATTEMPTS } from "./courier-code";

/**
 * Expéditions (lot 3 §1.2) : création partielle, événements (manuels, livreur, webhook, relève),
 * avancement de la commande et preuve de remise.
 *
 * Invariants :
 *  - `canTransitionShipment` est la seule porte d'entrée des changements d'état ;
 *  - un événement transporteur tardif ou rejoué ne rétrograde jamais l'expédition (`applyCarrierStatus`)
 *    et ne crée jamais de doublon (unicité `(shipmentId, providerEventId)`) ;
 *  - `Order.fulfillmentStatus` est TOUJOURS recalculé depuis les expéditions vivantes (jamais déduit) ;
 *  - jeton livreur et code de remise aléatoires, hachés, expirables et limités en essais.
 */

export class ShippingError extends Error {}

/**
 * Empreinte du code de remise : HMAC lié à l'expédition (un code n'est pas réutilisable ailleurs).
 * `requireAppSecret()` lève si le secret est absent ou factice : un HMAC à clé vide serait
 * reproductible hors ligne, donc le code à 4 chiffres serait devinable sans essai (mineur n° 12).
 */
export function deliveryCodeFingerprint(shipmentId: string, code: string): string {
  return hmacSha256(requireAppSecret(), `shipment:${shipmentId}:${code}`);
}

export function matchesDeliveryCode(shipmentId: string, code: string, expectedHash: string | null): boolean {
  if (!expectedHash) return false;
  return safeEqual(deliveryCodeFingerprint(shipmentId, code), expectedHash);
}

export type ShipmentItemInput = { orderItemId: string; quantity: number };

export type CreateShipmentInput = {
  storeId: string;
  orderId: string;
  carrierAccountId?: string | null;
  carrier: string;
  service?: string | null;
  locationId?: string | null;
  courierName?: string | null;
  courierPhone?: string | null;
  weightGrams?: number | null;
  cost?: number | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  items: ShipmentItemInput[];
  actorId?: string | null;
  /** Génère un code de remise à 4 chiffres (renvoyé UNE SEULE FOIS, à transmettre à l'acheteur). */
  withDeliveryCode?: boolean;
};

export type CreatedShipment = { id: string; deliveryCode: string | null; courierToken: string };

/** Quantités déjà expédiées d'une commande (expéditions annulées exclues). */
export async function shippedQuantities(client: Tx | typeof db, orderId: string): Promise<Map<string, number>> {
  const rows = await client.shipmentItem.findMany({
    where: { shipment: { orderId } },
    select: { orderItemId: true, quantity: true, shipment: { select: { status: true } } },
  });
  return shippedByItem(rows.map((r) => ({ orderItemId: r.orderItemId, quantity: r.quantity, status: r.shipment.status as ShipmentStatusValue })));
}

/** Recalcule et enregistre `Order.fulfillmentStatus` depuis les expéditions vivantes. */
export async function syncOrderFulfillmentTx(tx: Tx, p: { storeId: string; orderId: string }): Promise<"UNFULFILLED" | "PARTIAL" | "FULFILLED"> {
  const items = await tx.orderItem.findMany({ where: { orderId: p.orderId }, select: { id: true, quantity: true, kind: true } });
  const shipmentItems = await tx.shipmentItem.findMany({
    where: { shipment: { orderId: p.orderId } },
    select: { orderItemId: true, quantity: true, shipment: { select: { status: true } } },
  });
  const status = fulfillmentStatusOf(
    // Les lignes sans expédition (numérique, service, carte cadeau) ne comptent pas dans l'avancement.
    items.filter((i) => i.kind === "PHYSICAL").map((i) => ({ orderItemId: i.id, quantity: i.quantity })),
    shipmentItems.map((s) => ({ orderItemId: s.orderItemId, quantity: s.quantity, status: s.shipment.status as ShipmentStatusValue })),
  );
  await tx.order.updateMany({ where: { id: p.orderId, storeId: p.storeId }, data: { fulfillmentStatus: status } });
  return status;
}

/**
 * Crée une expédition (partielle possible) : quantités bornées au reste à expédier, jeton livreur,
 * code de remise optionnel, premier événement PENDING, avancement de la commande recalculé.
 */
export async function createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
  const deliveryCode = input.withDeliveryCode ? numericCode(4) : null;
  const courierToken = randomToken(24);

  const created = await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, storeId: input.storeId },
      select: { id: true, reference: true, status: true, items: { select: { id: true, quantity: true, kind: true, locationId: true } } },
    });
    if (!order) throw new ShippingError("Commande introuvable.");
    const shipped = await shippedQuantities(tx, order.id);

    const lines: ShipmentItemInput[] = [];
    for (const line of input.items) {
      const item = order.items.find((i) => i.id === line.orderItemId);
      if (!item) throw new ShippingError("Une ligne n'appartient pas à cette commande.");
      if (item.kind !== "PHYSICAL") continue; // rien à expédier
      const left = remainingToShip(item.quantity, shipped.get(item.id) ?? 0);
      const qty = Math.min(Math.max(0, Math.trunc(line.quantity)), left);
      if (qty > 0) lines.push({ orderItemId: item.id, quantity: qty });
    }
    if (!lines.length) throw new ShippingError("Aucune quantité à expédier : tout est déjà expédié.");

    const locationId = input.locationId ?? order.items.find((i) => i.locationId)?.locationId ?? null;
    const shipment = await tx.shipment.create({
      data: {
        storeId: input.storeId,
        orderId: order.id,
        locationId,
        carrierAccountId: input.carrierAccountId ?? null,
        carrier: input.carrier,
        service: input.service ?? null,
        status: "PENDING",
        trackingNumber: input.trackingNumber ?? null,
        trackingUrl: input.trackingUrl ?? null,
        cost: input.cost ?? null,
        weightGrams: input.weightGrams ?? null,
        courierName: input.courierName ?? null,
        courierPhone: input.courierPhone ?? null,
        courierToken,
        courierTokenExpiresAt: courierTokenExpiry(),
        items: { create: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })) },
        events: { create: [{ status: "PENDING", source: "manual", message: "Expédition créée", occurredAt: new Date() }] },
      },
      select: { id: true },
    });
    if (deliveryCode) {
      await tx.shipment.update({ where: { id: shipment.id }, data: { deliveryCodeHash: deliveryCodeFingerprint(shipment.id, deliveryCode) } });
    }
    await syncOrderFulfillmentTx(tx, { storeId: input.storeId, orderId: order.id });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        actorId: input.actorId ?? null,
        actorLabel: "Commerçant",
        type: "note",
        message: `Expédition créée (${lines.reduce((s, l) => s + l.quantity, 0)} article${lines.reduce((s, l) => s + l.quantity, 0) > 1 ? "s" : ""}, ${input.carrier}).`,
      },
    });
    await enqueue("shipment.status_changed", { shipmentId: shipment.id, status: "PENDING" }, { storeId: input.storeId }, tx);
    await audit({ storeId: input.storeId, actorId: input.actorId ?? null, action: "shipment.created", target: shipment.id, metadata: { orderId: order.id, carrier: input.carrier, lines: lines.length } }, tx);
    return shipment.id;
  });

  return { id: created, deliveryCode, courierToken };
}

/**
 * Remise en stock d'une expédition RETOURNÉE (majeur n° 7) : chaque unité expédiée est recréditée au
 * dépôt qui l'a servie (`OrderItem.locationId`, sinon le dépôt de l'expédition) — agrégat ET niveau,
 * dans la transaction de l'appelant (`recordStockChangeTx`).
 *
 * IDEMPOTENT : un mouvement `RETURN` portant la référence de l'expédition suffit à ne jamais recréditer
 * deux fois (rejeu d'un webhook, double clic du commerçant). Seuls les articles PHYSIQUES dont le stock
 * est SUIVI sont touchés ; une variante supprimée depuis est ignorée.
 */
async function restockReturnedShipmentTx(
  tx: Tx,
  shipment: { id: string; storeId: string; orderId: string; locationId: string | null; actorId: string | null },
): Promise<number> {
  const note = `Retour expédition ${shipment.id}`;
  const already = await tx.inventoryMovement.findFirst({
    where: { storeId: shipment.storeId, orderId: shipment.orderId, reason: "RETURN", note: { contains: shipment.id } },
    select: { id: true },
  });
  if (already) return 0;

  const items = await tx.shipmentItem.findMany({
    where: { shipmentId: shipment.id },
    select: { quantity: true, orderItem: { select: { productId: true, variantId: true, locationId: true, kind: true } } },
  });
  // Le produit d'une ligne peut avoir été supprimé (`OrderItem.productId` nullable) : rien à recréditer.
  const lines = items.flatMap((i) =>
    i.quantity > 0 && i.orderItem?.productId && (i.orderItem.kind ?? "PHYSICAL") === "PHYSICAL"
      ? [{ quantity: i.quantity, productId: i.orderItem.productId, variantId: i.orderItem.variantId, locationId: i.orderItem.locationId }]
      : [],
  );
  if (!lines.length) return 0;

  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.productId))] }, storeId: shipment.storeId },
    select: { id: true, trackStock: true, variants: { select: { id: true } } },
  });

  let restocked = 0;
  for (const item of lines) {
    const product = products.find((p) => p.id === item.productId);
    if (!product?.trackStock) continue;
    // Variante supprimée depuis la vente : ne pas gonfler le stock d'une autre ligne.
    if (item.variantId && !product.variants.some((v) => v.id === item.variantId)) continue;
    if (!item.variantId && product.variants.length > 0) continue;
    await recordStockChangeTx(tx, {
      storeId: shipment.storeId,
      locationId: item.locationId ?? shipment.locationId ?? null,
      productId: item.productId,
      variantId: item.variantId,
      delta: item.quantity,
      reason: "RETURN",
      note,
      orderId: shipment.orderId,
      actorId: shipment.actorId,
    });
    restocked += item.quantity;
  }
  return restocked;
}

export type ShipmentEventSource = "manual" | "courier" | "webhook" | "poll";

export type RecordEventInput = {
  storeId?: string | null;
  shipmentId: string;
  status: ShipmentStatusValue;
  source: ShipmentEventSource;
  message?: string | null;
  locationLabel?: string | null;
  providerEventId?: string | null;
  occurredAt?: Date;
  actorId?: string | null;
  /** Transition demandée par un humain : exige une transition AUTORISÉE (pas de saut d'étape). */
  strict?: boolean;
};

export type RecordEventResult = { applied: boolean; status: ShipmentStatusValue; reason?: "duplicate" | "ignored" | "forbidden" };

/**
 * Enregistre un événement d'expédition, de façon idempotente et sans rétrogradation.
 *  - `providerEventId` déjà vu → ignoré (`duplicate`) ;
 *  - statut non recevable (rang inférieur, état terminal) → événement journalisé, statut inchangé ;
 *  - `strict` (action du commerçant ou du livreur) → transition refusée si elle n'est pas déclarée.
 */
export async function recordShipmentEvent(input: RecordEventInput): Promise<RecordEventResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const outcome = await db.$transaction(async (tx) => {
    const shipment = await tx.shipment.findFirst({
      where: { id: input.shipmentId, ...(input.storeId ? { storeId: input.storeId } : {}) },
      select: { id: true, storeId: true, orderId: true, status: true, carrier: true, locationId: true },
    });
    if (!shipment) throw new ShippingError("Expédition introuvable.");
    const current = shipment.status as ShipmentStatusValue;

    if (input.providerEventId) {
      const seen = await tx.shipmentEvent.findFirst({ where: { shipmentId: shipment.id, providerEventId: input.providerEventId }, select: { id: true } });
      if (seen) return { applied: false, status: current, reason: "duplicate" as const };
    }

    const next = input.strict
      ? canTransitionShipment(current, input.status)
        ? input.status
        : null
      : applyCarrierStatus(current, input.status);

    // L'événement est toujours journalisé (traçabilité), même s'il ne change pas le statut.
    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: input.status,
        source: input.source,
        message: input.message?.slice(0, 500) ?? null,
        locationLabel: input.locationLabel?.slice(0, 120) ?? null,
        providerEventId: input.providerEventId ?? null,
        occurredAt,
      },
    });
    if (!next) {
      return { applied: false, status: current, reason: (input.strict ? "forbidden" : "ignored") as "forbidden" | "ignored" };
    }

    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: next,
        ...(next === "DELIVERED" ? { deliveredAt: occurredAt } : {}),
        ...(next === "FAILED_ATTEMPT" ? { deliveryAttempts: { increment: 1 } } : {}),
      },
    });
    // Majeur n° 7 : une expédition RETOURNÉE revient physiquement en stock, dans la MÊME transaction
    // que le changement d'état, et une seule fois (rejeu d'un événement transporteur).
    const restocked = next === "RETURNED" ? await restockReturnedShipmentTx(tx, { ...shipment, actorId: input.actorId ?? null }) : 0;
    await syncOrderFulfillmentTx(tx, { storeId: shipment.storeId, orderId: shipment.orderId });
    if (restocked > 0) {
      await tx.orderEvent.create({
        data: {
          orderId: shipment.orderId,
          actorId: input.actorId ?? null,
          actorLabel: "Système",
          type: "note",
          message: `Retour d'expédition : ${restocked} article${restocked > 1 ? "s" : ""} remis en stock.`,
        },
      });
    }
    await tx.orderEvent.create({
      data: {
        orderId: shipment.orderId,
        actorId: input.actorId ?? null,
        actorLabel: input.source === "courier" ? "Livreur" : input.source === "webhook" || input.source === "poll" ? "Transporteur" : "Commerçant",
        type: "note",
        message: `Expédition : ${SHIPMENT_STATUS_LABELS[next]}${input.message ? ` — ${input.message.slice(0, 200)}` : ""}`,
      },
    });
    await enqueue("shipment.status_changed", { shipmentId: shipment.id, status: next }, { storeId: shipment.storeId }, tx);

    // Avancement de la commande : toutes les expéditions livrées → DELIVERED ; une en livraison → OUT_FOR_DELIVERY.
    const siblings = await tx.shipment.findMany({ where: { orderId: shipment.orderId }, select: { status: true } });
    const target = orderStatusFromShipments(siblings.map((s) => s.status as ShipmentStatusValue));
    return { applied: true, status: next, orderTarget: target, orderId: shipment.orderId, storeId: shipment.storeId };
  });

  if ("orderTarget" in outcome && outcome.orderTarget) {
    // Hors transaction : la transition de commande a ses propres effets (fidélité, notifications) et ne
    // doit jamais faire échouer l'enregistrement de l'événement d'expédition.
    try {
      const { transitionOrder } = await import("@/lib/commerce/orders");
      await transitionOrder({
        orderId: outcome.orderId!,
        storeId: outcome.storeId!,
        to: outcome.orderTarget,
        actorId: input.actorId ?? null,
        actorLabel: "Expédition",
        reason: "Avancement des expéditions",
      });
    } catch {
      // Transition non permise depuis l'état courant (ex. commande non confirmée) : sans conséquence.
    }
  }
  return { applied: outcome.applied, status: outcome.status, reason: "reason" in outcome ? outcome.reason : undefined };
}

/** Annule une expédition (PENDING ou LABEL_CREATED) et prévient le transporteur si une API est branchée. */
export async function cancelShipment(p: { storeId: string; shipmentId: string; actorId?: string | null }): Promise<void> {
  const shipment = await db.shipment.findFirst({
    where: { id: p.shipmentId, storeId: p.storeId },
    select: { id: true, status: true, carrier: true, providerRef: true, carrierAccount: { select: { credentialsEncrypted: true } } },
  });
  if (!shipment) throw new ShippingError("Expédition introuvable.");
  if (isTerminalShipmentStatus(shipment.status as ShipmentStatusValue)) throw new ShippingError("Cette expédition est déjà clôturée.");
  if (!canTransitionShipment(shipment.status as ShipmentStatusValue, "CANCELLED")) {
    throw new ShippingError("Une expédition déjà partie ne s'annule pas : marquez-la « Retournée » à son retour.");
  }
  if (shipment.providerRef) {
    try {
      const adapter = getCarrierAdapter(shipment.carrier);
      const { carrierCredentials } = await import("@/lib/carriers/registry");
      await adapter.cancel(shipment.providerRef, carrierCredentials(shipment.carrierAccount?.credentialsEncrypted));
    } catch {
      // Le transporteur n'a pas pu être prévenu : l'annulation locale reste valable (trace dans l'événement).
    }
  }
  await recordShipmentEvent({ storeId: p.storeId, shipmentId: p.shipmentId, status: "CANCELLED", source: "manual", strict: true, actorId: p.actorId, message: "Expédition annulée" });
  await audit({ storeId: p.storeId, actorId: p.actorId ?? null, action: "shipment.cancelled", target: p.shipmentId });
}

/** Essais restants du code de remise (page livreur). */
export function remainingCodeAttempts(attempts: number): number {
  return Math.max(0, MAX_DELIVERY_CODE_ATTEMPTS - Math.max(0, Math.trunc(attempts)));
}
