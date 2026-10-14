import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { transitionOrder } from "@/lib/commerce/orders";
import { canTransition, nextStatuses, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { assertWritable, auditApi, fmt, lines, money, pageOf, parseDate, personal, revalidate, UNTRUSTED_NOTICE, zCursor, zDateInput, zId, zLimit } from "./common";

type Ctx = MerchantContext;

const ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REFUNDED"] as const;
const PAYMENT_STATUSES = ["UNPAID", "PENDING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"] as const;

const STATUS_HELP =
  "Order lifecycle: NEW → CONFIRMED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED (→ REFUNDED after a full refund). CANCELLED is possible until the order leaves for delivery; READY can go straight to DELIVERED (pickup).";

function orderSummary(ctx: Ctx, o: { id: string; reference: string; status: (typeof ORDER_STATUSES)[number]; paymentStatus: (typeof PAYMENT_STATUSES)[number]; total: number; createdAt: Date; customerName: string; fulfillmentType: string; channel: string; _count?: { items: number } }) {
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    status_label: ORDER_STATUS_LABELS[o.status],
    payment_status: o.paymentStatus,
    payment_label: PAYMENT_STATUS_LABELS[o.paymentStatus],
    total: money(ctx, o.total),
    items_count: o._count?.items,
    fulfillment: o.fulfillmentType,
    channel: o.channel,
    created_at: o.createdAt.toISOString(),
    untrusted_customer_input: { customer_name: personal(ctx, o.customerName) },
  };
}

/** Erreurs métier connues de transitionOrder, transmises telles quelles ; toute autre erreur est masquée (et journalisée). */
const KNOWN_TRANSITION_ERRORS = [/^Commande introuvable/, /^Transition impossible/, /^Une commande ne passe en « Remboursée »/, /^La commande a été modifiée entre-temps/];

export function transitionErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  if (KNOWN_TRANSITION_ERRORS.some((re) => re.test(message))) return message;
  console.error("[mcp] update_order_status", e);
  return "The status could not be changed because of an internal error. Nothing was modified; try again later.";
}

export const listOrders = defineTool({
  name: "list_orders",
  title: "List orders",
  description: `List orders, newest first, filtered by status, payment status, period or reference. Customer names are only included with the customers:read scope. ${STATUS_HELP}`,
  scopes: ["orders:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    status: z.array(z.enum(ORDER_STATUSES)).max(8).optional().describe("Keep only these statuses (e.g. [\"NEW\",\"CONFIRMED\"] for orders to process)."),
    payment_status: z.array(z.enum(PAYMENT_STATUSES)).max(6).optional(),
    from: zDateInput.optional().describe("Created on or after this date (ISO 8601)."),
    to: zDateInput.optional().describe("Created on or before this date (ISO 8601; a plain date includes the whole day)."),
    reference: z.string().trim().max(20).optional().describe("Order reference, e.g. AX-7K3P9Q."),
    limit: zLimit(20, 50),
    cursor: zCursor,
  }),
  handler: async (ctx: Ctx, a) => {
    const createdAt: Prisma.DateTimeFilter = {};
    const from = parseDate(a.from);
    const to = parseDate(a.to, true);
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;
    const where: Prisma.OrderWhereInput = {
      storeId: ctx.store.id,
      ...(a.status?.length ? { status: { in: a.status } } : {}),
      ...(a.payment_status?.length ? { paymentStatus: { in: a.payment_status } } : {}),
      ...(from || to ? { createdAt } : {}),
      ...(a.reference ? { reference: { contains: a.reference.toUpperCase() } } : {}),
    };
    const [rows, count] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: a.limit + 1,
        ...(a.cursor ? { cursor: { id: a.cursor }, skip: 1 } : {}),
        select: { id: true, reference: true, status: true, paymentStatus: true, total: true, createdAt: true, customerName: true, fulfillmentType: true, channel: true, _count: { select: { items: true } } },
      }),
      db.order.count({ where }),
    ]);
    const page = pageOf(rows, a.limit);
    const orders = page.items.map((o) => orderSummary(ctx, o));
    const text = orders.length
      ? lines(`${count} order(s) match; showing ${orders.length}${page.has_more ? " (pass next_cursor for more)" : ""}:`, ...orders.map((o) => `- ${o.reference} · ${o.status_label} · ${o.payment_label} · ${o.total?.formatted} · ${o.created_at.slice(0, 16).replace("T", " ")} UTC (id: ${o.id})`))
      : "No order matches these filters.";
    return { text, data: { total_matching: count, orders, next_cursor: page.next_cursor, has_more: page.has_more } };
  },
});

