import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS, MCP_LIMITS } from "@/config/plans";
import { ORDER_STATUS_LABELS, ACTIVE_STATUSES } from "@/lib/commerce/order-state";
import { localParts, zonedMidnight } from "@/lib/reports/daily";
import { countLowStock, storeLowStockThreshold } from "@/lib/inventory/service";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { appBaseUrl } from "../runtime";
import { assertWritable, auditApi, currencyNote, fmt, lines, money, pageOf, parseDate, quoted, requireConfirmation, requireFeature, revalidate, UNTRUSTED_NOTICE, zAmount, zConfirm, zCursor, zDateInput, zId, zLimit } from "./common";

type Ctx = MerchantContext;
const EXCLUDED: ("CANCELLED" | "REFUNDED")[] = ["CANCELLED", "REFUNDED"];
const DAY = 86_400_000;

/* ───────────────────────── Périodes (fuseau de la boutique) ───────────────────────── */

function startOfLocalDay(ctx: Ctx, d = new Date()): Date {
  return zonedMidnight(localParts(d, ctx.store.timezone).date, ctx.store.timezone);
}

/** Bornes [from, to) d'une période exprimée en dates locales (AAAA-MM-JJ inclusives) ou ISO. */
function periodOf(ctx: Ctx, fromRaw?: string, toRaw?: string, defaultDays = 7): { from: Date; to: Date } {
  const today = startOfLocalDay(ctx);
  const local = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? zonedMidnight(v, ctx.store.timezone) : parseDate(v));
  const to = toRaw ? (/^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? new Date(zonedMidnight(toRaw, ctx.store.timezone).getTime() + DAY) : parseDate(toRaw)) : new Date(today.getTime() + DAY);
  const from = fromRaw ? local(fromRaw) : new Date(today.getTime() - (defaultDays - 1) * DAY);
  if (!from || !to) throw new ToolError("Invalid period: use ISO dates (YYYY-MM-DD).");
  if (to <= from) throw new ToolError("The end of the period must be after its start.");
  if (to.getTime() - from.getTime() > 366 * DAY) throw new ToolError("The period cannot exceed 366 days.");
  return { from, to };
}

async function salesTotals(storeId: string, from: Date, to: Date) {
  const agg = await db.order.aggregate({ where: { storeId, createdAt: { gte: from, lt: to }, status: { notIn: EXCLUDED } }, _count: { _all: true }, _sum: { total: true, discount: true } });
  const orders = agg._count._all;
  const revenue = agg._sum.total ?? 0;
  return { orders, revenue, discounts: agg._sum.discount ?? 0, average: orders ? Math.round(revenue / orders) : 0 };
}

async function topProducts(storeId: string, from: Date, to: Date, take: number) {
  const rows = await db.orderItem.groupBy({
    by: ["productId", "name"],
    where: { order: { storeId, createdAt: { gte: from, lt: to }, status: { notIn: EXCLUDED } } },
    _sum: { quantity: true, lineTotal: true },
    orderBy: { _sum: { lineTotal: "desc" } },
    take,
  });
  return rows.map((r) => ({ product_id: r.productId, name: r.name, quantity: r._sum.quantity ?? 0, revenue: r._sum.lineTotal ?? 0 }));
}

