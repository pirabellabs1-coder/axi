import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { assertWritable, auditApi, fmt, requireConfirmation, requireFeature, revalidate, zConfirm, zId, zLimit } from "./common";
import { LOCATION_TYPE_LABELS, type LocationType } from "@/lib/locations/types";
import { applyLevelDeltaIfAvailableTx, itemKeyOf } from "@/lib/inventory/levels";
import { validateTransferDraft } from "@/lib/inventory/transfer";
import { createShipment, recordShipmentEvent, ShippingError } from "@/lib/shipping/service";
import { canTransitionShipment, SHIPMENT_STATUS_LABELS, remainingToShip, shippedByItem, type ShipmentStatusValue } from "@/lib/shipping/state";
import { buildZReport } from "@/lib/pos/cash";
import { randomReference } from "@/lib/utils";

/**
 * Outils MCP du lot 3 (§4) : dépôts, stock par dépôt, transferts, expéditions et rapport de caisse.
 * Mêmes règles que le reste du serveur marchand : scopes, isolation `storeId`, audit `api.*`,
 * confirmation explicite pour les écritures sensibles (transfert de plus de 50 unités).
 */

type Ctx = MerchantContext;

/** Au-delà de ce volume, un transfert demandé par un assistant exige la confirmation du commerçant. */
const TRANSFER_CONFIRM_UNITS = 50;

export const listLocations = defineTool({
  name: "list_locations",
  title: "List locations",
  description:
    "Warehouses, shops and pickup points of the store, with their role (default location, serves online orders, pickup) and the total number of units they hold. Use the returned ids with get_inventory_levels, transfer_stock and create_shipment.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true, idempotentHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    const locations = await db.location.findMany({
      where: { storeId: ctx.store.id },
      orderBy: [{ isDefault: "desc" }, { position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true, city: true, isDefault: true, active: true, fulfillsOnlineOrders: true, pickupEnabled: true },
    });
    if (!locations.length) {
      return { text: "This store has no location yet: its stock is only tracked as a single total.", data: { locations: [] } };
    }
    const sums = await db.inventoryLevel.groupBy({ by: ["locationId"], where: { storeId: ctx.store.id }, _sum: { available: true } });
    const units = new Map(sums.map((s) => [s.locationId, s._sum.available ?? 0]));
    return {
      text: locations
        .map(
          (l) =>
            `- ${l.name} (${LOCATION_TYPE_LABELS[l.type as LocationType]}${l.city ? `, ${l.city}` : ""}): ${units.get(l.id) ?? 0} units${l.isDefault ? ", default" : ""}${l.active ? "" : ", archived"}${l.fulfillsOnlineOrders ? ", serves online orders" : ""}${l.pickupEnabled ? ", pickup" : ""} — id ${l.id}`,
        )
        .join("\n"),
      data: {
        locations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          city: l.city,
          is_default: l.isDefault,
          active: l.active,
          fulfills_online_orders: l.fulfillsOnlineOrders,
          pickup_enabled: l.pickupEnabled,
          units: units.get(l.id) ?? 0,
        })),
      },
    };
  },
});

