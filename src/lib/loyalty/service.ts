import "server-only";
import { db, type Tx } from "@/lib/db";
import { parseLoyaltyConfig, pointsForAmount } from "./config";
import { loyaltyBaseAmount } from "@/lib/commerce/loyalty-base";
import { loyaltyPointsToRevoke } from "@/lib/returns/amounts";

/**
 * Programme de fidélité. Règles :
 *  - les points sont gagnés quand la commande passe à DELIVERED (appel de awardLoyaltyForOrder) ;
 *  - un retour / remboursement retire les points de la commande (revokeLoyaltyForOrder) ;
 *  - un retour résolu retire une part proportionnelle des points (revokeLoyaltyPartial, motif « return ») ;
 *  - les points utilisés au checkout (lot 1) sont débités par redeemPointsTx (motif « redeem »), rendus à l'annulation
 *    par reverseRedeemedPointsTx (motif « redeem_reversal ») ;
 *  - toutes les écritures passent par LoyaltyLedger, Customer.loyaltyPoints est le solde dénormalisé.
 *
 * « Points gagnés nets » d'une commande = Σ des motifs EARNED_REASONS (order, refund, return) : les points utilisés
 * pour payer la commande n'en font pas partie (sinon un client qui paie en points ne perdrait rien au remboursement).
 */

/** Motifs du journal qui composent les points GAGNÉS d'une commande (attribution et retraits). */
export const EARNED_REASONS = ["order", "refund", "return"] as const;

async function applyDelta(tx: Tx, p: { storeId: string; customerId: string; delta: number; reason: string; orderId?: string | null }) {
  await tx.loyaltyLedger.create({ data: { storeId: p.storeId, customerId: p.customerId, delta: p.delta, reason: p.reason, orderId: p.orderId ?? null } });
  await tx.customer.update({ where: { id: p.customerId }, data: { loyaltyPoints: { increment: p.delta } } });
}

/**
 * Attribue les points d'une commande livrée. Idempotent (une seule attribution par commande).
 * Sans effet si le programme est désactivé, si la commande n'a pas de client ou n'est pas livrée.
 */
export async function awardLoyaltyForOrder(orderId: string): Promise<{ awarded: number }> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, storeId: true, customerId: true, status: true, total: true, currency: true, discount: true, giftCardAmount: true, storeCreditAmount: true,
      items: { select: { lineTotal: true, discountAllocated: true, isGiftCard: true } },
      store: { select: { loyaltyConfig: true } },
    },
  });
  if (!order || !order.customerId || order.status !== "DELIVERED") return { awarded: 0 };
  const cfg = parseLoyaltyConfig(order.store.loyaltyConfig);
  // Base : net marchandise hors cartes cadeaux, hors livraison, moins cartes et avoir utilisés (loyalty-base.ts).
  const points = pointsForAmount(loyaltyBaseAmount(order), order.currency, cfg);
  if (points <= 0) return { awarded: 0 };

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty:${order.id}`}))`;
    const already = await tx.loyaltyLedger.findFirst({ where: { storeId: order.storeId, orderId: order.id, reason: "order" }, select: { id: true } });
    if (already) return { awarded: 0 };
    await applyDelta(tx, { storeId: order.storeId, customerId: order.customerId!, delta: points, reason: "order", orderId: order.id });
    return { awarded: points };
  });
}

