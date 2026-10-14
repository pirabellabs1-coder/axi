import "server-only";
import type { StoreCreditTxKind } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { prorata } from "@/lib/giftcards/state";
import { StoreCreditError } from "./errors";
import { STORE_CREDIT_MAX_OPERATION } from "./rules";

/**
 * Services transactionnels de l'avoir (spécification lot 1, §3 « Avoir », §0.4).
 * Contrat avec les équipes B (createOrder, transitionOrder, requestRefund) et D (retours) :
 *  - `redeemStoreCreditTx(tx, storeId, customerId, amount, { orderId })` : débit conditionnel
 *    `storeCreditBalance >= amount`, journal REDEEM, PaymentAttempt `store_credit` CONFIRMED si `orderId` ;
 *    l'appelant a vérifié l'éligibilité (`canUseStoreCredit` : acheteur connecté par code ou commerçant) ;
 *  - `reverseStoreCreditTx(tx, storeId, orderId)` : recrédit idempotent du net débité (annulation, remboursement) ;
 *  - `grantTx(tx, { … })` : crédit (GRANT motif obligatoire, REFUND_TO_CREDIT, ADJUST positif).
 * Toutes lèvent `StoreCreditError` (message lisible) ; aucune ne fait d'audit (à la charge de l'action appelante).
 */

export type StoreCreditMovement = { transactionId: string; amount: number; balanceAfter: number };

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0 || amount > STORE_CREDIT_MAX_OPERATION) throw new StoreCreditError("Montant d'avoir invalide.", "invalid_amount");
}

export async function redeemStoreCreditTx(
  tx: Tx,
  storeId: string,
  customerId: string,
  amount: number,
  opts: { orderId?: string; actorId?: string | null; note?: string | null } = {},
): Promise<StoreCreditMovement | null> {
  if (amount === 0) return null;
  assertAmount(amount);
  let currency: string | null = null;
  if (opts.orderId) {
    const order = await tx.order.findFirst({ where: { id: opts.orderId, storeId }, select: { currency: true } });
    if (!order) throw new StoreCreditError("Commande introuvable.", "not_found");
    currency = order.currency;
  }
  const debited = await tx.customer.updateMany({
    where: { id: customerId, storeId, storeCreditBalance: { gte: amount } },
    data: { storeCreditBalance: { decrement: amount } },
  });
  if (debited.count !== 1) {
    const exists = await tx.customer.findFirst({ where: { id: customerId, storeId }, select: { id: true } });
    if (!exists) throw new StoreCreditError("Client introuvable.", "not_found");
    throw new StoreCreditError("Solde d'avoir insuffisant.", "insufficient");
  }
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { storeCreditBalance: true } });
  const balanceAfter = customer?.storeCreditBalance ?? 0;
  const row = await tx.storeCreditTransaction.create({
    data: { storeId, customerId, kind: "REDEEM", amount: -amount, balanceAfter, orderId: opts.orderId ?? null, actorId: opts.actorId ?? null, note: opts.note ?? null },
  });
  if (opts.orderId && currency) {
    await tx.paymentAttempt.create({
      data: { orderId: opts.orderId, provider: "store_credit", providerRef: row.id, status: "CONFIRMED", amount, currency, verifiedAt: new Date(), verifiedBy: opts.actorId ?? null, metadata: { customerId } },
    });
  }
  return { transactionId: row.id, amount, balanceAfter };
}

/**
 * Recrédite l'avoir débité pour une commande (REVERSAL). Sans `amount` : tout le net encore débité ; avec `amount` :
 * partiel (au prorata si plusieurs clients, cas théorique). Idempotent (net recalculé depuis le journal).
 */