export const getInventoryLevels = defineTool({
  name: "get_inventory_levels",
  title: "Get inventory levels per location",
  description:
    "Stock of each tracked item per location, plus the store-wide total. The total is what the storefront sells against; the per-location levels drive allocation, transfers and the point of sale. A negative level means an oversell at that location.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true, idempotentHint: true },
  input: z.object({
    product_id: zId.optional().describe("Only this product (and its variants)."),
    location_id: zId.optional().describe("Only this location (see list_locations)."),
    limit: zLimit(30, 100),
  }),
  handler: async (ctx: Ctx, a) => {
    const levels = await db.inventoryLevel.findMany({
      where: { storeId: ctx.store.id, ...(a.product_id ? { productId: a.product_id } : {}), ...(a.location_id ? { locationId: a.location_id } : {}) },
      orderBy: [{ productId: "asc" }],
      take: a.limit * 4,
      select: {
        available: true,
        locationId: true,
        productId: true,
        variantId: true,
        location: { select: { name: true } },
        product: { select: { name: true, stock: true } },
        variant: { select: { name: true, stock: true } },
      },
    });
    if (!levels.length) return { text: "No inventory level recorded (no location, or no tracked item).", data: { items: [] } };

    const byItem = new Map<string, { label: string; total: number; locations: { id: string; name: string; available: number }[] }>();
    for (const l of levels) {
      const key = itemKeyOf(l.productId, l.variantId);
      const row = byItem.get(key) ?? {
        label: `${l.product.name}${l.variant ? ` (${l.variant.name})` : ""}`,
        total: l.variant ? l.variant.stock : l.product.stock,
        locations: [],
      };
      row.locations.push({ id: l.locationId, name: l.location.name, available: l.available });
      byItem.set(key, row);
    }
    const items = [...byItem.entries()].slice(0, a.limit);
    return {
      text: items
        .map(([key, row]) => {
          const sum = row.locations.reduce((s, x) => s + x.available, 0);
          const gap = row.total - sum;
          return `- ${row.label}: total ${row.total} = ${row.locations.map((x) => `${x.name} ${x.available}`).join(" + ")}${gap !== 0 ? ` (${gap > 0 ? `${gap} in transit or unassigned` : `${-gap} too many: run a stock count`})` : ""} — item ${key}`;
        })
        .join("\n"),
      data: {
        items: items.map(([key, row]) => ({
          item_key: key,
          label: row.label,
          total: row.total,
          locations: row.locations.map((x) => ({ location_id: x.id, name: x.name, available: x.available })),
        })),
      },
    };
  },
});

export const transferStock = defineTool({
  name: "transfer_stock",
  title: "Transfer stock between locations",
  description:
    "Move units of one item from one location to another. The store-wide total never changes: the units leave the source immediately and are credited to the destination on receipt (the transfer is created and shipped in one call, then received from the Axi interface). Transfers above 50 units require explicit merchant confirmation.",
  scopes: ["inventory:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  input: z.object({
    product_id: zId.describe("Product id (see search_products)."),
    variant_id: zId.optional().describe("Variant id when the product has variants."),
    from_location_id: zId.describe("Source location (see list_locations)."),
    to_location_id: zId.describe("Destination location."),
    quantity: z.number().int().min(1).max(100_000).describe("Number of units to move."),
    note: z.string().trim().max(200).optional(),
    confirm: zConfirm.describe("Required (true) for transfers of more than 50 units."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireFeature(ctx, "stockTransfers", "Stock transfers between locations");
    const invalid = validateTransferDraft({ fromLocationId: a.from_location_id, toLocationId: a.to_location_id, items: [{ quantity: a.quantity }] });
    if (invalid) throw new ToolError(invalid, "invalid_input");
    if (a.quantity > TRANSFER_CONFIRM_UNITS) requireConfirmation(a.confirm, `${a.quantity} units is above the ${TRANSFER_CONFIRM_UNITS} unit threshold`);

    const [from, to, product] = await Promise.all([
      db.location.findFirst({ where: { id: a.from_location_id, storeId: ctx.store.id }, select: { id: true, name: true } }),
      db.location.findFirst({ where: { id: a.to_location_id, storeId: ctx.store.id }, select: { id: true, name: true } }),
      db.product.findFirst({ where: { id: a.product_id, storeId: ctx.store.id }, select: { id: true, name: true, trackStock: true, variants: { select: { id: true, name: true } } } }),
    ]);
    if (!from || !to) throw new ToolError("Unknown location for this store.", "not_found");
    if (!product) throw new ToolError("Unknown product for this store.", "not_found");
    if (!product.trackStock) throw new ToolError("This product does not track stock.", "invalid_input");
    const variant = a.variant_id ? product.variants.find((v) => v.id === a.variant_id) : null;
    if (a.variant_id && !variant) throw new ToolError("Unknown variant for this product.", "not_found");

    const result = await db.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.create({
        data: {
          storeId: ctx.store.id,
          reference: randomReference("TR"),
          fromLocationId: from.id,
          toLocationId: to.id,
          status: "IN_TRANSIT",
          shippedAt: new Date(),
          note: a.note ?? null,
          createdById: ctx.actor.userId,
          items: { create: [{ productId: product.id, variantId: variant?.id ?? null, quantity: a.quantity }] },
        },
        select: { id: true, reference: true },
      });
      const moved = await applyLevelDeltaIfAvailableTx(tx, { storeId: ctx.store.id, locationId: from.id, productId: product.id, variantId: variant?.id ?? null, delta: -a.quantity });
      if (!moved) return { ok: false as const };
      await tx.inventoryMovement.create({
        data: { storeId: ctx.store.id, productId: product.id, variantId: variant?.id ?? null, locationId: from.id, delta: -a.quantity, reason: "TRANSFER", note: `Transfert ${transfer.reference} (sortie, via assistant)`, actorId: ctx.actor.userId },
      });
      return { ok: true as const, transfer };
    });
    if (!result.ok) throw new ToolError(`Not enough stock of ${product.name} at ${from.name}.`, "conflict");

    await auditApi(ctx, "stock_transfer.created", result.transfer.id, { reference: result.transfer.reference, quantity: a.quantity, from: from.id, to: to.id });
    revalidate(ctx, `/app/${ctx.store.id}/depots`, `/app/${ctx.store.id}/stock/transferts`);
    return {
      text: `Transfer ${result.transfer.reference} shipped: ${a.quantity} × ${product.name}${variant ? ` (${variant.name})` : ""} left ${from.name} for ${to.name}. Receive it in Axi (Stock > Transfers) to credit the destination; the store-wide total is unchanged.`,
      data: { transfer_id: result.transfer.id, reference: result.transfer.reference, status: "IN_TRANSIT", quantity: a.quantity },
    };
  },
});

