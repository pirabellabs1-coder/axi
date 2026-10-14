"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, zId, zMoney, badIds, type ActionResult } from "@/lib/action";
import { transitionOrder, createOrder as createOrderService } from "@/lib/commerce/orders";
import { canTransition } from "@/lib/commerce/order-state";
import { summarizeCartKinds } from "@/lib/digital/kinds";
import { confirmManualPayment, markPaymentFailed, requestRefund } from "@/lib/payments/service";
import { audit } from "@/lib/audit";

const ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REFUNDED"] as const;

function revalidateOrder(storeId: string, orderId: string) {
  revalidatePath(`/app/${storeId}`);
  revalidatePath(`/app/${storeId}/commandes`);
  revalidatePath(`/app/${storeId}/commandes/${orderId}`);
}

/** Changement de statut via la machine d'états (transitionOrder). */
export async function changeOrderStatus(storeId: string, orderId: string, to: OrderStatus, reason?: string): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z
      .object({ storeId: zId, orderId: zId, to: z.enum(ORDER_STATUSES), reason: z.string().trim().max(300).optional() })
      .safeParse({ storeId, orderId, to, reason: reason || undefined });
    if (!parsed.success) return fail("Paramètres invalides");
    const ctx = await requireStore(storeId, "orders.manage");
    const order = await db.order.findFirst({ where: { id: orderId, storeId: ctx.store.id }, select: { status: true, items: { select: { kind: true, isGiftCard: true } } } });
    if (!order) return fail("Commande introuvable");
    // Vague 2 : commande sans article à expédier (numérique, service, carte cadeau) → remise directe possible.
    const intangible = summarizeCartKinds(order.items).digitalOnly;
    if (!canTransition(order.status, parsed.data.to, { intangible })) return fail("Cette transition n'est pas possible depuis le statut actuel.");
    if (parsed.data.to === "CANCELLED" && !parsed.data.reason) return fail("Indiquez un motif d'annulation.");
    try {
      await transitionOrder({ orderId, storeId: ctx.store.id, to: parsed.data.to, actorId: ctx.user.id, actorLabel: ctx.user.name, reason: parsed.data.reason, intangible });
    } catch (e) {
      return fail((e as Error).message);
    }
    revalidateOrder(ctx.store.id, orderId);
    return success(undefined, "Statut mis à jour");
  });
}

export async function confirmPayment(storeId: string, orderId: string, note?: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "payments.confirm");
    const n = z.string().trim().max(300).optional().parse(note || undefined);
    try {
      await confirmManualPayment({ orderId, storeId: ctx.store.id, actorId: ctx.user.id, actorLabel: ctx.user.name, note: n });
    } catch (e) {
      return fail((e as Error).message);
    }
    revalidateOrder(ctx.store.id, orderId);
    return success(undefined, "Paiement confirmé");
  });
}

export async function failPayment(storeId: string, orderId: string, reason: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "payments.confirm");
    const r = z.string().trim().min(2, "Indiquez un motif").max(300).safeParse(reason);
    if (!r.success) return fail("Indiquez un motif (2 caractères minimum).");
    try {
      await markPaymentFailed({ orderId, storeId: ctx.store.id, actorId: ctx.user.id, actorLabel: ctx.user.name, reason: r.data });
    } catch (e) {
      return fail((e as Error).message);
    }
    revalidateOrder(ctx.store.id, orderId);
    return success(undefined, "Paiement marqué en échec");
  });
}

/**
 * Remboursement (lot 1) : `destination` « original » (défaut : paiement externe, puis cartes cadeaux, puis avoir)
 * ou « store_credit » (crédité en avoir du client, `customers.manage` requis en plus).
 */
export async function refundOrder(storeId: string, orderId: string, amount: number, reason?: string, destination: "original" | "store_credit" = "original"): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, orderId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "payments.confirm");
    const a = zMoney.safeParse(amount);
    if (!a.success || a.data <= 0) return fail("Montant invalide");
    const d = z.enum(["original", "store_credit"]).safeParse(destination);
    if (!d.success) return fail("Destination de remboursement invalide");
    if (d.data === "store_credit") await requireStore(storeId, "customers.manage");
    const r = z.string().trim().max(300).optional().parse(reason || undefined);
    try {
      await requestRefund({ orderId, storeId: ctx.store.id, actorId: ctx.user.id, actorLabel: ctx.user.name, amount: a.data, reason: r, destination: d.data });
    } catch (e) {
      return fail((e as Error).message);
    }
    revalidateOrder(ctx.store.id, orderId);
    return success(undefined, d.data === "store_credit" ? "Remboursement crédité en avoir" : "Remboursement enregistré");
  });
}

