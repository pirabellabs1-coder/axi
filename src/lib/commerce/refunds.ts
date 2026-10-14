import type { Tx } from "@/lib/db";

/**
 * Montant encore remboursable d'une commande : SOURCE UNIQUE pour requestRefund (les deux destinations),
 * quoteReturn (retours), l'annulation (recrédit des tenders) et l'affichage « remboursable » de la fiche commande.
 *
 *   remaining = total
 *             − Σ Refund non refusés
 *             − Σ REVERSAL (cartes cadeaux, avoir) NON rattachés à un Refund (recrédits d'annulation)
 *             − Σ retours RESOLVED en STORE_CREDIT ou EXCHANGE (valeur accordée hors remboursement)
 *             − Σ retours RESOLVED/REFUND dont le Refund n'existe pas encore (montant réservé, `refundId` nul)
 *             − valeur déjà DÉPENSÉE des cartes cadeaux achetées par cette commande (non remboursable)
 *
 * Rattachement d'un REVERSAL à son Refund : la note du journal porte `refund:<refundId>` (écrite uniquement par
 * requestRefund, voir `refundNote`). Choix sans migration : le client Prisma en service n'a pas besoin d'être
 * régénéré. Les recrédits d'annulation portent une autre note et sont comptés comme « non rattachés ».
 */

export const REFUND_TAG = "refund:";
export const refundNote = (refundId: string, label = "Remboursement") => `${label} (${REFUND_TAG}${refundId})`;
export const isRefundReversal = (note: string | null | undefined) => !!note && note.includes(REFUND_TAG);

export type RefundLedger = {
  total: number;
  refunds: { amount: number; status: string }[];
  /** REVERSAL des cartes cadeaux et de l'avoir de la commande (montants positifs). */
  reversals: { amount: number; note: string | null }[];
  returns: { id: string; status: string; resolution: string; refundAmount: number; refundId: string | null }[];
  /** Valeur dépensée des cartes cadeaux achetées par la commande (REDEEM nets de REVERSAL, toutes commandes). */
  spentPurchasedGiftCards: number;
};

export type RefundableBreakdown = {
  remaining: number;
  refunded: number;
  cancelReversals: number;
  refundReversals: number;
  returnsCredited: number;
  returnsReserved: number;
  spentPurchasedGiftCards: number;
};

/** Calcul pur (testé). `excludeReturnId` : le retour en cours de remboursement ne se réserve pas lui-même. */
export function computeRefundable(l: RefundLedger, opts: { excludeReturnId?: string | null } = {}): RefundableBreakdown {
  const refunded = l.refunds.filter((r) => r.status !== "REJECTED").reduce((s, r) => s + Math.max(0, r.amount), 0);
  let cancelReversals = 0;
  let refundReversals = 0;
  for (const r of l.reversals) {
    if (isRefundReversal(r.note)) refundReversals += Math.max(0, r.amount);
    else cancelReversals += Math.max(0, r.amount);
  }
  let returnsCredited = 0;
  let returnsReserved = 0;
  for (const r of l.returns) {
    if (r.status !== "RESOLVED" || r.id === opts.excludeReturnId) continue;
    if (r.resolution === "STORE_CREDIT" || r.resolution === "EXCHANGE") returnsCredited += Math.max(0, r.refundAmount);
    else if (r.resolution === "REFUND" && !r.refundId) returnsReserved += Math.max(0, r.refundAmount);
  }
  const spent = Math.max(0, l.spentPurchasedGiftCards);
  const remaining = Math.max(0, l.total - refunded - cancelReversals - returnsCredited - returnsReserved - spent);
  return { remaining, refunded, cancelReversals, refundReversals, returnsCredited, returnsReserved, spentPurchasedGiftCards: spent };
}

/** Part du paiement externe déjà rendue (argent ou avoir) : Σ Refund − Σ REVERSAL rattachés aux Refund. */
export function externalRefunded(l: Pick<RefundLedger, "refunds" | "reversals">): number {
  const refunded = l.refunds.filter((r) => r.status !== "REJECTED").reduce((s, r) => s + Math.max(0, r.amount), 0);
  const linked = l.reversals.filter((r) => isRefundReversal(r.note)).reduce((s, r) => s + Math.max(0, r.amount), 0);
  return Math.max(0, refunded - linked);
}

/** Montants encore débités sur les tenders internes de la commande (REDEEM − REVERSAL). */
export type TenderOutstanding = { giftCards: number; storeCredit: number };

export async function loadRefundLedger(tx: Tx, order: { id: string; storeId: string; total: number }): Promise<RefundLedger & { outstanding: TenderOutstanding }> {
  const [refunds, gc, sc, returns, purchased] = await Promise.all([
    tx.refund.findMany({ where: { orderId: order.id }, select: { amount: true, status: true } }),
    tx.giftCardTransaction.findMany({ where: { storeId: order.storeId, orderId: order.id, kind: { in: ["REDEEM", "REVERSAL"] } }, select: { kind: true, amount: true, note: true } }),
    tx.storeCreditTransaction.findMany({ where: { storeId: order.storeId, orderId: order.id, kind: { in: ["REDEEM", "REVERSAL"] } }, select: { kind: true, amount: true, note: true } }),
    tx.returnRequest.findMany({ where: { storeId: order.storeId, orderId: order.id }, select: { id: true, status: true, resolution: true, refundAmount: true, refundId: true } }),
    tx.giftCard.findMany({ where: { storeId: order.storeId, sourceOrderId: order.id }, select: { id: true } }),
  ]);
  let spent = 0;
  if (purchased.length) {
    const rows = await tx.giftCardTransaction.findMany({ where: { storeId: order.storeId, giftCardId: { in: purchased.map((c) => c.id) }, kind: { in: ["REDEEM", "REVERSAL"] } }, select: { amount: true } });
    spent = Math.max(0, -rows.reduce((s, r) => s + r.amount, 0));
  }
  const reversals = [...gc, ...sc].filter((r) => r.kind === "REVERSAL").map((r) => ({ amount: r.amount, note: r.note }));
  const net = (rows: { amount: number; kind: string }[]) => Math.max(0, -rows.reduce((s, r) => s + r.amount, 0));
  return {
    total: order.total,
    refunds,
    reversals,
    returns: returns.map((r) => ({ id: r.id, status: r.status, resolution: r.resolution, refundAmount: r.refundAmount, refundId: r.refundId })),
    spentPurchasedGiftCards: spent,
    outstanding: { giftCards: net(gc), storeCredit: net(sc) },
  };
}

/** Helper unique demandé par la revue : montant encore remboursable (et détail) d'une commande. */
export async function refundableRemaining(tx: Tx, order: { id: string; storeId: string; total: number }, opts: { excludeReturnId?: string | null } = {}) {
  const ledger = await loadRefundLedger(tx, order);
  return { ...computeRefundable(ledger, opts), ledger };
}