export const createShipmentTool = defineTool({
  name: "create_shipment",
  title: "Create a shipment for an order",
  description:
    "Create a shipment (possibly partial) for the physical lines of an order, with an internal courier (printable A6 label and courier page in Axi) or a configured carrier. Returns the shipment id and, when asked, the 4-digit delivery code to pass to the buyer (shown once).",
  scopes: ["orders:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  input: z.object({
    order_id: zId.describe("Order id (see search_orders)."),
    carrier_account_id: zId.optional().describe("Carrier account to use; omit for the internal courier."),
    location_id: zId.optional().describe("Location the parcel ships from (see list_locations)."),
    courier_name: z.string().trim().max(80).optional(),
    courier_phone: z.string().trim().max(20).optional(),
    tracking_number: z.string().trim().max(60).optional(),
    items: z
      .array(z.object({ order_item_id: zId, quantity: z.number().int().min(1).max(10_000) }))
      .min(1)
      .max(50)
      .optional()
      .describe("Lines and quantities to ship. Omit to ship everything that is still unshipped."),
    with_delivery_code: z.boolean().default(false).describe("Ask the buyer for a 4-digit code on delivery (anti-fraud, Business plan and above)."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const order = await db.order.findFirst({
      where: { id: a.order_id, storeId: ctx.store.id },
      select: { id: true, reference: true, items: { select: { id: true, name: true, variantName: true, quantity: true, kind: true, locationId: true } } },
    });
    if (!order) throw new ToolError("Unknown order for this store.", "not_found");
    if (a.with_delivery_code) requireFeature(ctx, "couriers", "Delivery codes and the courier page");

    let carrier = "manual";
    if (a.carrier_account_id) {
      const account = await db.carrierAccount.findFirst({ where: { id: a.carrier_account_id, storeId: ctx.store.id, active: true }, select: { carrier: true } });
      if (!account) throw new ToolError("Unknown carrier account for this store.", "not_found");
      carrier = account.carrier;
    }
    if (a.location_id) {
      const location = await db.location.findFirst({ where: { id: a.location_id, storeId: ctx.store.id }, select: { id: true } });
      if (!location) throw new ToolError("Unknown location for this store.", "not_found");
    }

    const shipmentItems = await db.shipmentItem.findMany({
      where: { shipment: { orderId: order.id } },
      select: { orderItemId: true, quantity: true, shipment: { select: { status: true } } },
    });
    const shipped = shippedByItem(shipmentItems.map((s) => ({ orderItemId: s.orderItemId, quantity: s.quantity, status: s.shipment.status as ShipmentStatusValue })));
    const requested =
      a.items?.map((i) => ({ orderItemId: i.order_item_id, quantity: i.quantity })) ??
      order.items.filter((i) => i.kind === "PHYSICAL").map((i) => ({ orderItemId: i.id, quantity: remainingToShip(i.quantity, shipped.get(i.id) ?? 0) }));
    if (!requested.some((i) => i.quantity > 0)) throw new ToolError("Everything is already shipped on this order.", "conflict");

    try {
      const created = await createShipment({
        storeId: ctx.store.id,
        orderId: order.id,
        carrier,
        carrierAccountId: a.carrier_account_id ?? null,
        locationId: a.location_id ?? null,
        courierName: a.courier_name ?? null,
        courierPhone: a.courier_phone ?? null,
        trackingNumber: a.tracking_number ?? null,
        items: requested,
        actorId: ctx.actor.userId,
        withDeliveryCode: a.with_delivery_code,
      });
      await auditApi(ctx, "shipment.created", created.id, { orderId: order.id, carrier, lines: requested.length });
      revalidate(ctx, `/app/${ctx.store.id}/commandes/${order.id}`);
      return {
        text: `Shipment created for order ${order.reference} (${carrier === "manual" ? "internal courier" : carrier}).${created.deliveryCode ? ` Delivery code to give the buyer (shown once): ${created.deliveryCode}.` : ""} Courier link: /livraison/${created.courierToken}`,
        data: { shipment_id: created.id, delivery_code: created.deliveryCode, courier_url: `/livraison/${created.courierToken}` },
      };
    } catch (e) {
      if (e instanceof ShippingError) throw new ToolError(e.message, "conflict");
      throw e;
    }
  },
});

export const updateShipmentStatusTool = defineTool({
  name: "update_shipment_status",
  title: "Update a shipment status",
  description:
    "Move a shipment forward: label created, picked up, in transit, out for delivery, delivered, failed attempt, returned or cancelled. Only transitions allowed by the shipment state machine are accepted, and a shipment that already left cannot be cancelled.",
  scopes: ["orders:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  input: z.object({
    shipment_id: zId.describe("Shipment id (see create_shipment or the order page)."),
    status: z.enum(["LABEL_CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT", "RETURNED", "CANCELLED"]),
    message: z.string().trim().max(200).optional().describe("Short note kept in the shipment timeline."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const shipment = await db.shipment.findFirst({ where: { id: a.shipment_id, storeId: ctx.store.id }, select: { id: true, status: true, orderId: true } });
    if (!shipment) throw new ToolError("Unknown shipment for this store.", "not_found");
    const current = shipment.status as ShipmentStatusValue;
    if (!canTransitionShipment(current, a.status)) {
      throw new ToolError(`A shipment in state "${SHIPMENT_STATUS_LABELS[current]}" cannot move to "${SHIPMENT_STATUS_LABELS[a.status]}".`, "conflict");
    }
    const result = await recordShipmentEvent({
      storeId: ctx.store.id,
      shipmentId: shipment.id,
      status: a.status,
      source: "manual",
      strict: true,
      message: a.message ?? null,
      actorId: ctx.actor.userId,
    });
    if (!result.applied) throw new ToolError("This transition is no longer possible (the shipment changed in the meantime).", "conflict");
    await auditApi(ctx, "shipment.status_changed", shipment.id, { status: a.status });
    revalidate(ctx, `/app/${ctx.store.id}/commandes/${shipment.orderId}`);
    return { text: `Shipment updated: ${SHIPMENT_STATUS_LABELS[a.status]}.`, data: { shipment_id: shipment.id, status: a.status } };
  },
});

export const posDailyReport = defineTool({
  name: "pos_daily_report",
  title: "Point of sale daily report",
  description:
    "Counter sales of a given day: number of sales, revenue, split by payment method, cash expected versus counted, and any offline price mismatch to review. Read-only.",
  scopes: ["analytics:read"],
  annotations: { readOnlyHint: true, idempotentHint: true },
  input: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Day in YYYY-MM-DD (store time zone); defaults to today."),
  }),
  handler: async (ctx: Ctx, a) => {
    const day = a.date ?? new Date().toISOString().slice(0, 10);
    const from = new Date(`${day}T00:00:00.000Z`);
    const to = new Date(from.getTime() + 24 * 3_600_000);
    if (Number.isNaN(from.getTime())) throw new ToolError("Invalid date.", "invalid_input");

    const [sales, sessions] = await Promise.all([
      db.order.findMany({
        where: { storeId: ctx.store.id, channel: "POS", createdAt: { gte: from, lt: to } },
        select: { total: true, discount: true, taxTotal: true, priceSource: true, paymentAttempts: { select: { provider: true, amount: true, status: true } } },
      }),
      db.posSession.findMany({
        where: { storeId: ctx.store.id, openedAt: { gte: from, lt: to } },
        select: { id: true, status: true, openingFloat: true, countedCash: true, expectedCash: true, discrepancy: true, device: { select: { name: true } }, cashMoves: { select: { kind: true, amount: true } } },
      }),
    ]);
    const report = buildZReport({
      sales: sales.map((s) => ({ total: s.total, discount: s.discount, taxTotal: s.taxTotal, priceSource: s.priceSource })),
      payments: sales.flatMap((s) => s.paymentAttempts.filter((p) => p.status === "CONFIRMED").map((p) => ({ kind: p.provider, amount: p.amount }))),
      cashMoves: sessions.flatMap((s) => s.cashMoves),
      openingFloat: sessions.reduce((s, x) => s + x.openingFloat, 0),
      countedCash: sessions.every((s) => s.countedCash != null) && sessions.length ? sessions.reduce((s, x) => s + (x.countedCash ?? 0), 0) : null,
    });
    const text = [
      `Point of sale — ${day}: ${report.salesCount} sale(s) for ${fmt(ctx, report.grossTotal)} (discounts ${fmt(ctx, report.discountTotal)}, tax ${fmt(ctx, report.taxTotal)}).`,
      Object.entries(report.byPayment).length ? `By payment method: ${Object.entries(report.byPayment).map(([k, v]) => `${k} ${fmt(ctx, v)}`).join(", ")}.` : "No payment recorded.",
      `Cash: expected ${fmt(ctx, report.expectedCash)}${report.countedCash != null ? `, counted ${fmt(ctx, report.countedCash)} (gap ${fmt(ctx, report.discrepancy ?? 0)})` : " (sessions still open)"}.`,
      sessions.length ? `Sessions: ${sessions.map((s) => `${s.device.name} ${s.status === "OPEN" ? "open" : `closed, gap ${fmt(ctx, s.discrepancy ?? 0)}`}`).join("; ")}.` : "No cash session that day.",
      report.offlinePriceMismatches ? `${report.offlinePriceMismatches} offline sale(s) kept at the collected price: review them.` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return { text, data: { date: day, ...report, sessions: sessions.map((s) => ({ id: s.id, device: s.device.name, status: s.status, expected_cash: s.expectedCash, counted_cash: s.countedCash, discrepancy: s.discrepancy })) } };
  },
});

export const OPERATIONS_TOOLS: McpTool<Ctx>[] = [listLocations, getInventoryLevels, transferStock, createShipmentTool, updateShipmentStatusTool, posDailyReport];
