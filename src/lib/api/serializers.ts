import "server-only";
import type { Prisma } from "@prisma/client";
import { effectivePrice } from "@/lib/commerce/pricing";
import { nextStatuses } from "@/lib/commerce/order-state";
import { appBaseUrl } from "@/lib/mcp/runtime";
import type { PublicEndpoint, DeliveryRow } from "@/lib/webhooks/service";

/**
 * Représentations publiques de l'API REST (version 2026-10). Montants : entiers dans la plus petite unité de la
 * devise (`currency`). Dates ISO 8601 UTC. Les données personnelles des commandes ne sont incluses qu'avec le scope
 * customers:read (sinon `customer: null`).
 */

const policy = (p: string) => (p === "CONTINUE" ? "continue" : "deny");

function images(raw: unknown): { url: string; alt: string | null }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is { url: string; alt?: string } => !!i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string" && !(i as { url: string }).url.startsWith("data:"))
    .map((i) => ({ url: i.url.startsWith("/") ? `${appBaseUrl()}${i.url}` : i.url, alt: i.alt ?? null }));
}

export const PRODUCT_SELECT = {
  id: true, name: true, slug: true, description: true, status: true, price: true, compareAtPrice: true, promoPrice: true, promoStart: true, promoEnd: true,
  sku: true, barcode: true, trackStock: true, stock: true, inventoryPolicy: true, lowStockThreshold: true, tags: true, images: true, vendor: true,
  productType: true, isFeatured: true, createdAt: true, updatedAt: true,
  variants: { orderBy: { position: "asc" }, select: { id: true, name: true, attributes: true, price: true, compareAtPrice: true, sku: true, barcode: true, stock: true, inventoryPolicy: true, available: true } },
} satisfies Prisma.ProductSelect;

export type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

export function serializeProduct(p: ProductRow, store: { slug: string; currency: string }) {
  const eff = effectivePrice(p);
  return {
    id: p.id,
    object: "product",
    name: p.name,
    slug: p.slug,
    status: p.status,
    description: p.description ?? "",
    currency: store.currency,
    price: p.price,
    current_price: eff.price,
    compare_at_price: p.compareAtPrice,
    promo: p.promoPrice != null ? { price: p.promoPrice, starts_at: p.promoStart?.toISOString() ?? null, ends_at: p.promoEnd?.toISOString() ?? null, active: eff.isPromo } : null,
    sku: p.sku,
    barcode: p.barcode,
    track_stock: p.trackStock,
    stock: p.trackStock ? (p.variants.length ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock) : null,
    inventory_policy: policy(p.inventoryPolicy),
    low_stock_threshold: p.lowStockThreshold,
    tags: p.tags,
    vendor: p.vendor,
    product_type: p.productType,
    featured: p.isFeatured,
    images: images(p.images),
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      attributes: v.attributes,
      price: v.price ?? eff.price,
      compare_at_price: v.compareAtPrice,
      sku: v.sku,
      barcode: v.barcode,
      stock: p.trackStock ? v.stock : null,
      inventory_policy: policy(v.inventoryPolicy),
      available: v.available,
    })),
    url: `${appBaseUrl()}/s/${store.slug}/p/${p.slug}`,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

export const ORDER_SELECT = {
  id: true, reference: true, status: true, paymentStatus: true, fulfillmentType: true, channel: true, currency: true,
  subtotal: true, discount: true, automaticDiscount: true, loyaltyDiscount: true, giftCardAmount: true, storeCreditAmount: true, deliveryFee: true, taxTotal: true, taxesIncluded: true, total: true, amountDue: true,
  couponCode: true, deliveryZoneName: true, scheduledFor: true, courierName: true, paymentMethodLabel: true, paymentReference: true,
  customerId: true, customerName: true, customerPhone: true, customerEmail: true, deliveryAddress: true, customerNote: true,
  createdAt: true, updatedAt: true, confirmedAt: true, deliveredAt: true, cancelledAt: true,
  items: { select: { id: true, productId: true, variantId: true, name: true, variantName: true, options: true, unitPrice: true, quantity: true, lineTotal: true, discountAllocated: true, taxAmount: true } },
} satisfies Prisma.OrderSelect;