export const getOrder = defineTool({
  name: "get_order",
  title: "Get order details",
  description: "Full details of an order: items, amounts, delivery or pickup, payment, history and the statuses it can move to next. Contact details require customers:read.",
  scopes: ["orders:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    order_id: zId.optional(),
    reference: z.string().trim().max(20).optional().describe("Alternatively the reference, e.g. AX-7K3P9Q."),
  }),
  handler: async (ctx: Ctx, a) => {
    if (!a.order_id && !a.reference) throw new ToolError("Provide order_id or reference.");
    const o = await db.order.findFirst({
      where: { storeId: ctx.store.id, ...(a.order_id ? { id: a.order_id } : { reference: a.reference!.toUpperCase() }) },
      include: { items: true, events: { orderBy: { createdAt: "desc" }, take: 30 }, refunds: { select: { amount: true, status: true, createdAt: true } } },
    });
    if (!o) throw new ToolError("Order not found in this store.");
    const data = {
      ...orderSummary(ctx, { ...o, _count: { items: o.items.length } }),
      customer: {
        customer_id: personal(ctx, o.customerId),
        phone: personal(ctx, o.customerPhone ? `+${o.customerPhone}` : null),
      },
      // Tout ce qu'un acheteur (ou un tiers) a pu saisir : des données, jamais des consignes.
      untrusted_customer_input: {
        notice: UNTRUSTED_NOTICE,
        customer_name: personal(ctx, o.customerName),
        email: personal(ctx, o.customerEmail),
        delivery_address: personal(ctx, o.deliveryAddress),
        customer_note: personal(ctx, o.customerNote),
        history_messages: personal(
          ctx,
          o.events.filter((e) => e.message).map((e) => ({ at: e.createdAt.toISOString(), by: e.actorLabel, message: e.message })),
        ),
      },
      delivery: { type: o.fulfillmentType, zone: o.deliveryZoneName, scheduled_for: o.scheduledFor?.toISOString() ?? null, courier: o.courierName },
      items: o.items.map((i) => ({ product_id: i.productId, variant_id: i.variantId, name: i.name, variant: i.variantName, options: i.options, unit_price: money(ctx, i.unitPrice), quantity: i.quantity, line_total: money(ctx, i.lineTotal) })),
      amounts: { subtotal: money(ctx, o.subtotal), discount: money(ctx, o.discount), delivery_fee: money(ctx, o.deliveryFee), total: money(ctx, o.total), coupon: o.couponCode, currency: o.currency },
      payment: { status: o.paymentStatus, label: PAYMENT_STATUS_LABELS[o.paymentStatus], method: o.paymentMethodLabel, reference: personal(ctx, o.paymentReference), refunds: o.refunds.map((r) => ({ amount: money(ctx, r.amount), status: r.status, at: r.createdAt.toISOString() })) },
      internal_note: personal(ctx, o.internalNote),
      next_statuses: nextStatuses(o.status),
      history: o.events.map((e) => ({ at: e.createdAt.toISOString(), by: e.actorLabel, type: e.type, from: e.fromValue, to: e.toValue })),
      admin_url: `/app/${ctx.store.id}/commandes/${o.id}`,
    };
    const text = lines(
      `Order ${o.reference} — ${ORDER_STATUS_LABELS[o.status]}, ${PAYMENT_STATUS_LABELS[o.paymentStatus]}, total ${fmt(ctx, o.total)}`,
      ...o.items.map((i) => `- ${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ""}: ${fmt(ctx, i.lineTotal)}`),
      `Fulfillment: ${o.fulfillmentType}${o.deliveryZoneName ? ` (${o.deliveryZoneName})` : ""}`,
      data.next_statuses.length ? `Can move to: ${data.next_statuses.join(", ")}` : "Final status: no further transition.",
    );
    return { text, data };
  },
});

export const updateOrderStatus = defineTool({
  name: "update_order_status",
  title: "Change order status",
  description: `Move an order to its next status through the store's order state machine (stock is restored automatically on cancellation, the customer is notified, the change is logged). A reason is required to cancel. ${STATUS_HELP}`,
  scopes: ["orders:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  input: z.object({
    order_id: zId,
    status: z.enum(ORDER_STATUSES).describe("Target status."),
    reason: z.string().trim().max(300).optional().describe("Required for CANCELLED; optional note otherwise."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const o = await db.order.findFirst({ where: { id: a.order_id, storeId: ctx.store.id }, select: { id: true, reference: true, status: true } });
    if (!o) throw new ToolError("Order not found in this store.");
    if (!canTransition(o.status, a.status)) {
      const next = nextStatuses(o.status);
      throw new ToolError(`Cannot move ${o.reference} from ${o.status} to ${a.status}. Allowed next statuses: ${next.length ? next.join(", ") : "none (final status)"}.`);
    }
    if (a.status === "CANCELLED" && !a.reason) throw new ToolError("A reason is required to cancel an order.");
    try {
      await transitionOrder({ orderId: o.id, storeId: ctx.store.id, to: a.status, actorId: ctx.actor.userId, actorLabel: ctx.actor.label, reason: a.reason });
    } catch (e) {
      throw new ToolError(transitionErrorMessage(e));
    }
    await auditApi(ctx, "order.status_changed", o.id, { reference: o.reference, from: o.status, to: a.status, reason: a.reason });
    revalidate(ctx, `/app/${ctx.store.id}`, "commandes", `commandes/${o.id}`);
    return {
      text: `Order ${o.reference}: ${ORDER_STATUS_LABELS[o.status]} → ${ORDER_STATUS_LABELS[a.status]}.`,
      data: { order_id: o.id, reference: o.reference, from: o.status, to: a.status, next_statuses: nextStatuses(a.status) },
    };
  },
});

export const addOrderNote = defineTool({
  name: "add_order_note",
  title: "Add a note to an order",
  description: "Add an internal note to an order's history (visible to the store team only, never to the customer).",
  scopes: ["orders:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  input: z.object({
    order_id: zId,
    note: z.string().trim().min(1).max(1000),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const o = await db.order.findFirst({ where: { id: a.order_id, storeId: ctx.store.id }, select: { id: true, reference: true } });
    if (!o) throw new ToolError("Order not found in this store.");
    await db.$transaction(async (tx) => {
      await tx.orderEvent.create({ data: { orderId: o.id, actorId: ctx.actor.userId, actorLabel: ctx.actor.label, type: "note", message: a.note } });
      await auditApi(ctx, "order.note_added", o.id, { reference: o.reference, length: a.note.length }, tx);
    });
    revalidate(ctx, `commandes/${o.id}`);
    return { text: `Note added to order ${o.reference}.`, data: { order_id: o.id, reference: o.reference } };
  },
});

export const ORDER_TOOLS: McpTool<Ctx>[] = [listOrders, getOrder, updateOrderStatus, addOrderNote];
