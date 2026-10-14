import "server-only";
import type { FulfillmentType, Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { loadTaxSettings } from "./checkout-context";
import { TAX_STORE_SELECT } from "@/lib/tax/settings";
import { orderEventData } from "./domain-events";
import { randomReference, randomToken, addDays } from "@/lib/utils";
import { priceCart } from "./checkout-pipeline";
import { CheckoutError, createOrderItemsTx, resolveLinesTx, type CheckoutItemInput } from "./checkout-lines";

/**
 * Commande d'échange (retours, spécification lot 1 §4 « RESOLVED → EXCHANGE »). CONTRAT figé pour l'équipe D.
 *
 *   createExchangeOrder(tx, args) → ExchangeOrderResult
 *
 * À appeler DANS la transaction qui résout le retour (après `updateMany where status = from`) :
 *  - canal MANUAL, prix COURANTS (pipeline sans remise automatique ni coupon), stock décrémenté (conditionnel) ;
 *  - mode et adresse de la commande d'origine, livraison offerte (frais 0) ; DIGITAL refusé ;
 *  - la valeur des articles retournés (`credit`) devient un tender « avoir d'échange » MATÉRIALISÉ : min(crédit, total)
 *    est crédité en avoir (REFUND_TO_CREDIT) puis débité sur la commande d'échange (REDEEM, PaymentAttempt
 *    `store_credit`) ; annuler ou rembourser la commande d'échange le rend donc au client ;
 *  - options des articles reprises par NOM (`optionNames`, comme « Commander à nouveau ») ;
 *  - `amountDue` = total − crédit appliqué (différence positive due par l'acheteur ; commande PAID si 0) ;
 *  - `surplus` = crédit − total si positif : à verser par l'APPELANT en avoir (`grantTx` REFUND_TO_CREDIT) ou en
 *    remboursement (`requestRefund`) ; cette fonction ne le fait pas ;
 *  - idempotent par `idempotencyKey` (défaut `exchange:{returnId}`) : un second appel renvoie la même commande ;
 *  - lève `CheckoutError` (message lisible) : article indisponible, stock insuffisant, commande d'origine introuvable.
 * Le rattachement `ReturnRequest.exchangeOrderId` reste à la charge de l'appelant (équipe D).
 */

export type ExchangeOrderArgs = {
  storeId: string;
  /** Commande d'origine (même boutique) : client, mode et adresse repris. */
  sourceOrderId: string;
  /** Retour à l'origine de l'échange (référence logique, notée dans l'historique et l'attribution). */
  returnId: string;
  /** Articles de remplacement (prix courants, options et variantes contrôlées comme au checkout). */
  items: (CheckoutItemInput & { optionNames?: string[] })[];
  /** Valeur des articles retournés (« avoir d'échange »), en unités entières de la devise (≥ 0). */
  credit: number;
  actorId?: string | null;
  actorLabel: string;
  /** Défaut : celui de la commande d'origine (DIGITAL et WHATSAPP → PICKUP). */
  fulfillmentType?: Exclude<FulfillmentType, "DIGITAL">;
  idempotencyKey?: string;
  note?: string | null;
};

export type ExchangeOrderResult = {
  orderId: string;
  reference: string;
  trackingToken: string;
  total: number;
  /** Part du crédit d'échange utilisée comme tender. */
  creditApplied: number;
  amountDue: number;
  /** Crédit non utilisé (> 0 si les articles retournés valaient plus que le remplacement). */
  surplus: number;
  duplicate: boolean;
};

export async function createExchangeOrder(tx: Tx, args: ExchangeOrderArgs): Promise<ExchangeOrderResult> {
  if (!Number.isInteger(args.credit) || args.credit < 0) throw new CheckoutError("Montant de l'échange invalide.");
  if (args.items.length === 0) throw new CheckoutError("Choisissez au moins un article de remplacement.");
  if (args.items.length > 50) throw new CheckoutError("Trop d'articles dans l'échange.");
  const idempotencyKey = (args.idempotencyKey ?? `exchange:${args.returnId}`).slice(0, 64);

  const original = await tx.order.findFirst({
    where: { id: args.sourceOrderId, storeId: args.storeId },
    select: { id: true, reference: true, customerId: true, customerName: true, customerPhone: true, customerEmail: true, fulfillmentType: true, deliveryAddress: true, deliveryZoneId: true, deliveryZoneName: true, currency: true },
  });
  if (!original) throw new CheckoutError("Commande d'origine introuvable.");

  const existing = await tx.order.findUnique({ where: { storeId_idempotencyKey: { storeId: args.storeId, idempotencyKey } } });
  if (existing) {
    const applied = Math.max(0, existing.total - (existing.amountDue ?? existing.total));
    return { orderId: existing.id, reference: existing.reference, trackingToken: existing.trackingToken, total: existing.total, creditApplied: applied, amountDue: existing.amountDue ?? existing.total, surplus: Math.max(0, args.credit - applied), duplicate: true };
  }

  const actorId = args.actorId || null;
  const now = new Date();
  const lines = await resolveLinesTx(tx, { storeId: args.storeId, items: await withOptionIds(tx, args.storeId, args.items), now, revealStock: true, collections: new Map() });
  if (lines.some((l) => l.isGiftCard)) throw new CheckoutError("Une carte cadeau ne peut pas être obtenue en échange.");

  const fulfillmentType: FulfillmentType = args.fulfillmentType ?? (original.fulfillmentType === "DELIVERY" ? "DELIVERY" : "PICKUP");
  // Prix courants, sans remise ; livraison offerte pour un échange. Lot 2 : taxes de la boutique (nouvelle vente).
  const taxStore = await tx.store.findUnique({ where: { id: args.storeId }, select: TAX_STORE_SELECT });
  const tax = taxStore ? await loadTaxSettings(tx, taxStore) : null;
  const priced = priceCart({ lines, delivery: { type: "PICKUP" }, now, currency: original.currency, tax });
  const creditApplied = Math.min(args.credit, priced.total);
  const amountDue = priced.total - creditApplied;
  const surplus = args.credit - creditApplied;

  // Le crédit d'échange est MATÉRIALISÉ en avoir (crédit puis débit sur la commande d'échange) : annuler ou
  // rembourser la commande d'échange rend ce crédit au client par les mécanismes normaux (REVERSAL d'avoir).
  let customerId = original.customerId;
  if (creditApplied > 0 && !customerId) {
    const c = await tx.customer.upsert({
      where: { storeId_phone: { storeId: args.storeId, phone: original.customerPhone } },
      create: { storeId: args.storeId, phone: original.customerPhone, name: original.customerName, email: original.customerEmail },
      update: {},
      select: { id: true },
    });
    customerId = c.id;
  }

  let reference = randomReference("AX");
  for (let i = 0; i < 5; i++) {
    const clash = await tx.order.findUnique({ where: { storeId_reference: { storeId: args.storeId, reference } } });
    if (!clash) break;
    reference = randomReference("AX");
  }

  const order = await tx.order.create({
    data: {
      storeId: args.storeId,
      customerId,
      reference,
      idempotencyKey,
      trackingToken: randomToken(24),
      trackingExpiresAt: addDays(now, 90),
      fulfillmentType,
      channel: "MANUAL",
      customerName: original.customerName,
      customerPhone: original.customerPhone,
      customerEmail: original.customerEmail,
      deliveryAddress: fulfillmentType === "DELIVERY" ? original.deliveryAddress : null,
      deliveryZoneId: fulfillmentType === "DELIVERY" ? original.deliveryZoneId : null,
      deliveryZoneName: fulfillmentType === "DELIVERY" ? original.deliveryZoneName : null,
      currency: original.currency,
      subtotal: priced.subtotal,
      discount: 0,
      deliveryFee: 0,
      total: priced.total,
      taxTotal: priced.taxTotal,
      taxesIncluded: priced.taxesIncluded,
      taxLines: priced.taxLines.length ? (priced.taxLines as unknown as Prisma.InputJsonValue) : undefined,
      amountDue,
      storeCreditAmount: creditApplied,
      paymentStatus: amountDue === 0 ? "PAID" : "UNPAID",
      paymentMethodLabel: amountDue === 0 ? "Avoir d'échange" : null,
      attribution: { exchange: { returnId: args.returnId, originalOrderId: original.id } },
      events: {
        create: [
          { actorId: actorId, actorLabel: args.actorLabel, type: "status_changed", toValue: "NEW", message: `Commande d'échange (retour de la commande ${original.reference})` },
          { actorId: actorId, actorLabel: "Système", type: "note", message: `Avoir d'échange : ${creditApplied} ${original.currency}. Reste à payer : ${amountDue} ${original.currency}.${args.note ? ` ${args.note}`.slice(0, 300) : ""}` },
        ],
      },
    },
  });
  await createOrderItemsTx(tx, { storeId: args.storeId, orderId: order.id, lines: lines.map((l, i) => ({ ...l, discountAllocated: 0, taxAmount: priced.lines[i].taxAmount, taxRateBps: priced.lines[i].taxRateBps })), actorId: actorId });

  if (creditApplied > 0 && customerId) {
    const { grantTx, redeemStoreCreditTx } = await import("@/lib/store-credit/service");
    await grantTx(tx, { storeId: args.storeId, customerId, amount: creditApplied, kind: "REFUND_TO_CREDIT", orderId: original.id, returnId: args.returnId, actorId, note: `Avoir d'échange (commande ${order.reference})` });
    await redeemStoreCreditTx(tx, args.storeId, customerId, creditApplied, { orderId: order.id, actorId, note: `Avoir d'échange, retour de ${original.reference}` });
  }
  await enqueue("order.created", { orderId: order.id }, { storeId: args.storeId }, tx);
  await emitDomainEvent(tx, args.storeId, "order.created", orderEventData(order));
  if (amountDue === 0 && priced.total > 0) await emitDomainEvent(tx, args.storeId, "order.paid", orderEventData(order));

  return { orderId: order.id, reference: order.reference, trackingToken: order.trackingToken, total: order.total, creditApplied, amountDue, surplus, duplicate: false };
}

/** Options d'un article d'échange reprises par nom dans les groupes du produit (comme « Commander à nouveau »). */
async function withOptionIds(tx: Tx, storeId: string, items: ExchangeOrderArgs["items"]): Promise<CheckoutItemInput[]> {
  const named = items.filter((i) => i.optionNames?.length);
  if (named.length === 0) return items.map(({ optionNames: _o, ...i }) => (void _o, i));
  const products = await tx.product.findMany({
    where: { storeId, id: { in: [...new Set(named.map((i) => i.productId))] } },
    select: { id: true, optionGroups: { select: { options: { select: { id: true, name: true } } } } },
  });
  return items.map(({ optionNames, ...i }) => {
    if (!optionNames?.length) return i;
    const options = products.find((p) => p.id === i.productId)?.optionGroups.flatMap((g) => g.options) ?? [];
    const ids = optionNames.map((n) => options.find((o) => o.name === n)?.id).filter((x): x is string => !!x);
    return { ...i, optionIds: [...new Set([...(i.optionIds ?? []), ...ids])] };
  });
}