export async function reverseStoreCreditTx(
  tx: Tx,
  storeId: string,
  orderId: string,
  opts: { amount?: number; actorId?: string | null; note?: string; returnId?: string | null } = {},
): Promise<{ total: number; movements: (StoreCreditMovement & { customerId: string })[] }> {
  const rows = await tx.storeCreditTransaction.findMany({ where: { storeId, orderId, kind: { in: ["REDEEM", "REVERSAL"] } }, select: { customerId: true, amount: true } });
  const outstanding = new Map<string, number>();
  for (const r of rows) outstanding.set(r.customerId, (outstanding.get(r.customerId) ?? 0) - r.amount);
  const ids = [...outstanding.keys()].filter((id) => (outstanding.get(id) ?? 0) > 0).sort();
  if (ids.length === 0) return { total: 0, movements: [] };
  const weights = ids.map((id) => outstanding.get(id)!);
  const totalOutstanding = weights.reduce((s, w) => s + w, 0);
  const target = Math.min(totalOutstanding, Math.max(0, Math.floor(opts.amount ?? totalOutstanding)));
  const amounts = target === totalOutstanding ? weights : prorata(target, weights);
  const movements: (StoreCreditMovement & { customerId: string })[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (amounts[i] <= 0) continue;
    const m = await creditTx(tx, { storeId, customerId: ids[i], amount: amounts[i], kind: "REVERSAL", orderId, returnId: opts.returnId ?? null, actorId: opts.actorId ?? null, note: opts.note ?? (opts.amount == null ? "Annulation de commande" : "Remboursement") });
    if (m) movements.push({ ...m, customerId: ids[i] });
  }
  return { total: movements.reduce((s, m) => s + m.amount, 0), movements };
}

async function creditTx(
  tx: Tx,
  p: { storeId: string; customerId: string; amount: number; kind: StoreCreditTxKind; orderId?: string | null; returnId?: string | null; actorId?: string | null; note?: string | null },
): Promise<StoreCreditMovement | null> {
  const updated = await tx.customer.updateMany({ where: { id: p.customerId, storeId: p.storeId }, data: { storeCreditBalance: { increment: p.amount } } });
  if (updated.count !== 1) return null;
  const customer = await tx.customer.findUnique({ where: { id: p.customerId }, select: { storeCreditBalance: true } });
  const balanceAfter = customer?.storeCreditBalance ?? p.amount;
  const row = await tx.storeCreditTransaction.create({
    data: { storeId: p.storeId, customerId: p.customerId, kind: p.kind, amount: p.amount, balanceAfter, orderId: p.orderId ?? null, returnId: p.returnId ?? null, actorId: p.actorId ?? null, note: p.note ?? null },
  });
  return { transactionId: row.id, amount: p.amount, balanceAfter };
}

/**
 * Crédite l'avoir d'un client de la boutique. `GRANT` exige un motif (`note`). Lève StoreCreditError si le client
 * n'appartient pas à la boutique.
 */
export async function grantTx(
  tx: Tx,
  p: { storeId: string; customerId: string; amount: number; kind?: "GRANT" | "REFUND_TO_CREDIT" | "ADJUST"; note?: string | null; actorId?: string | null; orderId?: string | null; returnId?: string | null },
): Promise<StoreCreditMovement> {
  assertAmount(p.amount);
  const kind = p.kind ?? "GRANT";
  if (kind === "GRANT" && !p.note?.trim()) throw new StoreCreditError("Indiquez le motif du geste commercial.", "invalid_amount");
  const m = await creditTx(tx, { ...p, kind, note: p.note?.trim() || null });
  if (!m) throw new StoreCreditError("Client introuvable.", "not_found");
  return m;
}

/** Débit marchand (ADJUST négatif, motif obligatoire), conditionnel : le solde ne devient jamais négatif. */
export async function deductTx(
  tx: Tx,
  p: { storeId: string; customerId: string; amount: number; note: string; actorId?: string | null },
): Promise<StoreCreditMovement> {
  assertAmount(p.amount);
  if (!p.note.trim()) throw new StoreCreditError("Indiquez le motif du débit.", "invalid_amount");
  const debited = await tx.customer.updateMany({
    where: { id: p.customerId, storeId: p.storeId, storeCreditBalance: { gte: p.amount } },
    data: { storeCreditBalance: { decrement: p.amount } },
  });
  if (debited.count !== 1) {
    const exists = await tx.customer.findFirst({ where: { id: p.customerId, storeId: p.storeId }, select: { id: true } });
    if (!exists) throw new StoreCreditError("Client introuvable.", "not_found");
    throw new StoreCreditError("Solde d'avoir insuffisant.", "insufficient");
  }
  const customer = await tx.customer.findUnique({ where: { id: p.customerId }, select: { storeCreditBalance: true } });
  const balanceAfter = customer?.storeCreditBalance ?? 0;
  const row = await tx.storeCreditTransaction.create({
    data: { storeId: p.storeId, customerId: p.customerId, kind: "ADJUST", amount: -p.amount, balanceAfter, actorId: p.actorId ?? null, note: p.note.trim() },
  });
  return { transactionId: row.id, amount: -p.amount, balanceAfter };
}
