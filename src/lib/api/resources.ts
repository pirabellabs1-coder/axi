import "server-only";
import type { Prisma, OrderStatus, PaymentStatus, ProductStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { emitDomainEvent, type WebhookEvent } from "@/lib/webhooks/emit";
import type { WebhookActor } from "@/lib/webhooks/service";
import { ApiError } from "./problem";
import { assertCursorInStore, decodeCursor, pageArgs, parseLimit, toPage } from "./pagination";
import type { RestContext } from "./auth";
import { CUSTOMER_SELECT, ORDER_SELECT, PRODUCT_SELECT, serializeCustomer, serializeOrder, serializeProduct } from "./serializers";

/** Lectures de l'API REST (toujours filtrées par la boutique du jeton) et utilitaires partagés par les routes. */

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function requireId(raw: string | undefined, label = "id"): string {
  if (!raw || !ID_RE.test(raw)) throw new ApiError(404, "not_found", `Unknown ${label}.`);
  return raw;
}

function parseEnumList<T extends string>(raw: string | null, allowed: readonly T[], name: string): T[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const bad = list.filter((s) => !(allowed as readonly string[]).includes(s));
  if (bad.length || list.length > allowed.length) throw new ApiError(400, "invalid_request", `Invalid ${name}: ${bad.join(", ") || raw}. Allowed: ${allowed.join(", ")}.`);
  return list as T[];
}

function parseDateParam(raw: string | null, name: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (raw.length > 40 || Number.isNaN(d.getTime())) throw new ApiError(400, "invalid_request", `${name} must be an ISO 8601 date.`);
  return d;
}

export function webhookActor(ctx: RestContext): WebhookActor {
  // `scopes` : portée effective du jeton (plan ∩ rôle ∩ jeton), contrôlée par le service pour les données personnelles.
  return { storeId: ctx.store.id, planId: ctx.planId, role: ctx.role, userId: ctx.actor.userId, label: ctx.actor.label, via: "api", scopes: ctx.scopes };
}

/** Événement de webhook après une écriture déjà validée (best effort : une erreur ne fait pas échouer la requête). */
export async function emitAfterWrite(ctx: RestContext, event: WebhookEvent, data: Record<string, unknown>) {
  try {
    await emitDomainEvent(db, ctx.store.id, event, { ...data, source: "api" });
  } catch (e) {
    console.error("[api] emitDomainEvent", event, e);
  }
}

/* ───────────────────────── Produits ───────────────────────── */

const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const satisfies readonly ProductStatus[];

export async function listProducts(ctx: RestContext, sp: URLSearchParams) {
  const limit = parseLimit(sp.get("limit"));
  const cursor = decodeCursor(sp.get("cursor"));
  const status = parseEnumList(sp.get("status"), PRODUCT_STATUSES, "status");
  const q = sp.get("q")?.trim().slice(0, 100);
  const updatedSince = parseDateParam(sp.get("updated_since"), "updated_since");
  const where: Prisma.ProductWhereInput = {
    storeId: ctx.store.id,
    ...(status ? { status: { in: status } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { tags: { has: q } }] } : {}),
    ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
  };
  await assertCursorInStore(cursor, (id) => db.product.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true } }));
  const rows = await db.product.findMany({ where, select: PRODUCT_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pageArgs(limit, cursor) });
  return toPage(rows, limit, (p) => serializeProduct(p, ctx.store));
}

export async function getProductOr404(ctx: RestContext, id: string) {
  const p = await db.product.findFirst({ where: { id, storeId: ctx.store.id }, select: PRODUCT_SELECT });
  if (!p) throw new ApiError(404, "not_found", "Product not found in this store.");
  return serializeProduct(p, ctx.store);
}

/* ───────────────────────── Commandes ───────────────────────── */

const ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REFUNDED"] as const satisfies readonly OrderStatus[];
const PAYMENT_STATUSES = ["UNPAID", "PENDING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"] as const satisfies readonly PaymentStatus[];

const hasCustomers = (ctx: RestContext) => ctx.scopes.includes("customers:read");

export async function listOrders(ctx: RestContext, sp: URLSearchParams) {
  const limit = parseLimit(sp.get("limit"));
  const cursor = decodeCursor(sp.get("cursor"));
  const status = parseEnumList(sp.get("status"), ORDER_STATUSES, "status");
  const paymentStatus = parseEnumList(sp.get("payment_status"), PAYMENT_STATUSES, "payment_status");
  const from = parseDateParam(sp.get("created_since"), "created_since");
  const to = parseDateParam(sp.get("created_until"), "created_until");
  const updatedSince = parseDateParam(sp.get("updated_since"), "updated_since");
  const reference = sp.get("reference")?.trim().toUpperCase().slice(0, 20);
  const where: Prisma.OrderWhereInput = {
    storeId: ctx.store.id,
    ...(status ? { status: { in: status } } : {}),
    ...(paymentStatus ? { paymentStatus: { in: paymentStatus } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
    ...(reference ? { reference } : {}),
  };
  await assertCursorInStore(cursor, (id) => db.order.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true } }));
  const rows = await db.order.findMany({ where, select: ORDER_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pageArgs(limit, cursor) });
  return toPage(rows, limit, (o) => serializeOrder(o, hasCustomers(ctx)));
}

export async function getOrderOr404(ctx: RestContext, id: string) {
  const o = await db.order.findFirst({ where: { id, storeId: ctx.store.id }, select: ORDER_SELECT });
  if (!o) throw new ApiError(404, "not_found", "Order not found in this store.");
  return serializeOrder(o, hasCustomers(ctx));
}

/* ───────────────────────── Clients ───────────────────────── */

export async function listCustomers(ctx: RestContext, sp: URLSearchParams) {
  const limit = parseLimit(sp.get("limit"));
  const cursor = decodeCursor(sp.get("cursor"));
  const q = sp.get("q")?.trim().slice(0, 80);
  const digits = q?.replace(/\D/g, "") ?? "";
  const updatedSince = parseDateParam(sp.get("updated_since"), "updated_since");
  const where: Prisma.CustomerWhereInput = {
    storeId: ctx.store.id,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] } : {}),
    ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
  };
  await assertCursorInStore(cursor, (id) => db.customer.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true } }));
  const rows = await db.customer.findMany({ where, select: CUSTOMER_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pageArgs(limit, cursor) });
  return toPage(rows, limit, (c) => serializeCustomer(c, ctx.store.currency));
}

export async function getCustomerOr404(ctx: RestContext, id: string) {
  const c = await db.customer.findFirst({ where: { id, storeId: ctx.store.id }, select: CUSTOMER_SELECT });
  if (!c) throw new ApiError(404, "not_found", "Customer not found in this store.");
  return serializeCustomer(c, ctx.store.currency);
}