/** Retire les points nets d'une commande (retour, remboursement, annulation après livraison). Idempotent. */
export async function revokeLoyaltyForOrder(orderId: string): Promise<{ revoked: number }> {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true, storeId: true, customerId: true } });
  if (!order?.customerId) return { revoked: 0 };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty:${order.id}`}))`;
    const done = await tx.loyaltyLedger.findFirst({ where: { storeId: order.storeId, orderId: order.id, reason: "refund" }, select: { id: true } });
    if (done) return { revoked: 0 };
    const net = await tx.loyaltyLedger.aggregate({ where: { storeId: order.storeId, orderId: order.id, reason: { in: [...EARNED_REASONS] } }, _sum: { delta: true } });
    const remaining = net._sum.delta ?? 0;
    if (remaining <= 0) return { revoked: 0 };
    const customer = await tx.customer.findUnique({ where: { id: order.customerId! }, select: { loyaltyPoints: true } });
    // Le solde ne descend jamais sous zéro (points déjà utilisés en récompense).
    const take = Math.min(remaining, Math.max(0, customer?.loyaltyPoints ?? 0));
    await tx.loyaltyLedger.create({ data: { storeId: order.storeId, customerId: order.customerId!, delta: -take, reason: "refund", orderId: order.id } });
    if (take > 0) await tx.customer.update({ where: { id: order.customerId! }, data: { loyaltyPoints: { decrement: take } } });
    return { revoked: take };
  });
}

/** Ajustement manuel (déjà autorisé et audité par l'appelant). */
export async function adjustLoyalty(tx: Tx, p: { storeId: string; customerId: string; delta: number; reason: "adjustment" | "reward" }) {
  // Mise à jour conditionnelle atomique : le solde ne devient jamais négatif, même en concurrence.
  const updated = await tx.customer.updateMany({
    where: { id: p.customerId, storeId: p.storeId, ...(p.delta < 0 ? { loyaltyPoints: { gte: -p.delta } } : {}) },
    data: { loyaltyPoints: { increment: p.delta } },
  });
  const customer = await tx.customer.findFirst({ where: { id: p.customerId, storeId: p.storeId }, select: { loyaltyPoints: true } });
  if (!customer) throw new Error("Client introuvable");
  if (updated.count === 0) return { ok: false as const, balance: customer.loyaltyPoints };
  await tx.loyaltyLedger.create({ data: { storeId: p.storeId, customerId: p.customerId, delta: p.delta, reason: p.reason } });
  return { ok: true as const, balance: customer.loyaltyPoints };
}

/* ───────────────────────── Lot 1 : retours et utilisation au checkout ───────────────────────── */

async function lockOrderLoyalty(tx: Tx, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty:${orderId}`}))`;
}

/**
 * Retrait PROPORTIONNEL des points d'une commande après un retour résolu (spec lot 1 §4) :
 * `points gagnés × montant remboursé / net marchandise`, arrondi à l'inférieur, plafonné aux points gagnés encore
 * attachés à la commande et au solde du client (jamais négatif). Écrit une ligne `return`.
 *
 * Pas de clé d'idempotence propre : l'appelant l'invoque une seule fois par retour, dans la transaction qui fait
 * passer le retour à RESOLVED de façon conditionnelle (passer `tx`). Sans `tx`, ouvre sa propre transaction.
 */
