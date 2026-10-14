import "server-only";
import type { Prisma, ReturnResolution, ReturnStatus } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { randomReference } from "@/lib/utils";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import { revokeLoyaltyPartial } from "@/lib/loyalty/service";
import { canActorTransitionReturn, initialReturnStatusAllowed, RETURN_STATUS_LABELS, type ReturnActor } from "./state";
import { isItemReturnable, orderEligibility, remainingQuantities, reservesQuantity, RESOLUTION_LABELS, type ReturnPolicy, type ReturnReason, type ItemCondition, type ResolutionKind } from "./policy";
import { computeReturnAmounts, exchangeBalance, storeCreditWithBonus, type ReturnAmounts } from "./amounts";

/**
 * Service des retours (spec lot 1 §4). Toutes les requêtes sont filtrées par `storeId`.
 *  - Chaque transition est conditionnelle sur le statut lu (`updateMany where status = from`), écrit un ReturnEvent,
 *    un audit() et le job `return.status_changed` dans la même transaction.
 *  - Création et résolution verrouillent la commande (`SELECT … FOR UPDATE`) : deux demandes simultanées ne peuvent
 *    pas réserver deux fois les mêmes unités, deux résolutions ne peuvent pas dépasser le plafond remboursable.
 *  - Réception : remise en stock par mouvement `RETURN` et incrément conditionnel, bornée à ce que la commande a
 *    réellement retiré du stock (mêmes règles que le restock d'annulation, src/lib/commerce/restock.ts).
 */

type Client = Tx | typeof db;

export class ReturnError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "ReturnError";
  }
}

export type ActorInfo = { kind: Exclude<ReturnActor, "system">; id: string | null; label: string };

export const MAX_RETURN_PHOTOS = 3;