function pct(curr: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

/* ───────────────────────── Boutique ───────────────────────── */

export const getStoreOverview = defineTool({
  name: "get_store_overview",
  title: "Store overview",
  description: "Start here. Store identity, plan, currency and the scopes of this connection, plus key figures for today, the last 7 days and the last 30 days (revenue, orders, average basket), orders to process, payments to verify, low stock and best sellers.",
  scopes: ["store:read"],
  annotations: { readOnlyHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    const now = new Date();
    const today = startOfLocalDay(ctx, now);
    const tomorrow = new Date(today.getTime() + DAY);
    const d7 = new Date(today.getTime() - 6 * DAY);
    const d30 = new Date(today.getTime() - 29 * DAY);
    const [store, t, w, m, toProcess, toVerify, lowItems, top, productsCount] = await Promise.all([
      db.store.findUnique({ where: { id: ctx.store.id }, select: { name: true, slug: true, tagline: true, status: true, currency: true, timezone: true, country: true, city: true, whatsappNumber: true, contactEmail: true, createdAt: true, publishedAt: true, aiAgentsEnabled: true } }),
      salesTotals(ctx.store.id, today, tomorrow),
      salesTotals(ctx.store.id, d7, tomorrow),
      salesTotals(ctx.store.id, d30, tomorrow),
      db.order.count({ where: { storeId: ctx.store.id, status: { in: ACTIVE_STATUSES } } }),
      db.order.count({ where: { storeId: ctx.store.id, paymentStatus: "PENDING", status: { notIn: EXCLUDED } } }),
      // Seuil du produit, sinon seuil par défaut de la boutique.
      storeLowStockThreshold(ctx.store.id).then((th) => countLowStock(ctx.store.id, th)),
      topProducts(ctx.store.id, d30, tomorrow, 5),
      db.product.count({ where: { storeId: ctx.store.id, status: "ACTIVE" } }),
    ]);
    if (!store) throw new ToolError("Store not found.");
    const plan = PLANS[ctx.planId];
    const fig = (s: Awaited<ReturnType<typeof salesTotals>>) => ({ revenue: money(ctx, s.revenue), orders: s.orders, average_basket: money(ctx, s.average) });
    const data = {
      store: { id: ctx.store.id, name: store.name, tagline: store.tagline, status: store.status, url: `${appBaseUrl()}/s/${store.slug}`, currency: store.currency, timezone: store.timezone, country: store.country, city: store.city, whatsapp: store.whatsappNumber ? `+${store.whatsappNumber}` : null, created_at: store.createdAt.toISOString(), active_products: productsCount },
      plan: { id: ctx.planId, name: plan.name, mcp: MCP_LIMITS[ctx.planId] },
      connection: { actor: ctx.actor.label, role: ctx.role, scopes: ctx.scopes, scopes_not_available: ctx.droppedScopes },
      amounts_note: `All amounts are integers in ${currencyNote(ctx)}.`,
      sales: { today: fig(t), last_7_days: fig(w), last_30_days: fig(m) },
      to_do: { orders_to_process: toProcess, payments_to_verify: toVerify, low_stock_items: lowItems },
      top_products_30_days: top.map((p) => ({ ...p, revenue: money(ctx, p.revenue) })),
    };
    const text = lines(
      `${store.name} (${store.status}), plan ${plan.name}, currency ${store.currency}, timezone ${store.timezone}.`,
      `Today: ${fmt(ctx, t.revenue)} from ${t.orders} order(s). Last 7 days: ${fmt(ctx, w.revenue)} / ${w.orders} orders (avg ${fmt(ctx, w.average)}). Last 30 days: ${fmt(ctx, m.revenue)} / ${m.orders} orders.`,
      `To do: ${toProcess} order(s) in progress, ${toVerify} payment(s) to verify, ${lowItems} item(s) at or below their low-stock threshold.`,
      top.length ? `Best sellers (30 days): ${top.map((p) => `${p.name} (${p.quantity} sold, ${fmt(ctx, p.revenue)})`).join("; ")}` : null,
      `This connection (${ctx.actor.label}) can use: ${ctx.scopes.join(", ") || "no scope"}.`,
      ctx.droppedScopes.length ? `Not available on this plan or role: ${ctx.droppedScopes.join(", ")}.` : null,
    );
    return { text, data };
  },
});

/* ───────────────────────── Clients ───────────────────────── */

export const listCustomers = defineTool({
  name: "list_customers",
  title: "List customers",
  description: "Customers of the store (personal data: name, phone, email) with order count, total spent and last order date. Search by name, phone or email; sort by recency or value.",
  scopes: ["customers:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    query: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(40).optional(),
    sort: z.enum(["recent", "top_spenders", "most_orders", "newest"]).default("recent"),
    limit: zLimit(20, 50),
    cursor: zCursor,
  }),
  handler: async (ctx: Ctx, a) => {
    const digits = a.query?.replace(/\D/g, "") ?? "";
    const where: Prisma.CustomerWhereInput = {
      storeId: ctx.store.id,
      ...(a.query ? { OR: [{ name: { contains: a.query, mode: "insensitive" } }, { email: { contains: a.query, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] } : {}),
      ...(a.tag ? { tags: { has: a.tag } } : {}),
    };
    const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
      a.sort === "top_spenders" ? [{ totalSpent: "desc" }, { id: "desc" }] : a.sort === "most_orders" ? [{ ordersCount: "desc" }, { id: "desc" }] : a.sort === "newest" ? [{ createdAt: "desc" }, { id: "desc" }] : [{ lastOrderAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];
    const rows = await db.customer.findMany({ where, orderBy, take: a.limit + 1, ...(a.cursor ? { cursor: { id: a.cursor }, skip: 1 } : {}), select: { id: true, name: true, phone: true, email: true, tags: true, ordersCount: true, totalSpent: true, lastOrderAt: true, loyaltyPoints: true, createdAt: true } });
    const page = pageOf(rows, a.limit);
    const customers = page.items.map((c) => ({ id: c.id, untrusted_customer_input: { name: c.name, email: c.email }, phone: `+${c.phone}`, tags: c.tags, orders: c.ordersCount, total_spent: money(ctx, c.totalSpent), last_order_at: c.lastOrderAt?.toISOString() ?? null, loyalty_points: c.loyaltyPoints, since: c.createdAt.toISOString() }));
    const text = customers.length ? lines(`${customers.length} customer(s)${page.has_more ? " (more: pass next_cursor)" : ""}:`, ...customers.map((c) => `- ${quoted(c.untrusted_customer_input.name, 60)} ${c.phone} · ${c.orders} order(s) · ${c.total_spent?.formatted} (id: ${c.id})`)) : "No customer found.";
    return { text, data: { notice: UNTRUSTED_NOTICE, customers, next_cursor: page.next_cursor, has_more: page.has_more } };
  },
});

export const getCustomer = defineTool({
  name: "get_customer",
  title: "Get customer details",
  description: "One customer with contact details, notes, tags, loyalty points, marketing consent and recent order history.",
  scopes: ["customers:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    customer_id: zId.optional(),
    phone: z.string().trim().max(20).optional().describe("Alternatively the phone number in international format (e.g. +22997000000)."),
  }),
  handler: async (ctx: Ctx, a) => {
    if (!a.customer_id && !a.phone) throw new ToolError("Provide customer_id or phone.");
    const phone = a.phone?.replace(/\D/g, "");
    const c = await db.customer.findFirst({
      where: { storeId: ctx.store.id, ...(a.customer_id ? { id: a.customer_id } : { phone }) },
      include: {
        orders: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, reference: true, status: true, total: true, createdAt: true } },
        consents: { orderBy: { createdAt: "desc" }, take: 20, select: { channel: true, purpose: true, granted: true, createdAt: true } },
      },
    });
    if (!c) throw new ToolError("Customer not found in this store.");
    const marketing = c.consents.find((x) => x.purpose === "MARKETING" && x.channel === "WHATSAPP");
    const data = {
      id: c.id, phone: `+${c.phone}`, merchant_notes: c.notes, tags: c.tags,
      untrusted_customer_input: { notice: UNTRUSTED_NOTICE, name: c.name, email: c.email, address: c.address },
      orders_count: c.ordersCount, total_spent: money(ctx, c.totalSpent), average_order: money(ctx, c.ordersCount ? Math.round(c.totalSpent / c.ordersCount) : 0),
      last_order_at: c.lastOrderAt?.toISOString() ?? null, loyalty_points: c.loyaltyPoints, since: c.createdAt.toISOString(),
      whatsapp_marketing_consent: marketing ? marketing.granted : null,
      recent_orders: c.orders.map((o) => ({ id: o.id, reference: o.reference, status: o.status, status_label: ORDER_STATUS_LABELS[o.status], total: money(ctx, o.total), created_at: o.createdAt.toISOString() })),
    };
    const text = lines(
      `Customer ${quoted(c.name, 60)} (+${c.phone}${c.email ? `, ${quoted(c.email, 80)}` : ""}): ${c.ordersCount} order(s), ${fmt(ctx, c.totalSpent)} spent, ${c.loyaltyPoints} loyalty points.`,
      `WhatsApp marketing consent: ${marketing ? (marketing.granted ? "yes" : "no") : "unknown"} (only message customers who agreed).`,
      ...c.orders.slice(0, 10).map((o) => `- ${o.reference} ${ORDER_STATUS_LABELS[o.status]} ${fmt(ctx, o.total)} on ${o.createdAt.toISOString().slice(0, 10)}`),
    );
    return { text, data };
  },
});