export type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

export function serializeOrder(o: OrderRow, withPersonalData: boolean) {
  return {
    id: o.id,
    object: "order",
    reference: o.reference,
    status: o.status,
    payment_status: o.paymentStatus,
    next_statuses: nextStatuses(o.status),
    channel: o.channel,
    currency: o.currency,
    amounts: {
      subtotal: o.subtotal,
      discount: o.discount,
      automatic_discount: o.automaticDiscount,
      loyalty_discount: o.loyaltyDiscount,
      gift_card: o.giftCardAmount,
      store_credit: o.storeCreditAmount,
      delivery_fee: o.deliveryFee,
      tax_total: o.taxTotal,
      taxes_included: o.taxesIncluded,
      total: o.total,
      amount_due: o.amountDue,
    },
    coupon_code: o.couponCode,
    fulfillment: { type: o.fulfillmentType, zone: o.deliveryZoneName, scheduled_for: o.scheduledFor?.toISOString() ?? null, courier: o.courierName },
    payment: { method: o.paymentMethodLabel, reference: withPersonalData ? o.paymentReference : null },
    items: o.items.map((i) => ({ id: i.id, product_id: i.productId, variant_id: i.variantId, name: i.name, variant_name: i.variantName, options: i.options, unit_price: i.unitPrice, quantity: i.quantity, line_total: i.lineTotal, discount_allocated: i.discountAllocated, tax_amount: i.taxAmount })),
    customer: withPersonalData
      ? { id: o.customerId, name: o.customerName, phone: o.customerPhone ? `+${o.customerPhone}` : null, email: o.customerEmail, delivery_address: o.deliveryAddress, note: o.customerNote }
      : null,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
    confirmed_at: o.confirmedAt?.toISOString() ?? null,
    delivered_at: o.deliveredAt?.toISOString() ?? null,
    cancelled_at: o.cancelledAt?.toISOString() ?? null,
  };
}

export const CUSTOMER_SELECT = {
  id: true, name: true, phone: true, email: true, address: true, tags: true, ordersCount: true, totalSpent: true, lastOrderAt: true, loyaltyPoints: true, storeCreditBalance: true, createdAt: true, updatedAt: true,
} satisfies Prisma.CustomerSelect;

export type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

export function serializeCustomer(c: CustomerRow, currency: string) {
  return {
    id: c.id,
    object: "customer",
    name: c.name,
    phone: `+${c.phone}`,
    email: c.email,
    address: c.address,
    tags: c.tags,
    currency,
    orders_count: c.ordersCount,
    total_spent: c.totalSpent,
    loyalty_points: c.loyaltyPoints,
    store_credit_balance: c.storeCreditBalance,
    last_order_at: c.lastOrderAt?.toISOString() ?? null,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

export function serializeEndpoint(e: PublicEndpoint) {
  return {
    id: e.id,
    object: "webhook_endpoint",
    url: e.url,
    description: e.description,
    events: e.events,
    api_version: e.apiVersion,
    include_personal_data: e.includePersonalData,
    active: e.active,
    secret_prefix: e.secretPrefix,
    consecutive_failures: e.consecutiveFailures,
    disabled_at: e.disabledAt?.toISOString() ?? null,
    disabled_reason: e.disabledReason,
    last_success_at: e.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: e.lastFailureAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
  };
}

export function serializeDelivery(d: DeliveryRow) {
  return {
    id: d.id,
    object: "webhook_delivery",
    endpoint_id: d.endpointId,
    event_id: d.eventId,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    next_attempt_at: d.status === "FAILED" || d.status === "PENDING" ? d.nextAttemptAt.toISOString() : null,
    last_status_code: d.lastStatusCode,
    last_error: d.lastError,
    response_snippet: d.responseSnippet,
    duration_ms: d.durationMs,
    delivered_at: d.deliveredAt?.toISOString() ?? null,
    created_at: d.createdAt.toISOString(),
  };
}
