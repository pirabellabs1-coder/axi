import type { Order } from "@prisma/client";

/**
 * Charge MINIMALE des événements de commande pour les webhooks (`emitDomainEvent`, équipe W, lot 2 §4.1) :
 * identifiants, statuts et montants uniquement. Aucune coordonnée personnelle (nom, téléphone, adresse) : un
 * point de webhook qui en a besoin relit la commande par l'API REST avec le scope adéquat.
 */
export type OrderEventData = {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  currency: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  taxTotal: number;
  taxesIncluded: boolean;
  total: number;
  amountDue: number;
  presentmentCurrency: string | null;
  presentmentTotal: number | null;
  channel: string;
  fulfillmentType: string;
  createdAt: string;
};

export function orderEventData(o: Pick<Order, "id" | "reference" | "status" | "paymentStatus" | "currency" | "subtotal" | "discount" | "deliveryFee" | "total" | "channel" | "fulfillmentType" | "createdAt"> & Partial<Pick<Order, "taxTotal" | "taxesIncluded" | "amountDue" | "presentmentCurrency" | "presentmentTotal">>): OrderEventData {
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    paymentStatus: o.paymentStatus,
    currency: o.currency,
    subtotal: o.subtotal,
    discount: o.discount,
    deliveryFee: o.deliveryFee,
    taxTotal: o.taxTotal ?? 0,
    taxesIncluded: o.taxesIncluded ?? true,
    total: o.total,
    amountDue: o.amountDue ?? o.total,
    presentmentCurrency: o.presentmentCurrency ?? null,
    presentmentTotal: o.presentmentTotal ?? null,
    channel: o.channel,
    fulfillmentType: o.fulfillmentType,
    createdAt: (o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt ?? Date.now())).toISOString(),
  };
}