/* ───────────────────────── Marketing ───────────────────────── */

export const createDiscountCode = defineTool({
  name: "create_discount_code",
  title: "Create a discount code",
  description: "Create a promo code customers type at checkout: PERCENT (value 1-100), FIXED (amount off) or FREE_DELIVERY. Optional validity window, minimum basket and usage limits. Codes are stored in uppercase.",
  scopes: ["marketing:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  input: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/, "3 to 24 characters: letters, digits, - and _").describe("e.g. WEEKEND10"),
    type: z.enum(["PERCENT", "FIXED", "FREE_DELIVERY"]),
    value: z.number().int().min(0).max(1_000_000_000).default(0).describe("Percent (1-100) for PERCENT, amount for FIXED (integer in the store currency's smallest unit), ignored for FREE_DELIVERY."),
    min_subtotal: zAmount.default(0).describe("Minimum basket subtotal to use the code (0 = none)."),
    max_uses: z.number().int().min(1).max(1_000_000).optional().describe("Total number of uses (omit for unlimited)."),
    max_uses_per_customer: z.number().int().min(1).max(1000).nullable().default(1).describe("Uses per customer phone number (null = unlimited). Default 1."),
    starts_at: zDateInput.optional(),
    ends_at: zDateInput.optional().describe("A plain date includes the whole day (store timezone)."),
    active: z.boolean().default(true),
    confirm: zConfirm.describe("Required (true) after the merchant confirmed: PERCENT above 50, or FIXED above the store's 30-day average order value."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireFeature(ctx, "coupons", "Discount codes");
    if (a.type === "PERCENT" && (a.value < 1 || a.value > 100)) throw new ToolError("For PERCENT, value must be between 1 and 100.");
    if (a.type === "FIXED" && a.value < 1) throw new ToolError("For FIXED, value must be a positive amount.");
    if (a.type === "PERCENT" && a.value > 50) requireConfirmation(a.confirm, `a ${a.value} % discount is above 50 %`);
    if (a.type === "FIXED") {
      const now = new Date();
      const avg = (await salesTotals(ctx.store.id, new Date(now.getTime() - 30 * DAY), now)).average;
      if (avg === 0 || a.value > avg) requireConfirmation(a.confirm, avg === 0 ? "no recent orders to compare this fixed discount with" : `${fmt(ctx, a.value)} is more than the 30-day average order value of ${fmt(ctx, avg)}`);
    }
    const tz = ctx.store.timezone;
    const startsAt = a.starts_at ? (/^\d{4}-\d{2}-\d{2}$/.test(a.starts_at) ? zonedMidnight(a.starts_at, tz) : parseDate(a.starts_at)) : null;
    const endsAt = a.ends_at ? (/^\d{4}-\d{2}-\d{2}$/.test(a.ends_at) ? new Date(zonedMidnight(a.ends_at, tz).getTime() + DAY - 1000) : parseDate(a.ends_at)) : null;
    if (startsAt && endsAt && endsAt <= startsAt) throw new ToolError("ends_at must be after starts_at.");
    const exists = await db.coupon.findUnique({ where: { storeId_code: { storeId: ctx.store.id, code: a.code } }, select: { id: true } });
    if (exists) throw new ToolError(`The code ${a.code} already exists in this store.`);
    try {
      const c = await db.$transaction(async (tx) => {
        const created = await tx.coupon.create({
          data: { storeId: ctx.store.id, code: a.code, type: a.type, value: a.type === "FREE_DELIVERY" ? 0 : a.value, minSubtotal: a.min_subtotal, maxUses: a.max_uses ?? null, maxUsesPerCustomer: a.max_uses_per_customer, startsAt: startsAt ?? null, endsAt: endsAt ?? null, active: a.active },
        });
        await auditApi(ctx, "coupon.created", created.id, { code: a.code, type: a.type, value: a.value }, tx);
        return created;
      });
      revalidate(ctx, "promotions");
      const label = a.type === "PERCENT" ? `-${a.value} %` : a.type === "FIXED" ? `-${fmt(ctx, a.value)}` : "free delivery";
      return {
        text: lines(
          `Discount code ${c.code} created (${label}${a.min_subtotal ? `, from ${fmt(ctx, a.min_subtotal)}` : ""}).`,
          startsAt || endsAt ? `Valid ${startsAt ? `from ${startsAt.toISOString()}` : ""}${endsAt ? ` until ${endsAt.toISOString()}` : ""}.` : "No time limit.",
          a.active ? null : "It is inactive: enable it in the dashboard when ready.",
        ),
        data: { id: c.id, code: c.code, type: c.type, value: c.value, starts_at: c.startsAt?.toISOString() ?? null, ends_at: c.endsAt?.toISOString() ?? null, active: c.active },
      };
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw new ToolError(`The code ${a.code} already exists in this store.`);
      throw e;
    }
  },
});

export const listDiscountCodes = defineTool({
  name: "list_discount_codes",
  title: "List discount codes",
  description: "Discount codes of the store with their type, value, validity window and number of uses.",
  scopes: ["marketing:write", "analytics:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    active_only: z.boolean().default(false).describe("Only codes that are active and currently valid."),
    limit: zLimit(50, 100),
  }),
  handler: async (ctx: Ctx, a) => {
    const now = new Date();
    const rows = await db.coupon.findMany({
      where: { storeId: ctx.store.id, ...(a.active_only ? { active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] } : {}) },
      orderBy: { createdAt: "desc" },
      take: a.limit,
    });
    const codes = rows.map((c) => ({
      id: c.id, code: c.code, type: c.type, value: c.type === "FIXED" ? money(ctx, c.value) : c.value, min_subtotal: money(ctx, c.minSubtotal),
      uses: c.usesCount, max_uses: c.maxUses, max_uses_per_customer: c.maxUsesPerCustomer, starts_at: c.startsAt?.toISOString() ?? null, ends_at: c.endsAt?.toISOString() ?? null,
      active: c.active, currently_valid: c.active && (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt >= now) && (c.maxUses == null || c.usesCount < c.maxUses),
    }));
    const text = codes.length ? lines(`${codes.length} code(s):`, ...codes.map((c) => `- ${c.code} ${c.type === "PERCENT" ? `-${c.value} %` : c.type === "FIXED" ? `-${(c.value as { formatted: string }).formatted}` : "free delivery"} · ${c.uses}${c.max_uses ? `/${c.max_uses}` : ""} uses · ${c.currently_valid ? "valid now" : "not valid now"}`)) : "No discount code.";
    return { text, data: { codes } };
  },
});