export async function updateInternalNote(storeId: string, orderId: string, note: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "orders.manage");
    const n = z.string().trim().max(2000).parse(note ?? "");
    const r = await db.order.updateMany({ where: { id: orderId, storeId: ctx.store.id }, data: { internalNote: n || null } });
    if (r.count === 0) return fail("Commande introuvable");
    await db.orderEvent.create({ data: { orderId, actorId: ctx.user.id, actorLabel: ctx.user.name, type: "note", message: n ? "Note interne mise à jour" : "Note interne supprimée" } });
    revalidateOrder(ctx.store.id, orderId);
    return success(undefined, "Note enregistrée");
  });
}

export async function assignCourier(storeId: string, orderId: string, courierName: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "orders.assign");
    const name = z.string().trim().max(80).parse(courierName ?? "");
    const r = await db.order.updateMany({ where: { id: orderId, storeId: ctx.store.id }, data: { courierName: name || null } });
    if (r.count === 0) return fail("Commande introuvable");
    await db.orderEvent.create({ data: { orderId, actorId: ctx.user.id, actorLabel: ctx.user.name, type: "note", message: name ? `Livreur assigné : ${name}` : "Livreur retiré" } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "order.courier_assigned", target: orderId, metadata: { courierName: name } });
    revalidateOrder(ctx.store.id, orderId);
    return success(undefined, name ? "Livreur assigné" : "Livreur retiré");
  });
}

/* ───────────── Création manuelle ───────────── */

const manualOrderSchema = z.object({
  storeId: zId,
  idempotencyKey: z.string().min(8).max(64),
  customerName: z.string().trim().min(2, "Nom du client requis").max(80),
  customerPhone: z.string().trim().min(6, "Téléphone requis").max(20),
  customerEmail: z.preprocess((v) => (v === "" ? undefined : v), z.string().email("E-mail invalide").optional()),
  fulfillmentType: z.enum(["PICKUP", "DELIVERY", "WHATSAPP"]),
  deliveryZoneId: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  deliveryAddress: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(300).optional()),
  paymentMethodId: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  note: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(500).optional()),
  /** Lot 1 : utiliser l'avoir du client (capacité customers.manage). */
  useStoreCredit: z.boolean().optional(),
  items: z
    .array(z.object({ productId: z.string().min(1), variantId: z.string().optional().nullable(), quantity: z.coerce.number().int().min(1).max(999) }))
    .min(1, "Ajoutez au moins un article")
    .max(50),
});

export type ManualOrderInput = z.input<typeof manualOrderSchema>;

export async function createManualOrder(input: ManualOrderInput): Promise<ActionResult<{ orderId: string; reference: string }>> {
  return guard(async () => {
    const parsed = manualOrderSchema.safeParse(input);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      const first = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? "Formulaire invalide";
      return fail(String(first), flat.fieldErrors as Record<string, string[]>);
    }
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "orders.manage");
    if (d.useStoreCredit && !ctx.can("customers.manage")) return fail("Votre rôle ne permet pas d'utiliser l'avoir d'un client.");
    const res = await createOrderService({
      storeSlug: ctx.store.slug,
      idempotencyKey: d.idempotencyKey,
      items: d.items.map((i) => ({ productId: i.productId, variantId: i.variantId || null, quantity: i.quantity })),
      fulfillmentType: d.fulfillmentType,
      deliveryZoneId: d.deliveryZoneId ?? null,
      deliveryAddress: d.deliveryAddress ?? null,
      customer: { name: d.customerName, phone: d.customerPhone, email: d.customerEmail ?? null, note: d.note ?? null },
      paymentMethodId: d.paymentMethodId ?? null,
      channel: "MANUAL",
      useStoreCredit: d.useStoreCredit === true,
      merchantCanUseStoreCredit: d.useStoreCredit === true,
    });
    if (!res.ok) return fail(res.error, res.field ? { [res.field]: [res.error] } : undefined);
    const creditUsed = res.total - res.amountDue;
    if (!res.duplicate) {
      await db.orderEvent.create({ data: { orderId: res.orderId, actorId: ctx.user.id, actorLabel: ctx.user.name, type: "note", message: "Commande saisie manuellement" } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "order.created_manual", target: res.orderId, metadata: creditUsed > 0 ? { storeCreditUsed: creditUsed } : undefined });
      if (creditUsed > 0) await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "store_credit.used_manual_order", target: res.orderId, metadata: { amount: creditUsed } });
    }
    revalidatePath(`/app/${ctx.store.id}`);
    revalidatePath(`/app/${ctx.store.id}/commandes`);
    return success({ orderId: res.orderId, reference: res.reference }, creditUsed > 0 ? `Commande ${res.reference} créée (avoir utilisé : ${creditUsed} ${ctx.store.currency})` : `Commande ${res.reference} créée`);
  });
}