/** Verrou de la commande (sérialise créations et résolutions de retours d'une même commande). */
async function lockOrder(tx: Tx, storeId: string, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} AND "storeId" = ${storeId} FOR UPDATE`;
}

/** Photo de retour acceptable : média stocké par notre pipeline, dans l'espace `returns/` de CETTE boutique. */
export function isReturnPhotoUrl(url: string, storeId: string): boolean {
  return typeof url === "string" && url.length <= 500 && isStoredMediaUrl(url) && url.includes(`stores/${storeId}/returns/`);
}

async function uniqueReference(tx: Tx, storeId: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const reference = randomReference("RT");
    const taken = await tx.returnRequest.findFirst({ where: { storeId, reference }, select: { id: true } });
    if (!taken) return reference;
  }
  throw new Error("Impossible de générer une référence de retour");
}

async function writeTransitionSideEffects(
  tx: Tx,
  p: { storeId: string; returnId: string; reference: string; orderId: string; from: ReturnStatus | null; to: ReturnStatus; actor: ActorInfo; message?: string | null; metadata?: Record<string, unknown> },
) {
  await tx.returnEvent.create({
    data: { returnId: p.returnId, actorId: p.actor.id, actorLabel: p.actor.label, fromStatus: p.from, toStatus: p.to, message: p.message?.slice(0, 1000) ?? null },
  });
  await audit(
    {
      storeId: p.storeId,
      actorId: p.actor.id,
      action: p.from == null ? "return.created" : `return.${p.to.toLowerCase()}`,
      target: p.returnId,
      metadata: { reference: p.reference, orderId: p.orderId, from: p.from, to: p.to, by: p.actor.kind, ...p.metadata },
    },
    tx,
  );
  await enqueue("return.status_changed", { returnId: p.returnId, from: p.from, to: p.to, by: p.actor.kind }, { storeId: p.storeId }, tx);
  // Lot 2 (W) : webhook dans la même transaction ; aucune note ni coordonnée du client.
  const resolution = typeof p.metadata?.resolution === "string" ? p.metadata.resolution : undefined;
  const amount = typeof p.metadata?.amount === "number" ? p.metadata.amount : undefined;
  await emitDomainEvent(tx, p.storeId, p.from == null ? "return.created" : "return.status_changed", {
    return_id: p.returnId,
    reference: p.reference,
    order_id: p.orderId,
    from: p.from,
    status: p.to,
    by: p.actor.kind,
    ...(resolution ? { resolution } : {}),
    ...(amount !== undefined ? { amount } : {}),
  });
}

/* ───────────────────────── Remise en stock ───────────────────────── */

type RestockLine = { returnItemId: string; quantity: number; restock: boolean; orderItem: { productId: string | null; variantId: string | null; variantName: string | null } };

/**
 * Remet en stock les unités reçues : jamais plus que ce que la commande a retiré (SALE − CANCEL − RETURN déjà écrits),
 * produit non suivi ignoré, variante supprimée ignorée (comme le restock d'annulation). Renvoie les quantités remises.
 */
export async function restockReturnItemsTx(tx: Tx, p: { storeId: string; orderId: string; reference: string; actorId: string | null; lines: RestockLine[] }): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const l of p.lines) {
    out.set(l.returnItemId, 0);
    const { productId, variantId, variantName } = l.orderItem;
    if (!l.restock || l.quantity <= 0 || !productId) continue;
    const product = await tx.product.findFirst({ where: { id: productId, storeId: p.storeId }, select: { trackStock: true, variants: { select: { id: true } } } });
    if (!product?.trackStock) continue;
    // Variante supprimée depuis la vente (variantId remis à null) : ne jamais gonfler le stock du produit.
    if (!variantId && (variantName != null || product.variants.length > 0)) continue;
    const moves = await tx.inventoryMovement.findMany({
      where: { storeId: p.storeId, orderId: p.orderId, productId, variantId: variantId ?? null, reason: { in: ["SALE", "CANCEL", "RETURN"] } },
      select: { delta: true },
    });
    const outstanding = -moves.reduce((s, m) => s + m.delta, 0);
    const qty = Math.min(l.quantity, outstanding);
    if (qty <= 0) continue;
    if (variantId) {
      const done = await tx.variant.updateMany({ where: { id: variantId, productId }, data: { stock: { increment: qty } } });
      if (done.count === 0) continue;
    } else {
      const done = await tx.product.updateMany({ where: { id: productId, storeId: p.storeId }, data: { stock: { increment: qty } } });
      if (done.count === 0) continue;
    }
    const move = await tx.inventoryMovement.create({ data: { storeId: p.storeId, productId, variantId: variantId ?? null, delta: qty, reason: "RETURN", note: `Retour ${p.reference}`, orderId: p.orderId, actorId: p.actorId }, select: { id: true } });
    // Lot 3 : remise en stock attribuée aux dépôts qui avaient servi la vente (agrégat + niveaux dans la même transaction).
    const { creditOrderLevelsTx } = await import("@/lib/inventory/order-levels");
    await creditOrderLevelsTx(tx, { storeId: p.storeId, orderId: p.orderId, productId, variantId: variantId ?? null, quantity: qty, movementId: move.id });
    await tx.returnItem.update({ where: { id: l.returnItemId }, data: { restockedQty: qty } });
    out.set(l.returnItemId, qty);
  }
  return out;
}

/* ───────────────────────── Création ───────────────────────── */

export type CreateReturnInput = {
  storeId: string;
  orderId: string;
  policy: ReturnPolicy;
  actor: ActorInfo;
  initialStatus: ReturnStatus;
  reason: ReturnReason;
  desiredResolution?: ResolutionKind;
  customerNote?: string | null;
  merchantNote?: string | null;
  photos?: string[];
  items: { orderItemId: string; quantity: number; exchangeVariantId?: string | null; condition?: ItemCondition | null; restock?: boolean }[];
  now?: Date;
};

export async function createReturnTx(tx: Tx, input: CreateReturnInput): Promise<{ id: string; reference: string; status: ReturnStatus }> {
  const { storeId, orderId, policy, actor } = input;
  if (!initialReturnStatusAllowed(input.initialStatus, actor.kind)) throw new ReturnError("Statut initial invalide.");
  if (!input.items.length) throw new ReturnError("Choisissez au moins un article à retourner.", "items");
  if (input.items.length > 50) throw new ReturnError("Trop d'articles.", "items");
  const photos = input.photos ?? [];
  if (photos.length > MAX_RETURN_PHOTOS) throw new ReturnError(`${MAX_RETURN_PHOTOS} photos maximum.`, "photos");
  if (photos.some((u) => !isReturnPhotoUrl(u, storeId))) throw new ReturnError("Photo invalide : téléversez-la de nouveau.", "photos");
  if (actor.kind === "customer" && policy.requirePhotos && photos.length === 0) throw new ReturnError("Ajoutez au moins une photo des articles.", "photos");

  await lockOrder(tx, storeId, orderId);
  const order = await tx.order.findFirst({
    where: { id: orderId, storeId },
    select: {
      id: true, status: true, deliveredAt: true, customerId: true, reference: true,
      items: { select: { id: true, quantity: true, isGiftCard: true, productId: true, variantId: true, variantName: true, product: { select: { tags: true } } } },
    },
  });
  if (!order) throw new ReturnError("Commande introuvable.");
  const elig = orderEligibility(order, policy, input.now ?? new Date(), { merchant: actor.kind === "merchant" });
  if (!elig.ok) throw new ReturnError(elig.message);

  const existing = await tx.returnItem.findMany({
    where: { returnRequest: { orderId, storeId } },
    select: { orderItemId: true, quantity: true, returnId: true, returnRequest: { select: { status: true } } },
  });
  const remaining = remainingQuantities(
    order.items,
    existing.map((e) => ({ orderItemId: e.orderItemId, quantity: e.quantity, returnId: e.returnId, status: e.returnRequest.status })),
  );

  const seen = new Set<string>();
  for (const line of input.items) {
    const item = order.items.find((i) => i.id === line.orderItemId);
    if (!item || seen.has(line.orderItemId)) throw new ReturnError("Article invalide.", "items");
    seen.add(line.orderItemId);
    if (!isItemReturnable({ isGiftCard: item.isGiftCard, productTags: item.product?.tags ?? null }, policy)) throw new ReturnError("Cet article ne peut pas être retourné.", "items");
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > (remaining.get(item.id) ?? 0)) {
      throw new ReturnError("Quantité supérieure à ce qui reste retournable pour cet article.", "items");
    }
    if (line.exchangeVariantId) {
      if (!item.productId) throw new ReturnError("Échange impossible : ce produit n'est plus au catalogue.", "items");
      const v = await tx.variant.findFirst({ where: { id: line.exchangeVariantId, productId: item.productId, product: { storeId } }, select: { id: true } });
      if (!v) throw new ReturnError("Variante d'échange invalide.", "items");
    }
  }

  const status = input.initialStatus;
  const now = new Date();
  const reference = await uniqueReference(tx, storeId);
  const created = await tx.returnRequest.create({
    data: {
      storeId,
      orderId,
      customerId: order.customerId,
      reference,
      status,
      resolution: input.desiredResolution && input.desiredResolution !== "NONE" ? input.desiredResolution : "NONE",
      requestedBy: actor.kind,
      reason: input.reason,
      customerNote: input.customerNote?.slice(0, 1000) || null,
      merchantNote: input.merchantNote?.slice(0, 1000) || null,
      photos: photos.length ? (photos.map((url) => ({ url })) as Prisma.InputJsonValue) : undefined,
      approvedAt: status === "APPROVED" || status === "RECEIVED" ? now : null,
      receivedAt: status === "RECEIVED" ? now : null,
      items: {
        create: input.items.map((l) => ({
          orderItemId: l.orderItemId,
          quantity: l.quantity,
          exchangeVariantId: l.exchangeVariantId ?? null,
          condition: status === "RECEIVED" ? (l.condition ?? "neuf") : null,
          restock: l.restock ?? true,
        })),
      },
    },
    select: { id: true, reference: true, status: true, items: { select: { id: true, orderItemId: true, quantity: true, restock: true } } },
  });

  let message = actor.kind === "customer" ? "Demande de retour" : status === "RECEIVED" ? "Retour enregistré en boutique, articles reçus" : "Retour créé par la boutique";
  if (status === "RECEIVED") {
    const lines: RestockLine[] = created.items.map((ri) => {
      const oi = order.items.find((i) => i.id === ri.orderItemId)!;
      return { returnItemId: ri.id, quantity: ri.quantity, restock: ri.restock, orderItem: { productId: oi.productId, variantId: oi.variantId, variantName: oi.variantName } };
    });
    const restocked = await restockReturnItemsTx(tx, { storeId, orderId, reference, actorId: actor.id, lines });
    const total = [...restocked.values()].reduce((s, n) => s + n, 0);
    if (total > 0) message += `, ${total} unité${total > 1 ? "s" : ""} remise${total > 1 ? "s" : ""} en stock`;
  }
  await writeTransitionSideEffects(tx, { storeId, returnId: created.id, reference, orderId, from: null, to: status, actor, message, metadata: { items: input.items.length } });
  return { id: created.id, reference, status };
}

/* ───────────────────────── Transitions simples ───────────────────────── */

async function loadReturn(tx: Client, storeId: string, returnId: string) {
  const ret = await tx.returnRequest.findFirst({ where: { id: returnId, storeId }, select: { id: true, reference: true, status: true, orderId: true, resolution: true } });
  if (!ret) throw new ReturnError("Retour introuvable.");
  return ret;
}

/** Transition conditionnelle (statut lu) + événement + audit + job. */
export async function transitionReturnTx(
  tx: Tx,
  p: { storeId: string; returnId: string; to: ReturnStatus; actor: ActorInfo; message?: string | null; data?: Prisma.ReturnRequestUpdateManyMutationInput; expectFrom?: ReturnStatus[] },
) {
  const ret = await loadReturn(tx, p.storeId, p.returnId);
  if (p.expectFrom && !p.expectFrom.includes(ret.status)) throw new ReturnError(`Action impossible : le retour est « ${RETURN_STATUS_LABELS[ret.status]} ».`);
  if (!canActorTransitionReturn(ret.status, p.to, p.actor.kind)) {
    throw new ReturnError(`Action impossible : le retour est « ${RETURN_STATUS_LABELS[ret.status]} ».`);
  }
  const moved = await tx.returnRequest.updateMany({ where: { id: ret.id, storeId: p.storeId, status: ret.status }, data: { ...p.data, status: p.to } });
  if (moved.count === 0) throw new ReturnError("Le retour a été modifié entre-temps. Rechargez la page.");
  await writeTransitionSideEffects(tx, { storeId: p.storeId, returnId: ret.id, reference: ret.reference, orderId: ret.orderId, from: ret.status, to: p.to, actor: p.actor, message: p.message });
  return { from: ret.status, to: p.to, reference: ret.reference, orderId: ret.orderId };
}

export function approveReturn(p: { storeId: string; returnId: string; actor: ActorInfo; note?: string | null }) {
  return db.$transaction((tx) =>
    transitionReturnTx(tx, {
      storeId: p.storeId,
      returnId: p.returnId,
      to: "APPROVED",
      actor: p.actor,
      message: p.note ? `Retour approuvé : ${p.note}` : "Retour approuvé",
      data: { approvedAt: new Date(), ...(p.note ? { merchantNote: p.note.slice(0, 1000) } : {}) },
    }),
  );
}

export function rejectReturn(p: { storeId: string; returnId: string; actor: ActorInfo; reason: string }) {
  const reason = p.reason.trim();
  if (reason.length < 3) throw new ReturnError("Indiquez le motif du refus.", "reason");
  return db.$transaction((tx) =>
    transitionReturnTx(tx, { storeId: p.storeId, returnId: p.returnId, to: "REJECTED", actor: p.actor, message: `Refusé : ${reason}`, data: { rejectionReason: reason.slice(0, 1000) } }),
  );
}

export function cancelReturn(p: { storeId: string; returnId: string; actor: ActorInfo; note?: string | null }) {
  return db.$transaction((tx) =>
    transitionReturnTx(tx, {
      storeId: p.storeId,
      returnId: p.returnId,
      to: "CANCELLED",
      actor: p.actor,
      message: p.actor.kind === "customer" ? "Annulé par le client" : p.note ? `Annulé : ${p.note}` : "Annulé par la boutique",
      data: { cancelledAt: new Date() },
    }),
  );
}

/* ───────────────────────── Réception ───────────────────────── */

export type ReceiveLine = { returnItemId: string; receivedQty: number; condition: ItemCondition; restock: boolean };

export function receiveReturn(p: { storeId: string; returnId: string; actor: ActorInfo; lines: ReceiveLine[]; note?: string | null }) {
  return db.$transaction(async (tx) => {
    const ret = await tx.returnRequest.findFirst({
      where: { id: p.returnId, storeId: p.storeId },
      select: { id: true, reference: true, status: true, orderId: true, items: { select: { id: true, quantity: true, orderItem: { select: { productId: true, variantId: true, variantName: true } } } } },
    });
    if (!ret) throw new ReturnError("Retour introuvable.");
    if (ret.status !== "APPROVED") throw new ReturnError(`Réception impossible : le retour est « ${RETURN_STATUS_LABELS[ret.status]} ».`);
    const byId = new Map(p.lines.map((l) => [l.returnItemId, l]));
    if (byId.size !== ret.items.length || ret.items.some((i) => !byId.has(i.id))) throw new ReturnError("Indiquez la réception de chaque article.", "items");
    for (const it of ret.items) {
      const l = byId.get(it.id)!;
      if (!Number.isInteger(l.receivedQty) || l.receivedQty < 0 || l.receivedQty > it.quantity) throw new ReturnError("Quantité reçue invalide.", "items");
    }
    const received = ret.items.reduce((s, it) => s + byId.get(it.id)!.receivedQty, 0);
    if (received === 0) throw new ReturnError("Aucun article reçu : annulez plutôt le retour.", "items");

    // Transition d'abord (conditionnelle) : une double réception concurrente échoue avant toute remise en stock.
    const moved = await tx.returnRequest.updateMany({ where: { id: ret.id, storeId: p.storeId, status: "APPROVED" }, data: { status: "RECEIVED", receivedAt: new Date() } });
    if (moved.count === 0) throw new ReturnError("Le retour a été modifié entre-temps. Rechargez la page.");

    const diffs: string[] = [];
    for (const it of ret.items) {
      const l = byId.get(it.id)!;
      if (l.receivedQty !== it.quantity) diffs.push(`${l.receivedQty}/${it.quantity} reçu(s)`);
      // La quantité du retour devient la quantité réellement reçue (base des montants et des quantités réservées).
      await tx.returnItem.update({ where: { id: it.id }, data: { quantity: l.receivedQty, condition: l.condition, restock: l.restock && l.receivedQty > 0 } });
    }
    const restocked = await restockReturnItemsTx(tx, {
      storeId: p.storeId,
      orderId: ret.orderId,
      reference: ret.reference,
      actorId: p.actor.id,
      lines: ret.items.map((it) => {
        const l = byId.get(it.id)!;
        return { returnItemId: it.id, quantity: l.receivedQty, restock: l.restock, orderItem: it.orderItem };
      }),
    });
    const units = [...restocked.values()].reduce((s, n) => s + n, 0);
    const message = [
      `Articles reçus (${received} unité${received > 1 ? "s" : ""})`,
      diffs.length ? `écarts : ${diffs.join(", ")}` : null,
      units > 0 ? `${units} remise${units > 1 ? "s" : ""} en stock` : "aucune remise en stock",
      p.note || null,
    ]
      .filter(Boolean)
      .join(", ");
    await writeTransitionSideEffects(tx, { storeId: p.storeId, returnId: ret.id, reference: ret.reference, orderId: ret.orderId, from: "APPROVED", to: "RECEIVED", actor: p.actor, message, metadata: { received, restocked: units } });
    return { reference: ret.reference, restocked: units };
  });
}

/* ───────────────────────── Montants ───────────────────────── */

export type QuoteOptions = { refundShipping: boolean; waiveRestockingFee?: boolean; restockingFeePercent: number };

/**
 * Calcul suggéré d'un retour (pages et résolution). Les unités antérieures (retours créés avant celui-ci) fixent la
 * valeur des unités prises ; le plafond retire les remboursements et les avoirs/échanges de retours déjà résolus.
 */
export async function quoteReturn(client: Client, storeId: string, returnId: string, opts: QuoteOptions): Promise<ReturnAmounts & { paid: boolean; alreadyRefunded: number }> {
  const ret = await client.returnRequest.findFirst({
    where: { id: returnId, storeId },
    select: { id: true, createdAt: true, orderId: true, items: { select: { orderItemId: true, quantity: true } } },
  });
  if (!ret) throw new ReturnError("Retour introuvable.");
  const order = await client.order.findFirst({
    where: { id: ret.orderId, storeId },
    select: {
      total: true, deliveryFee: true, paymentStatus: true,
      items: { select: { id: true, quantity: true, lineTotal: true, discountAllocated: true, isGiftCard: true } },
      refunds: { select: { amount: true, status: true } },
    },
  });
  if (!order) throw new ReturnError("Commande introuvable.");
  const others = await client.returnRequest.findMany({
    where: { storeId, orderId: ret.orderId, NOT: { id: ret.id } },
    select: { id: true, createdAt: true, status: true, resolution: true, refundAmount: true, refundShipping: true, items: { select: { orderItemId: true, quantity: true } } },
  });
  const prior: Record<string, number> = {};
  const otherQty: Record<string, number> = {};
  for (const o of others) {
    if (!reservesQuantity(o.status)) continue;
    const before = o.createdAt.getTime() < ret.createdAt.getTime() || (o.createdAt.getTime() === ret.createdAt.getTime() && o.id < ret.id);
    for (const it of o.items) {
      otherQty[it.orderItemId] = (otherQty[it.orderItemId] ?? 0) + it.quantity;
      if (before) prior[it.orderItemId] = (prior[it.orderItemId] ?? 0) + it.quantity;
    }
  }
  // Plafond : helper unique du remboursable (remboursements, recrédits d'annulation, retours en avoir/échange ou
  // réservés, valeur dépensée des cartes achetées), hors ce retour.
  const { refundableRemaining } = await import("@/lib/commerce/refunds");
  const refundable = await refundableRemaining(client as Tx, { id: ret.orderId, storeId, total: order.total }, { excludeReturnId: ret.id });
  const alreadyRefunded = Math.max(0, order.total - refundable.remaining);
  const amounts = computeReturnAmounts({
    order: { total: order.total, deliveryFee: order.deliveryFee, items: order.items },
    lines: ret.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity, priorQuantity: prior[i.orderItemId] ?? 0 })),
    restockingFeePercent: opts.restockingFeePercent,
    waiveRestockingFee: opts.waiveRestockingFee,
    refundShipping: opts.refundShipping,
    otherReturnedQty: otherQty,
    shippingAlreadyRefunded: others.some((o) => o.status === "RESOLVED" && o.refundShipping),
    alreadyRefunded,
  });
  return { ...amounts, paid: order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED", alreadyRefunded };
}

/* ───────────────────────── Résolution ───────────────────────── */

export type ResolveInput = {
  storeId: string;
  returnId: string;
  actor: ActorInfo;
  policy: ReturnPolicy;
  resolution: ResolutionKind;
  refundShipping: boolean;
  waiveRestockingFee: boolean;
  /** Montant choisi par le commerçant (≤ montant suggéré) ; absent = montant suggéré. */
  amount?: number | null;
  note?: string | null;
  /** Échange : variante par article retourné (absent = même article). */
  exchangeVariants?: Record<string, string | null>;
};

export type ResolveResult = { reference: string; resolution: ResolutionKind; amount: number; storeCredit: number; exchangeOrderId: string | null; exchangeReference: string | null; amountDue: number };

function pickAmount(quote: ReturnAmounts, requested: number | null | undefined): number {
  if (requested == null) return quote.amount;
  if (!Number.isInteger(requested) || requested < 0) throw new ReturnError("Montant invalide.", "amount");
  if (requested > quote.amount) throw new ReturnError("Montant supérieur au montant remboursable.", "amount");
  return requested;
}

/** Part marchandise du montant accordé (hors livraison), base du retrait proportionnel de fidélité. */
function merchandisePart(amount: number, quote: ReturnAmounts): number {
  return Math.max(0, Math.min(quote.merchandise, amount - quote.shipping));
}

async function findOrCreateCustomer(tx: Tx, storeId: string, ret: { customerId: string | null; order: { customerId: string | null; customerName: string; customerPhone: string; customerEmail: string | null } }): Promise<string> {
  const id = ret.customerId ?? ret.order.customerId;
  if (id) {
    const c = await tx.customer.findFirst({ where: { id, storeId }, select: { id: true } });
    if (c) return c.id;
  }
  const c = await tx.customer.upsert({
    where: { storeId_phone: { storeId, phone: ret.order.customerPhone } },
    create: { storeId, phone: ret.order.customerPhone, name: ret.order.customerName, email: ret.order.customerEmail },
    update: {},
    select: { id: true },
  });
  return c.id;
}

async function loadForResolve(tx: Tx, storeId: string, returnId: string) {
  const ret = await tx.returnRequest.findFirst({
    where: { id: returnId, storeId },
    select: {
      id: true, reference: true, status: true, orderId: true, customerId: true, resolution: true,
      items: { select: { id: true, quantity: true, exchangeVariantId: true, orderItem: { select: { productId: true, variantId: true, name: true, options: true } } } },
      order: { select: { customerId: true, customerName: true, customerPhone: true, customerEmail: true, reference: true, paymentStatus: true } },
    },
  });
  if (!ret) throw new ReturnError("Retour introuvable.");
  return ret;
}

export async function resolveReturn(input: ResolveInput): Promise<ResolveResult> {
  if (input.resolution === "REFUND") return resolveWithRefund(input);
  const { storeId, actor } = input;
  return db.$transaction(async (tx) => {
    const head = await loadReturn(tx, storeId, input.returnId);
    await lockOrder(tx, storeId, head.orderId);
    const ret = await loadForResolve(tx, storeId, input.returnId);
    if (ret.status !== "RECEIVED") throw new ReturnError(`Résolution impossible : le retour est « ${RETURN_STATUS_LABELS[ret.status]} ».`);
    const quote = await quoteReturn(tx, storeId, ret.id, { refundShipping: input.refundShipping, waiveRestockingFee: input.waiveRestockingFee, restockingFeePercent: input.policy.restockingFeePercent });
    const amount = input.resolution === "NONE" ? 0 : pickAmount(quote, input.amount);

    let storeCredit = 0;
    let customerId = ret.customerId;
    let exchange: { orderId: string; reference: string; amountDue: number } | null = null;
    let message: string;

    if (input.resolution === "STORE_CREDIT") {
      if (amount <= 0) throw new ReturnError("Montant nul : choisissez « Aucune » comme résolution.", "amount");
      customerId = await findOrCreateCustomer(tx, storeId, ret);
      storeCredit = storeCreditWithBonus(amount, input.policy.storeCreditBonusPercent);
      const { grantTx } = await import("@/lib/store-credit/service");
      await grantTx(tx, { storeId, customerId, amount: storeCredit, kind: "REFUND_TO_CREDIT", orderId: ret.orderId, returnId: ret.id, actorId: actor.id, note: `Retour ${ret.reference}` });
      message = `Résolu en avoir de ${storeCredit}${storeCredit > amount ? ` (dont bonus ${storeCredit - amount})` : ""}`;
    } else if (input.resolution === "EXCHANGE") {
      if (amount <= 0) throw new ReturnError("Montant nul : un échange nécessite une valeur retournée.", "amount");
      const items = ret.items
        .filter((i) => i.quantity > 0)
        .map((i) => {
          if (!i.orderItem.productId) throw new ReturnError(`Échange impossible : « ${i.orderItem.name} » n'est plus au catalogue.`, "items");
          const chosen = input.exchangeVariants?.[i.id] ?? i.exchangeVariantId ?? i.orderItem.variantId;
          // Options reprises par nom (la commande d'échange revalide groupes et bornes).
          const optionNames = Array.isArray(i.orderItem.options) ? (i.orderItem.options as unknown[]).flatMap((o) => (o && typeof o === "object" && typeof (o as { name?: unknown }).name === "string" ? [(o as { name: string }).name] : [])) : [];
          return { productId: i.orderItem.productId, variantId: chosen ?? null, quantity: i.quantity, optionNames };
        });
      const { createExchangeOrder } = await import("@/lib/commerce/exchange");
      let created: Awaited<ReturnType<typeof createExchangeOrder>>;
      try {
        created = await createExchangeOrder(tx, { storeId, sourceOrderId: ret.orderId, returnId: ret.id, items, credit: amount, actorId: actor.id ?? "", actorLabel: actor.label });
      } catch (e) {
        // Erreurs métier lisibles (indisponibilité, stock) remontées telles quelles ; erreurs de base inchangées.
        if (e instanceof Error && !("code" in e)) throw new ReturnError(e.message, "items");
        throw e;
      }
      const bal = exchangeBalance(amount, created.total);
      if (bal.surplus > 0) {
        customerId = await findOrCreateCustomer(tx, storeId, ret);
        const { grantTx } = await import("@/lib/store-credit/service");
        await grantTx(tx, { storeId, customerId, amount: bal.surplus, kind: "REFUND_TO_CREDIT", orderId: ret.orderId, returnId: ret.id, actorId: actor.id, note: `Excédent d'échange, retour ${ret.reference}` });
        storeCredit = bal.surplus;
      }
      exchange = { orderId: created.orderId, reference: created.reference, amountDue: created.amountDue };
      message = `Échangé : commande ${created.reference}${created.amountDue > 0 ? `, reste dû ${created.amountDue}` : ""}${bal.surplus > 0 ? `, excédent ${bal.surplus} en avoir` : ""}`;
    } else {
      message = "Clôturé sans remboursement";
    }
    if (input.note) message += `, ${input.note}`;

    const moved = await tx.returnRequest.updateMany({
      where: { id: ret.id, storeId, status: "RECEIVED" },
      data: {
        status: "RESOLVED",
        resolution: input.resolution as ReturnResolution,
        refundAmount: amount,
        storeCreditAmount: storeCredit,
        restockingFee: input.resolution === "NONE" ? 0 : quote.restockingFee,
        refundShipping: input.resolution !== "NONE" && quote.shipping > 0,
        exchangeOrderId: exchange?.orderId ?? null,
        customerId,
        resolvedAt: new Date(),
        ...(input.note ? { merchantNote: input.note.slice(0, 1000) } : {}),
      },
    });
    if (moved.count === 0) throw new ReturnError("Le retour a été modifié entre-temps. Rechargez la page.");
    if (amount > 0) await revokeLoyaltyPartial(ret.orderId, merchandisePart(amount, quote), { tx, storeId });
    await writeTransitionSideEffects(tx, {
      storeId, returnId: ret.id, reference: ret.reference, orderId: ret.orderId, from: "RECEIVED", to: "RESOLVED", actor, message,
      metadata: { resolution: input.resolution, amount, storeCredit, exchangeOrderId: exchange?.orderId ?? null },
    });
    return { reference: ret.reference, resolution: input.resolution, amount, storeCredit, exchangeOrderId: exchange?.orderId ?? null, exchangeReference: exchange?.reference ?? null, amountDue: exchange?.amountDue ?? 0 };
  });
}