/* ───────────────────────── Analyses ───────────────────────── */

export const salesReport = defineTool({
  name: "sales_report",
  title: "Sales report",
  description: "Revenue and orders over a period (default: last 7 days, store timezone), grouped by day, week or product, with totals, average basket and comparison with the previous period of the same length. Cancelled and refunded orders are excluded.",
  scopes: ["analytics:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    from: zDateInput.optional().describe("First day (inclusive), e.g. 2026-10-01."),
    to: zDateInput.optional().describe("Last day (inclusive), e.g. 2026-10-07."),
    group_by: z.enum(["day", "week", "product"]).default("day"),
    limit: zLimit(20, 100).describe("For group_by=product: number of products (default 20)."),
  }),
  handler: async (ctx: Ctx, a) => {
    const { from, to } = periodOf(ctx, a.from, a.to, 7);
    const span = to.getTime() - from.getTime();
    const [totals, previous] = await Promise.all([salesTotals(ctx.store.id, from, to), salesTotals(ctx.store.id, new Date(from.getTime() - span), from)]);
    let rows: { key: string; label: string; orders?: number; quantity?: number; revenue: number }[];
    if (a.group_by === "product") {
      const top = await topProducts(ctx.store.id, from, to, a.limit);
      rows = top.map((p) => ({ key: p.product_id ?? p.name, label: p.name, quantity: p.quantity, revenue: p.revenue }));
    } else {
      const unit = a.group_by === "week" ? "week" : "day";
      const tz = ctx.store.timezone;
      const raw = await db.$queryRaw<{ bucket: string; orders: number; revenue: bigint | number | null }[]>`
        SELECT to_char(date_trunc(${unit}, ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket,
               count(*)::int AS orders, coalesce(sum(total), 0)::bigint AS revenue
        FROM "Order"
        WHERE "storeId" = ${ctx.store.id} AND "createdAt" >= ${from} AND "createdAt" < ${to} AND status NOT IN ('CANCELLED', 'REFUNDED')
        GROUP BY 1 ORDER BY 1`;
      rows = raw.map((r) => ({ key: r.bucket, label: a.group_by === "week" ? `Week of ${r.bucket}` : r.bucket, orders: Number(r.orders), revenue: Number(r.revenue ?? 0) }));
    }
    const data = {
      period: { from: from.toISOString(), to: to.toISOString(), timezone: ctx.store.timezone, group_by: a.group_by },
      totals: { revenue: money(ctx, totals.revenue), orders: totals.orders, average_basket: money(ctx, totals.average), discounts: money(ctx, totals.discounts) },
      previous_period: { revenue: money(ctx, previous.revenue), orders: previous.orders, revenue_change_percent: pct(totals.revenue, previous.revenue), orders_change_percent: pct(totals.orders, previous.orders) },
      rows: rows.map((r) => ({ ...r, revenue: money(ctx, r.revenue) })),
    };
    const change = data.previous_period.revenue_change_percent;
    const text = lines(
      `Sales ${localParts(from, ctx.store.timezone).date} → ${localParts(new Date(to.getTime() - 1), ctx.store.timezone).date}: ${fmt(ctx, totals.revenue)} from ${totals.orders} order(s), average basket ${fmt(ctx, totals.average)}${change != null ? ` (${change >= 0 ? "+" : ""}${change} % vs previous period)` : ""}.`,
      ...rows.slice(0, 40).map((r) => `- ${r.label}: ${fmt(ctx, r.revenue)}${r.orders != null ? `, ${r.orders} order(s)` : ""}${r.quantity != null ? `, ${r.quantity} sold` : ""}`),
    );
    return { text, data };
  },
});

export const INSIGHT_TOOLS: McpTool<Ctx>[] = [getStoreOverview, listCustomers, getCustomer, createDiscountCode, listDiscountCodes, salesReport];
