import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { enqueue } from "@/lib/jobs";

/**
 * Paniers abandonnés.
 *  - saveCheckoutDraft (actions.ts) enregistre le panier côté serveur et, SI le client a accepté les
 *    messages promotionnels, programme un job `cart.check` à +1 h (reprogrammé à chaque mise à jour) ;
 *  - checkAbandonedCart (job) : panier non converti et aucune commande de ce numéro depuis →
 *    déclencheur `cart.abandoned` (une seule relance par panier, voir l'anti-doublon du moteur).
 * Sans consentement : aucune coordonnée n'est conservée et aucune relance n'est programmée.
 */

export const ABANDON_AFTER_MS = 60 * 60_000;

export type CartCheckPayload = { storeId: string; cartId: string; customerId: string; phone: string; name: string };

/** Programme (ou reporte) la vérification d'abandon d'un panier. */
export async function scheduleCartCheck(tx: Tx, p: CartCheckPayload, now = new Date()) {
  const runAt = new Date(now.getTime() + ABANDON_AFTER_MS);
  const pending = await tx.job.findFirst({ where: { type: "cart.check", status: "PENDING", storeId: p.storeId, payload: { path: ["cartId"], equals: p.cartId } }, select: { id: true } });
  if (pending) {
    await tx.job.update({ where: { id: pending.id }, data: { runAt, payload: p as unknown as Prisma.InputJsonValue } });
  } else {
    await enqueue("cart.check", p, { storeId: p.storeId, runAt }, tx);
  }
}

/** Retire la vérification programmée (consentement retiré, panier vidé). */
export async function cancelCartCheck(tx: Tx, storeId: string, cartId: string) {
  await tx.job.deleteMany({ where: { type: "cart.check", status: "PENDING", storeId, payload: { path: ["cartId"], equals: cartId } } });
}

/** Handler du job `cart.check`. */
export async function checkAbandonedCart(payload: Record<string, unknown>) {
  const p = payload as Partial<CartCheckPayload>;
  if (!p.storeId || !p.cartId) return;
  const cart = await db.cart.findFirst({ where: { id: p.cartId, storeId: p.storeId }, select: { id: true, convertedOrderId: true, createdAt: true, _count: { select: { items: true } } } });
  if (!cart || cart.convertedOrderId || cart._count.items === 0) return;
  if (p.phone) {
    const ordered = await db.order.findFirst({ where: { storeId: p.storeId, customerPhone: p.phone, createdAt: { gte: cart.createdAt } }, select: { id: true } });
    if (ordered) {
      await db.cart.updateMany({ where: { id: cart.id, convertedOrderId: null }, data: { convertedOrderId: ordered.id } });
      return;
    }
  }
  const { fireTrigger } = await import("@/lib/automations/engine");
  await fireTrigger("cart.abandoned", { storeId: p.storeId, cartId: cart.id, customerId: p.customerId ?? null, phone: p.phone ?? null, name: p.name ?? null });
}