/**
 * Résolution en remboursement : `requestRefund` (équipe B) ouvre sa propre transaction, on procède donc en trois temps.
 *  1. Réservation (transaction, commande verrouillée) : RECEIVED → RESOLVED conditionnel, montant figé. Une seconde
 *     résolution concurrente échoue ici : jamais deux remboursements pour un même retour.
 *  2. `requestRefund(amount, returnId)` (plafond revérifié par le service de paiement).
 *  3. Finalisation (transaction) : refundId, retrait de fidélité, événement, audit, job.
 *  En cas d'échec de 2 : compensation RESOLVED → RECEIVED (conditionnelle, refundId nul) avec un événement explicite.
 */
async function resolveWithRefund(input: ResolveInput): Promise<ResolveResult> {
  const { storeId, actor } = input;
  const claimed = await db.$transaction(async (tx) => {
    const head = await loadReturn(tx, storeId, input.returnId);
    await lockOrder(tx, storeId, head.orderId);
    const ret = await loadForResolve(tx, storeId, input.returnId);
    if (ret.status !== "RECEIVED") throw new ReturnError(`Résolution impossible : le retour est « ${RETURN_STATUS_LABELS[ret.status]} ».`);
    const quote = await quoteReturn(tx, storeId, ret.id, { refundShipping: input.refundShipping, waiveRestockingFee: input.waiveRestockingFee, restockingFeePercent: input.policy.restockingFeePercent });
    if (!quote.paid) throw new ReturnError("Remboursement impossible : la commande n'est pas payée. Choisissez un avoir, un échange ou aucune résolution.", "resolution");
    const amount = pickAmount(quote, input.amount);
    if (amount <= 0) throw new ReturnError("Montant nul : choisissez « Aucune » comme résolution.", "amount");
    const moved = await tx.returnRequest.updateMany({
      where: { id: ret.id, storeId, status: "RECEIVED" },
      data: { status: "RESOLVED", resolution: "REFUND", refundAmount: amount, restockingFee: quote.restockingFee, refundShipping: quote.shipping > 0, resolvedAt: new Date(), ...(input.note ? { merchantNote: input.note.slice(0, 1000) } : {}) },
    });
    if (moved.count === 0) throw new ReturnError("Le retour a été modifié entre-temps. Rechargez la page.");
    return { ret, quote, amount, previousResolution: ret.resolution };
  });

  const { ret, quote, amount } = claimed;
  let refundId: string;
  try {
    const existing = await db.refund.findFirst({ where: { orderId: ret.orderId, returnId: ret.id, status: { not: "REJECTED" } }, select: { id: true } });
    if (existing) {
      refundId = existing.id;
    } else {
      const { requestRefund } = await import("@/lib/payments/service");
      // `destination` et `returnId` : extension de requestRefund par l'équipe B (spec §3 « Remboursements »).
      const params: Parameters<typeof requestRefund>[0] & { destination: "original" | "store_credit"; returnId: string } = {
        orderId: ret.orderId, storeId, actorId: actor.id ?? "", actorLabel: actor.label, amount, reason: `Retour ${ret.reference}`, destination: "original", returnId: ret.id,
      };
      const refund = await requestRefund(params);
      refundId = refund.id;
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Erreur inconnue";
    await db.$transaction(async (tx) => {
      const back = await tx.returnRequest.updateMany({
        where: { id: ret.id, storeId, status: "RESOLVED", resolution: "REFUND", refundId: null },
        data: { status: "RECEIVED", resolution: claimed.previousResolution, refundAmount: 0, restockingFee: 0, refundShipping: false, resolvedAt: null },
      });
      if (back.count === 1) {
        await tx.returnEvent.create({ data: { returnId: ret.id, actorId: actor.id, actorLabel: actor.label, fromStatus: "RESOLVED", toStatus: "RECEIVED", message: `Échec du remboursement : ${reason}`.slice(0, 1000) } });
        await audit({ storeId, actorId: actor.id, action: "return.refund_failed", target: ret.id, metadata: { reference: ret.reference, amount, error: reason } }, tx);
      }
    });
    throw new ReturnError(`Remboursement impossible : ${reason}`);
  }

  await db.$transaction(async (tx) => {
    await tx.returnRequest.updateMany({ where: { id: ret.id, storeId }, data: { refundId } });
    await revokeLoyaltyPartial(ret.orderId, merchandisePart(amount, quote), { tx, storeId });
    await writeTransitionSideEffects(tx, {
      storeId, returnId: ret.id, reference: ret.reference, orderId: ret.orderId, from: "RECEIVED", to: "RESOLVED", actor,
      message: `Remboursé : ${amount}${input.note ? `, ${input.note}` : ""}`,
      metadata: { resolution: "REFUND", amount, refundId },
    });
  });
  return { reference: ret.reference, resolution: "REFUND", amount, storeCredit: 0, exchangeOrderId: null, exchangeReference: null, amountDue: 0 };
}

export { RESOLUTION_LABELS };