export async function revokeLoyaltyPartial(orderId: string, refundedNetMerch: number, opts: { tx?: Tx; storeId?: string } = {}): Promise<{ revoked: number }> {
  if (!Number.isFinite(refundedNetMerch) || refundedNetMerch <= 0) return { revoked: 0 };
  const run = async (tx: Tx): Promise<{ revoked: number }> => {
    const order = await tx.order.findFirst({
      where: { id: orderId, ...(opts.storeId ? { storeId: opts.storeId } : {}) },
      select: { id: true, storeId: true, customerId: true, subtotal: true, discount: true, giftCardAmount: true, storeCreditAmount: true, items: { select: { lineTotal: true, discountAllocated: true, isGiftCard: true } } },
    });
    if (!order?.customerId) return { revoked: 0 };
    await lockOrderLoyalty(tx, order.id);
    const rows = await tx.loyaltyLedger.findMany({
      where: { storeId: order.storeId, orderId: order.id, reason: { in: [...EARNED_REASONS] } },
      select: { delta: true, reason: true },
    });
    const earned = rows.filter((r) => r.reason === "order").reduce((s, r) => s + r.delta, 0);
    const remaining = rows.reduce((s, r) => s + r.delta, 0);
    // Même base que l'attribution des points (proportionnalité cohérente).
    const netMerch = loyaltyBaseAmount(order);
    if (earned <= 0 || remaining <= 0 || netMerch <= 0) return { revoked: 0 };

    const customerId = order.customerId;
    for (let attempt = 0; attempt < 2; attempt++) {
      const customer = await tx.customer.findFirst({ where: { id: customerId, storeId: order.storeId }, select: { loyaltyPoints: true } });
      const balance = Math.max(0, customer?.loyaltyPoints ?? 0);
      const take = loyaltyPointsToRevoke(earned, refundedNetMerch, netMerch, Math.min(remaining, balance));
      if (take <= 0) return { revoked: 0 };
      // Décrément conditionnel : le solde ne devient jamais négatif, même si un autre débit passe entre-temps.
      const done = await tx.customer.updateMany({ where: { id: customerId, storeId: order.storeId, loyaltyPoints: { gte: take } }, data: { loyaltyPoints: { decrement: take } } });
      if (done.count === 1) {
        await tx.loyaltyLedger.create({ data: { storeId: order.storeId, customerId, delta: -take, reason: "return", orderId: order.id } });
        return { revoked: take };
      }
    }
    return { revoked: 0 };
  };
  return opts.tx ? run(opts.tx) : db.$transaction(run);
}

/**
 * Débit de points utilisés au checkout (équipe B, dans la transaction de createOrder). Décrément conditionnel
 * `loyaltyPoints >= points` ; `ok: false` si le solde ne suffit plus (l'appelant lève une CheckoutError lisible).
 */
export async function redeemPointsTx(tx: Tx, p: { storeId: string; customerId: string; points: number; orderId: string }): Promise<{ ok: true; balance: number } | { ok: false; balance: number }> {
  if (!Number.isInteger(p.points) || p.points <= 0) throw new Error("Nombre de points invalide");
  const done = await tx.customer.updateMany({
    where: { id: p.customerId, storeId: p.storeId, loyaltyPoints: { gte: p.points } },
    data: { loyaltyPoints: { decrement: p.points } },
  });
  const customer = await tx.customer.findFirst({ where: { id: p.customerId, storeId: p.storeId }, select: { loyaltyPoints: true } });
  if (done.count === 0) return { ok: false, balance: customer?.loyaltyPoints ?? 0 };
  await tx.loyaltyLedger.create({ data: { storeId: p.storeId, customerId: p.customerId, delta: -p.points, reason: "redeem", orderId: p.orderId } });
  return { ok: true, balance: customer?.loyaltyPoints ?? 0 };
}

/** Rend les points utilisés pour payer une commande (annulation). Idempotent : ne rend que le net non encore rendu. */
export async function reverseRedeemedPointsTx(tx: Tx, p: { storeId: string; orderId: string }): Promise<{ restored: number }> {
  await lockOrderLoyalty(tx, p.orderId);
  const rows = await tx.loyaltyLedger.findMany({
    where: { storeId: p.storeId, orderId: p.orderId, reason: { in: ["redeem", "redeem_reversal"] } },
    select: { delta: true, customerId: true, reason: true },
  });
  const net = rows.reduce((s, r) => s + r.delta, 0);
  const customerId = rows.find((r) => r.reason === "redeem")?.customerId;
  if (net >= 0 || !customerId) return { restored: 0 };
  const restored = -net;
  const done = await tx.customer.updateMany({ where: { id: customerId, storeId: p.storeId }, data: { loyaltyPoints: { increment: restored } } });
  if (done.count === 0) return { restored: 0 }; // fiche supprimée entre-temps
  await tx.loyaltyLedger.create({ data: { storeId: p.storeId, customerId, delta: restored, reason: "redeem_reversal", orderId: p.orderId } });
  return { restored };
}
