import "server-only";
import { z } from "zod";
import type { Prisma, ReturnStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { roleHas } from "@/lib/auth/permissions";
import { enqueue } from "@/lib/jobs";
import { getCountry } from "@/config/site";
import { normalizePhone } from "@/lib/utils";
import { zonedMidnight } from "@/lib/reports/daily";
import { allowedDiscountKinds } from "@/lib/discounts/service";
import { ADVANCED_KINDS, DISCOUNT_KINDS, KIND_LABELS, configReferences, parseDiscountConfig, readDiscountConfig, type ParsedDiscount } from "@/lib/discounts/schema";
import { describeDiscount, discountStatus, STATUS_LABELS } from "@/lib/discounts/summary";
import { createGiftCardRecord } from "@/lib/giftcards/service";
import { displayGiftCardStatus, endOfLocalDay, giftCardLimits, GIFT_CARD_STATUS_LABELS, MAX_GIFT_CARD_VALIDITY_DAYS } from "@/lib/giftcards/state";
import { grantTx } from "@/lib/store-credit/service";
import { StoreCreditError } from "@/lib/store-credit/errors";
import { STORE_CREDIT_MAX_OPERATION } from "@/lib/store-credit/rules";
import { canTransitionReturn, nextReturnStatuses, RETURN_STATUS_LABELS, RETURN_STATUSES } from "@/lib/returns/state";
import { ITEM_CONDITIONS, parseReturnPolicy, RESOLUTION_LABELS, RETURN_REASONS } from "@/lib/returns/policy";
import { approveReturn, cancelReturn, receiveReturn, rejectReturn, resolveReturn, ReturnError, type ActorInfo } from "@/lib/returns/service";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { assertWritable, auditApi, fmt, hasScope, lines, money, pageOf, personal, requireConfirmation, requireFeature, revalidate, UNTRUSTED_NOTICE, zAmount, zConfirm, zCursor, zId, zLimit } from "./common";

/**
 * Outils MCP du lot 1 (docs/specs/LOT-1-ventes-fidelite.md §6) : remises automatiques, cartes cadeaux, avoirs, retours.
 * Mêmes garde-fous que les autres outils marchands : scopes ∩ plan ∩ rôle (serveur), capacité du rôle vérifiée ici
 * pour les actions sensibles, audit `api.*`, confirmation humaine (`confirm: true`) pour les écritures à fort impact.
 * Les codes de cartes cadeaux ne sont JAMAIS renvoyés (4 derniers caractères seulement).
 */

type Ctx = MerchantContext;
const DAY = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireRole(ctx: Ctx, cap: Parameters<typeof roleHas>[1], what: string) {
  if (!roleHas(ctx.role, cap)) throw new ToolError(`${what} is not allowed for the ${ctx.role} role of the member who created this connection.`, "forbidden");
}

/* ───────────── Plafonds journaliers par connexion (cartes cadeaux, avoirs) ───────────── */

/** Plafonds par connexion MCP (jeton ou autorisation OAuth) sur 24 h glissantes. */
export const MCP_DAILY_CAPS = {
  giftCards: { count: 5 },
  storeCredit: { count: 10 },
} as const;

/** Montant maximal par connexion et par 24 h : une valeur faciale maximale de carte (500 000 FCFA ou équivalent). */
export function mcpDailyAmountCap(currency: string): number {
  return giftCardLimits(currency).maxValue;
}

function connectionKey(ctx: Ctx): string {
  return ctx.actor.tokenId ? `tok:${ctx.actor.tokenId}` : ctx.actor.grantId ? `grant:${ctx.actor.grantId}` : `user:${ctx.actor.userId}`;
}

/**
 * Réserve `units` dans une fenêtre de 24 h, de façon atomique et CONDITIONNELLE (jamais au-delà de `limit`), dans la
 * transaction appelante : si l'écriture échoue ensuite, la réservation est annulée avec elle.
 */
async function reserveDailyTx(tx: Prisma.TransactionClient, key: string, units: number, limit: number): Promise<boolean> {
  const k = key.slice(0, 200);
  const rows = await tx.$queryRaw<{ count: number }[]>`
    WITH t AS (SELECT (now() AT TIME ZONE 'UTC') AS now)
    INSERT INTO "RateLimit" ("key", "count", "resetAt", "updatedAt")
    SELECT ${k}, ${units}::int, t.now + interval '1 day', t.now FROM t WHERE ${units}::int <= ${limit}::int
    ON CONFLICT ("key") DO UPDATE SET
      "count"     = CASE WHEN "RateLimit"."resetAt" <= EXCLUDED."updatedAt" THEN EXCLUDED."count" ELSE "RateLimit"."count" + EXCLUDED."count" END,
      "resetAt"   = CASE WHEN "RateLimit"."resetAt" <= EXCLUDED."updatedAt" THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END,
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE "RateLimit"."resetAt" <= EXCLUDED."updatedAt" OR "RateLimit"."count" + EXCLUDED."count" <= ${limit}::int
    RETURNING "count"`;
  return rows.length > 0;
}

async function enforceDailyCapsTx(tx: Prisma.TransactionClient, ctx: Ctx, kind: "giftCards" | "storeCredit", amount: number) {
  const conn = connectionKey(ctx);
  const maxAmount = mcpDailyAmountCap(ctx.store.currency);
  const label = kind === "giftCards" ? "gift cards issued" : "store credit granted";
  if (!(await reserveDailyTx(tx, `mcp:${kind}:count:${conn}`, 1, MCP_DAILY_CAPS[kind].count))) {
    throw new ToolError(`Daily limit reached for this connection: at most ${MCP_DAILY_CAPS[kind].count} ${label} per 24 h. Use the dashboard for more.`, "rate_limited");
  }
  if (!(await reserveDailyTx(tx, `mcp:${kind}:amount:${conn}`, amount, maxAmount))) {
    throw new ToolError(`Daily amount limit reached for this connection: at most ${fmt(ctx, maxAmount)} of ${label} per 24 h. Use the dashboard for more.`, "rate_limited");
  }
}

async function averageBasket30d(storeId: string): Promise<number> {
  const now = new Date();
  const agg = await db.order.aggregate({ where: { storeId, createdAt: { gte: new Date(now.getTime() - 30 * DAY), lt: now }, status: { notIn: ["CANCELLED", "REFUNDED"] } }, _count: { _all: true }, _sum: { total: true } });
  const n = agg._count._all;
  return n ? Math.round((agg._sum.total ?? 0) / n) : 0;
}

async function nameLookups(storeId: string, d: ParsedDiscount[]) {
  const refs = d.map(configReferences);
  const productIds = [...new Set(refs.flatMap((r) => r.productIds))].slice(0, 500);
  const collectionIds = [...new Set(refs.flatMap((r) => r.collectionIds))].slice(0, 200);
  const [products, collections] = await Promise.all([
    productIds.length ? db.product.findMany({ where: { storeId, id: { in: productIds } }, select: { id: true, name: true, price: true } }) : Promise.resolve([]),
    collectionIds.length ? db.category.findMany({ where: { storeId, id: { in: collectionIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return { products, collections, productName: (id: string) => products.find((p) => p.id === id)?.name, collectionName: (id: string) => collections.find((c) => c.id === id)?.name };
}

/* ───────────────────────── Remises automatiques ───────────────────────── */

const DISCOUNT_HELP =
  "Kinds and config (amounts are integers in the store currency's smallest unit): " +
  "PRODUCT_AMOUNT {target:{all:true}|{productIds:[...]}|{collectionIds:[...]}, value:{type:'PERCENT'|'FIXED_AMOUNT', amount}, perUnit:boolean, minQuantity?, excludeOnSale:true}; " +
  "BUY_X_GET_Y {buy:{target, quantity}|{target, minAmount}, get:{target, quantity, value:{type:'PERCENT', amount:100}}, maxApplicationsPerOrder:1-20, excludeOnSale:true} (e.g. buy 2 get 1 free); " +
  "CART_TIER {tiers:[{minSubtotal, value:{type:'PERCENT'|'FIXED_AMOUNT'|'FREE_DELIVERY', amount}}] (1-5, ascending), target?}; " +
  "BUNDLE {items:[{productId, variantId?, quantity}] (2-6), price:{type:'FIXED_PRICE'|'PERCENT', amount}, maxSets:1-10}. " +
  "Discounts apply automatically at checkout (no code). Use search_products / list_collections for ids.";

export const listAutomaticDiscounts = defineTool({
  name: "list_automatic_discounts",
  title: "List automatic discounts",
  description: "Automatic discounts of the store (applied at checkout without a code): kind, plain-language summary, status (active, scheduled, expired, exhausted, inactive), validity window and number of orders that used them.",
  scopes: ["marketing:write", "analytics:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    status: z.enum(["active", "scheduled", "expired", "exhausted", "inactive"]).optional().describe("Keep only this computed status."),
    limit: zLimit(50, 100),
  }),
  handler: async (ctx: Ctx, a) => {
    const rows = await db.automaticDiscount.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ active: "desc" }, { priority: "desc" }, { createdAt: "desc" }], take: 200 });
    const now = new Date();
    const parsed = rows.map((r) => ({ r, p: readDiscountConfig(r.kind, r.config) }));
    const names = await nameLookups(ctx.store.id, parsed.map((x) => x.p).filter((p): p is ParsedDiscount => !!p));
    const items = parsed
      .map(({ r, p }) => {
        const status = discountStatus(r, now);
        return {
          id: r.id,
          title: r.title,
          kind: r.kind,
          kind_label: KIND_LABELS[r.kind],
          summary: p ? describeDiscount(p, { currency: ctx.store.currency, productName: names.productName, collectionName: names.collectionName, timeZone: ctx.store.timezone }, { startsAt: r.startsAt, endsAt: r.endsAt }) : "Invalid configuration (ignored at checkout).",
          status,
          status_label: STATUS_LABELS[status],
          active: r.active,
          priority: r.priority,
          combines_with_coupons: r.combinesWithCoupons,
          combines_with_other_automatic: r.combinesWithOtherAutomatic,
          uses: r.usesCount,
          max_uses: r.maxUses,
          starts_at: r.startsAt?.toISOString() ?? null,
          ends_at: r.endsAt?.toISOString() ?? null,
          allowed_by_plan: allowedDiscountKinds(ctx.planId).has(r.kind),
        };
      })
      .filter((d) => !a.status || d.status === a.status)
      .slice(0, a.limit);
    const text = items.length ? lines(`${items.length} automatic discount(s):`, ...items.map((d) => `- ${d.title} [${d.kind}] · ${d.status_label} · ${d.uses}${d.max_uses ? `/${d.max_uses}` : ""} uses (id: ${d.id})\n  ${d.summary}`)) : "No automatic discount matches.";
    return { text, data: { discounts: items } };
  },
});

export const createAutomaticDiscount = defineTool({
  name: "create_automatic_discount",
  title: "Create an automatic discount",
  description: `Create an automatic discount (no code needed; the best eligible offer is applied at checkout). Plan: PRODUCT_AMOUNT and CART_TIER need Starter+, BUY_X_GET_Y and BUNDLE need Business+. ${DISCOUNT_HELP} High-impact discounts need the merchant's explicit confirmation (confirm: true): a percentage above 50, a fixed amount above the 30-day average order value, or a bundle priced below 50 % of its items.`,
  scopes: ["marketing:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  input: z.object({
    title: z.string().trim().min(2).max(80).describe("Shown to buyers at checkout, e.g. « 2 achetés = 1 offert »."),
    kind: z.enum(DISCOUNT_KINDS),
    config: z.record(z.string(), z.unknown()).describe("Configuration object for this kind (see description)."),
    priority: z.number().int().min(-100).max(100).default(0),
    combines_with_coupons: z.boolean().default(true),
    combines_with_other_automatic: z.boolean().default(true),
    starts_on: z.string().regex(DAY_RE, "YYYY-MM-DD").optional().describe("First day (store timezone)."),
    ends_on: z.string().regex(DAY_RE, "YYYY-MM-DD").optional().describe("Last day, included (store timezone)."),
    max_uses: z.number().int().min(1).max(1_000_000).optional().describe("Maximum number of orders (omit for unlimited)."),
    active: z.boolean().default(true),
    confirm: zConfirm,
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireRole(ctx, "coupons.manage", "Managing discounts");
    if (!allowedDiscountKinds(ctx.planId).has(a.kind)) {
      throw new ToolError(`${KIND_LABELS[a.kind]} discounts are not included in the ${PLANS[ctx.planId].name} plan (needs ${ADVANCED_KINDS.includes(a.kind) ? "Business" : "Starter"} or above). The owner can upgrade at /app/${ctx.store.id}/abonnement.`, "plan_required");
    }
    const cfg = parseDiscountConfig(a.kind, a.config);
    if (!cfg.ok) throw new ToolError(`Invalid config${cfg.path.length ? ` at ${cfg.path.join(".")}` : ""}: ${cfg.error}`);
    const d = cfg.value;
    const refs = configReferences(d);
    const [pc, cc, vc] = await Promise.all([
      refs.productIds.length ? db.product.count({ where: { storeId: ctx.store.id, id: { in: refs.productIds } } }) : 0,
      refs.collectionIds.length ? db.category.count({ where: { storeId: ctx.store.id, id: { in: refs.collectionIds } } }) : 0,
      refs.variantIds.length ? db.variant.count({ where: { id: { in: refs.variantIds }, product: { storeId: ctx.store.id } } }) : 0,
    ]);
    if (pc !== refs.productIds.length) throw new ToolError("A product id in config does not exist in this store.");
    if (cc !== refs.collectionIds.length) throw new ToolError("A collection id in config does not exist in this store.");
    if (vc !== refs.variantIds.length) throw new ToolError("A variant id in config does not exist in this store.");

    // Confirmation humaine des remises à fort impact (§6).
    const values: { type: string; amount?: number }[] = [];
    if (d.kind === "PRODUCT_AMOUNT") values.push(d.config.value);
    if (d.kind === "BUY_X_GET_Y") values.push(d.config.get.value);
    if (d.kind === "CART_TIER") values.push(...d.config.tiers.map((t) => t.value));
    const pct = Math.max(0, ...values.filter((v) => v.type === "PERCENT").map((v) => v.amount ?? 0), d.kind === "BUNDLE" && d.config.price.type === "PERCENT" ? d.config.price.amount : 0);
    if (pct > 50) requireConfirmation(a.confirm, `a ${pct} % discount is above 50 %`);
    const fixed = Math.max(0, ...values.filter((v) => v.type === "FIXED_AMOUNT").map((v) => v.amount ?? 0));
    if (fixed > 0) {
      const avg = await averageBasket30d(ctx.store.id);
      if (avg === 0 || fixed > avg) requireConfirmation(a.confirm, avg === 0 ? "no recent orders to compare this fixed discount with" : `${fmt(ctx, fixed)} is more than the 30-day average order value of ${fmt(ctx, avg)}`);
    }
    if (d.kind === "BUNDLE" && d.config.price.type === "FIXED_PRICE") {
      const items = await db.product.findMany({ where: { storeId: ctx.store.id, id: { in: d.config.items.map((i) => i.productId) } }, select: { id: true, price: true } });
      const sum = d.config.items.reduce((s, i) => s + (items.find((p) => p.id === i.productId)?.price ?? 0) * i.quantity, 0);
      if (sum > 0 && d.config.price.amount < sum * 0.5) requireConfirmation(a.confirm, `the bundle price ${fmt(ctx, d.config.price.amount)} is less than 50 % of its items' total ${fmt(ctx, sum)}`);
    }

    const tz = ctx.store.timezone;
    const startsAt = a.starts_on ? zonedMidnight(a.starts_on, tz) : null;
    const endsAt = a.ends_on ? new Date(zonedMidnight(a.ends_on, tz).getTime() + DAY - 1000) : null;
    if (startsAt && endsAt && endsAt <= startsAt) throw new ToolError("ends_on must be on or after starts_on.");
    const count = await db.automaticDiscount.count({ where: { storeId: ctx.store.id } });
    if (count >= 200) throw new ToolError("This store already has 200 automatic discounts: deactivate or reuse old ones.");

    const created = await db.$transaction(async (tx) => {
      const row = await tx.automaticDiscount.create({
        data: {
          storeId: ctx.store.id,
          title: a.title,
          kind: a.kind,
          config: d.config as unknown as Prisma.InputJsonValue,
          priority: a.priority,
          combinesWithCoupons: a.combines_with_coupons,
          combinesWithOtherAutomatic: a.combines_with_other_automatic,
          startsAt,
          endsAt,
          maxUses: a.max_uses ?? null,
          active: a.active,
        },
      });
      await auditApi(ctx, "discount.created", row.id, { kind: a.kind, title: a.title }, tx);
      return row;
    });
    revalidate(ctx, "promotions");
    const names = await nameLookups(ctx.store.id, [d]);
    const summary = describeDiscount(d, { currency: ctx.store.currency, productName: names.productName, collectionName: names.collectionName, timeZone: tz }, { startsAt, endsAt });
    return {
      text: lines(`Automatic discount « ${created.title} » created${created.active ? "" : " (inactive)"}.`, summary),
      data: { id: created.id, title: created.title, kind: created.kind, summary, active: created.active, starts_at: startsAt?.toISOString() ?? null, ends_at: endsAt?.toISOString() ?? null, admin_url: `/app/${ctx.store.id}/promotions` },
    };
  },
});

export const setAutomaticDiscountActive = defineTool({
  name: "set_automatic_discount_active",
  title: "Enable or disable an automatic discount",
  description: "Turn an automatic discount on or off. Disabling is always possible; enabling requires a plan that includes its kind.",
  scopes: ["marketing:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  input: z.object({ discount_id: zId, active: z.boolean() }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireRole(ctx, "coupons.manage", "Managing discounts");
    const row = await db.automaticDiscount.findFirst({ where: { id: a.discount_id, storeId: ctx.store.id }, select: { id: true, title: true, kind: true, active: true } });
    if (!row) throw new ToolError("Automatic discount not found in this store.");
    if (a.active && !allowedDiscountKinds(ctx.planId).has(row.kind)) throw new ToolError(`${KIND_LABELS[row.kind]} discounts are not included in the ${PLANS[ctx.planId].name} plan. The owner can upgrade at /app/${ctx.store.id}/abonnement.`, "plan_required");
    if (row.active !== a.active) {
      await db.$transaction(async (tx) => {
        await tx.automaticDiscount.updateMany({ where: { id: row.id, storeId: ctx.store.id }, data: { active: a.active } });
        await auditApi(ctx, a.active ? "discount.activated" : "discount.deactivated", row.id, { title: row.title }, tx);
      });
      revalidate(ctx, "promotions");
    }
    return { text: `« ${row.title} » is now ${a.active ? "active" : "inactive"}.`, data: { id: row.id, active: a.active } };
  },
});

/* ───────────────────────── Cartes cadeaux et avoirs ───────────────────────── */

export const listGiftCards = defineTool({
  name: "list_gift_cards",
  title: "List gift cards",
  description: "Gift cards of the store with status, balance and expiry. Only the last 4 characters of each code are ever shown (the full code is never available through this connection). Recipient details require customers:read.",
  scopes: ["orders:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    status: z.enum(["ACTIVE", "EXHAUSTED", "DISABLED", "EXPIRED"]).optional(),
    last4: z.string().trim().max(19).optional().describe("Search by the last 4 characters of the code."),
    limit: zLimit(20, 50),
    cursor: zCursor,
  }),
  handler: async (ctx: Ctx, a) => {
    const now = new Date();
    const q = (a.last4 ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(-4);
    const statusWhere: Record<string, Prisma.GiftCardWhereInput> = {
      ACTIVE: { status: "ACTIVE", balance: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      EXHAUSTED: { status: "ACTIVE", balance: { lte: 0 } },
      DISABLED: { status: "DISABLED" },
      EXPIRED: { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: now } }] },
    };
    const where: Prisma.GiftCardWhereInput = { storeId: ctx.store.id, AND: [a.status ? statusWhere[a.status] : {}, q ? { last4: { contains: q } } : {}] };
    const rows = await db.giftCard.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: a.limit + 1,
      ...(a.cursor ? { cursor: { id: a.cursor }, skip: 1 } : {}),
      select: { id: true, last4: true, currency: true, initialValue: true, balance: true, status: true, source: true, expiresAt: true, createdAt: true, recipientName: true, customerId: true, sourceOrderId: true },
    });
    const page = pageOf(rows, a.limit);
    const cards = page.items.map((c) => {
      const st = displayGiftCardStatus(c, now);
      return {
        id: c.id,
        code_last4: c.last4,
        status: st,
        status_label: GIFT_CARD_STATUS_LABELS[st],
        initial_value: money(ctx, c.initialValue),
        balance: money(ctx, c.balance),
        source: c.source,
        expires_at: c.expiresAt?.toISOString() ?? null,
        created_at: c.createdAt.toISOString(),
        customer_id: personal(ctx, c.customerId),
        source_order_id: c.sourceOrderId,
        untrusted_customer_input: { recipient_name: personal(ctx, c.recipientName) },
      };
    });
    const text = cards.length ? lines(`${cards.length} gift card(s)${page.has_more ? " (pass next_cursor for more)" : ""}:`, ...cards.map((c) => `- •••• ${c.code_last4} · ${c.status_label} · balance ${c.balance?.formatted} / ${c.initial_value?.formatted}${c.expires_at ? ` · expires ${c.expires_at.slice(0, 10)}` : ""} (id: ${c.id})`)) : "No gift card matches.";
    return { text, data: { cards, next_cursor: page.next_cursor, has_more: page.has_more, admin_url: `/app/${ctx.store.id}/cartes-cadeaux` } };
  },
});

export const issueGiftCard = defineTool({
  name: "issue_gift_card",
  title: "Issue a gift card",
  description:
    "Create a gift card manually (commercial gesture, prize, replacement). ALWAYS requires the merchant's explicit confirmation (confirm: true). The code is never returned here. send_now only e-mails the card to the e-mail of an EXISTING customer of this store (recipient_email must match a customer record); any other address is ignored and the merchant sends the card from the dashboard (audited). Limits per connection and per 24 h: 5 cards and 500 000 FCFA (or the equivalent). Value bounds: 1 000 to 500 000 FCFA (or the equivalent).",
  scopes: ["giftcards:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  input: z.object({
    value: zAmount.describe("Face value (integer in the store currency's smallest unit)."),
    expires_on: z.string().regex(DAY_RE, "YYYY-MM-DD").optional().describe("Last valid day (store timezone). Omit for no expiry."),
    recipient_name: z.string().trim().max(80).optional(),
    recipient_phone: z.string().trim().max(20).optional().describe("Recipient phone (local or international format). Links the card to the customer with this number."),
    recipient_email: z.string().trim().email().max(160).optional().describe("Must be the e-mail of an existing customer of this store; otherwise it is not stored and nothing is sent."),
    message: z.string().trim().max(300).optional(),
    send_now: z.boolean().default(false).describe("E-mail the card right away to recipient_email, only if it belongs to an existing customer."),
    note: z.string().trim().min(3).max(300).describe("Internal reason, kept in the card's journal."),
    confirm: zConfirm,
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireFeature(ctx, "giftCards", "Gift cards");
    requireRole(ctx, "giftcards.manage", "Issuing gift cards");
    const limits = giftCardLimits(ctx.store.currency);
    if (a.value < limits.minValue || a.value > limits.maxValue) throw new ToolError(`The value must be between ${fmt(ctx, limits.minValue)} and ${fmt(ctx, limits.maxValue)}.`);
    const now = new Date();
    let expiresAt: Date | null = null;
    if (a.expires_on) {
      expiresAt = endOfLocalDay(a.expires_on, ctx.store.timezone);
      if (!expiresAt || expiresAt <= now) throw new ToolError("expires_on must be in the future.");
      if (expiresAt.getTime() - now.getTime() > MAX_GIFT_CARD_VALIDITY_DAYS * DAY) throw new ToolError("Maximum validity: 5 years.");
    }
    let phone: string | null = null;
    if (a.recipient_phone) {
      phone = normalizePhone(a.recipient_phone, getCountry(ctx.store.country)?.dialCode ?? "229");
      if (!phone) throw new ToolError("Invalid recipient phone number.");
    }
    if (a.send_now && !a.recipient_email) throw new ToolError("send_now needs recipient_email (the code is never sent through this connection).");
    requireConfirmation(a.confirm, `issuing a gift card of ${fmt(ctx, a.value)}${a.recipient_name ? ` for ${a.recipient_name}` : ""}`);
    // Destinataire e-mail : uniquement celui d'une fiche client existante de la boutique (jamais une adresse libre).
    const email = a.recipient_email?.toLowerCase() ?? null;
    const emailCustomer = email ? await db.customer.findFirst({ where: { storeId: ctx.store.id, email: { equals: email, mode: "insensitive" } }, select: { id: true } }) : null;
    const recipientEmail = emailCustomer ? email : null;
    const sendNow = a.send_now && !!recipientEmail;
    const phoneCustomer = phone ? await db.customer.findFirst({ where: { storeId: ctx.store.id, phone }, select: { id: true } }) : null;
    const customer = phoneCustomer ?? emailCustomer;
    const card = await db.$transaction(async (tx) => {
      await enforceDailyCapsTx(tx, ctx, "giftCards", a.value);
      const created = await createGiftCardRecord(
        tx,
        {
          storeId: ctx.store.id,
          currency: ctx.store.currency,
          initialValue: a.value,
          status: "ACTIVE",
          source: "MANUAL",
          expiresAt,
          customerId: customer?.id ?? null,
          recipientName: a.recipient_name ?? null,
          recipientPhone: phone,
          recipientEmail,
          message: a.message ?? null,
          createdById: ctx.actor.userId,
        },
        { actorId: ctx.actor.userId, note: `${a.note} (via ${ctx.actor.label})` },
      );
      await auditApi(ctx, "giftcard.created", created.id, { last4: created.last4, value: a.value, expiresAt: expiresAt?.toISOString() ?? null }, tx);
      if (sendNow) await enqueue("giftcard.deliver", { giftCardId: created.id }, { storeId: ctx.store.id }, tx);
      return { id: created.id, last4: created.last4 };
    });
    revalidate(ctx, "cartes-cadeaux");
    return {
      text: lines(
        `Gift card •••• ${card.last4} issued: ${fmt(ctx, a.value)}${expiresAt ? `, valid until ${a.expires_on}` : ", no expiry"}.`,
        sendNow
          ? "It will be e-mailed to the customer's address on file."
          : a.send_now
            ? "Not sent: recipient_email is not the e-mail of an existing customer. The merchant can send it from the dashboard."
            : "The full code is not shown here: the merchant can reveal or resend it from the dashboard.",
      ),
      data: { id: card.id, code_last4: card.last4, value: money(ctx, a.value), expires_at: expiresAt?.toISOString() ?? null, sent_by_email: sendNow, admin_url: `/app/${ctx.store.id}/cartes-cadeaux/${card.id}` },
    };
  },
});

export const grantStoreCredit = defineTool({
  name: "grant_store_credit",
  title: "Grant store credit to a customer",
  description: "Add store credit to a customer's account (commercial gesture). The buyer can spend it at checkout once logged in. ALWAYS requires the merchant's explicit confirmation (confirm: true). Needs both giftcards:write and customers:read. Limits per connection and per 24 h: 10 grants and 500 000 FCFA (or the equivalent).",
  scopes: ["giftcards:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  input: z.object({
    customer_id: zId.describe("Customer id (list_customers / get_customer)."),
    amount: zAmount.describe("Amount to credit (integer in the store currency's smallest unit)."),
    reason: z.string().trim().min(3).max(300).describe("Mandatory reason, kept in the credit journal."),
    confirm: zConfirm,
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    if (!hasScope(ctx, "customers:read")) throw new ToolError("grant_store_credit also requires the customers:read scope.", "insufficient_scope");
    requireFeature(ctx, "storeCredit", "Store credit");
    requireRole(ctx, "customers.manage", "Granting store credit");
    if (a.amount <= 0 || a.amount > STORE_CREDIT_MAX_OPERATION) throw new ToolError("Invalid amount.");
    const customer = await db.customer.findFirst({ where: { id: a.customer_id, storeId: ctx.store.id }, select: { id: true, name: true } });
    if (!customer) throw new ToolError("Customer not found in this store.");
    requireConfirmation(a.confirm, `crediting ${fmt(ctx, a.amount)} to this customer`);
    try {
      const m = await db.$transaction(async (tx) => {
        await enforceDailyCapsTx(tx, ctx, "storeCredit", a.amount);
        const movement = await grantTx(tx, { storeId: ctx.store.id, customerId: customer.id, amount: a.amount, kind: "GRANT", note: a.reason, actorId: ctx.actor.userId });
        await auditApi(ctx, "store_credit.granted", customer.id, { amount: movement.amount, balanceAfter: movement.balanceAfter, reason: a.reason }, tx);
        return movement;
      });
      revalidate(ctx, `clients/${customer.id}`);
      return { text: `${fmt(ctx, a.amount)} of store credit granted. New balance: ${fmt(ctx, m.balanceAfter)}.`, data: { customer_id: customer.id, amount: money(ctx, a.amount), balance_after: money(ctx, m.balanceAfter) } };
    } catch (e) {
      if (e instanceof StoreCreditError) throw new ToolError(e.message);
      throw e;
    }
  },
});

/* ───────────────────────── Retours ───────────────────────── */

const RETURN_HELP = "Return lifecycle: REQUESTED → APPROVED → RECEIVED → RESOLVED; REQUESTED can be REJECTED (reason required); REQUESTED and APPROVED can be CANCELLED.";

function reasonLabel(r: string): string {
  return (RETURN_REASONS as Record<string, string>)[r] ?? r;
}

export const listReturns = defineTool({
  name: "list_returns",
  title: "List returns",
  description: `Return requests, newest first, filtered by status. Buyer-typed texts are under untrusted_customer_input. ${RETURN_HELP}`,
  scopes: ["orders:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    status: z.array(z.enum(RETURN_STATUSES as [ReturnStatus, ...ReturnStatus[]])).max(6).optional().describe('e.g. ["REQUESTED","APPROVED","RECEIVED"] for returns to process.'),
    limit: zLimit(20, 50),
    cursor: zCursor,
  }),
  handler: async (ctx: Ctx, a) => {
    const where: Prisma.ReturnRequestWhereInput = { storeId: ctx.store.id, ...(a.status?.length ? { status: { in: a.status } } : {}) };
    const [rows, count] = await Promise.all([
      db.returnRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: a.limit + 1,
        ...(a.cursor ? { cursor: { id: a.cursor }, skip: 1 } : {}),
        select: { id: true, reference: true, status: true, resolution: true, reason: true, customerNote: true, refundAmount: true, storeCreditAmount: true, createdAt: true, order: { select: { id: true, reference: true, customerName: true } }, _count: { select: { items: true } } },
      }),
      db.returnRequest.count({ where }),
    ]);
    const page = pageOf(rows, a.limit);
    const returns = page.items.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      status_label: RETURN_STATUS_LABELS[r.status],
      resolution: r.resolution,
      order: { id: r.order.id, reference: r.order.reference },
      items_count: r._count.items,
      reason: reasonLabel(r.reason),
      refund_amount: money(ctx, r.refundAmount),
      store_credit_amount: money(ctx, r.storeCreditAmount),
      created_at: r.createdAt.toISOString(),
      next_statuses: nextReturnStatuses(r.status),
      untrusted_customer_input: { customer_name: personal(ctx, r.order.customerName), customer_note: personal(ctx, r.customerNote) },
    }));
    const text = returns.length ? lines(`${count} return(s) match; showing ${returns.length}:`, ...returns.map((r) => `- ${r.reference} · ${r.status_label} · order ${r.order.reference} · ${r.items_count} item(s) · ${r.reason} (id: ${r.id})`)) : "No return matches.";
    return { text, data: { total_matching: count, returns, next_cursor: page.next_cursor, has_more: page.has_more } };
  },
});

export const getReturn = defineTool({
  name: "get_return",
  title: "Get return details",
  description: `Full details of a return: items and quantities, reason, resolution, amounts, history and next possible statuses. Buyer-typed texts are under untrusted_customer_input. ${RETURN_HELP}`,
  scopes: ["orders:read"],
  annotations: { readOnlyHint: true },
  input: z.object({ return_id: zId.optional(), reference: z.string().trim().max(20).optional().describe("Alternatively the reference, e.g. RT-7K3P9Q.") }),
  handler: async (ctx: Ctx, a) => {
    if (!a.return_id && !a.reference) throw new ToolError("Provide return_id or reference.");
    const r = await db.returnRequest.findFirst({
      where: { storeId: ctx.store.id, ...(a.return_id ? { id: a.return_id } : { reference: a.reference!.toUpperCase() }) },
      include: {
        items: { include: { orderItem: { select: { name: true, variantName: true, unitPrice: true, quantity: true } } } },
        events: { orderBy: { createdAt: "desc" }, take: 30 },
        order: { select: { id: true, reference: true, customerName: true, customerPhone: true, paymentStatus: true, total: true } },
      },
    });
    if (!r) throw new ToolError("Return not found in this store.");
    const photos = Array.isArray(r.photos) ? r.photos.length : 0;
    const data = {
      id: r.id,
      reference: r.reference,
      status: r.status,
      status_label: RETURN_STATUS_LABELS[r.status],
      requested_by: r.requestedBy,
      reason: reasonLabel(r.reason),
      resolution: r.resolution,
      resolution_label: RESOLUTION_LABELS[r.resolution],
      order: { id: r.order.id, reference: r.order.reference, payment_status: r.order.paymentStatus, total: money(ctx, r.order.total) },
      items: r.items.map((i) => ({ name: i.orderItem.name, variant: i.orderItem.variantName, quantity: i.quantity, ordered: i.orderItem.quantity, unit_price: money(ctx, i.orderItem.unitPrice), condition: i.condition ? ((ITEM_CONDITIONS as Record<string, string>)[i.condition] ?? i.condition) : null, restock: i.restock, restocked: i.restockedQty })),
      amounts: { refund: money(ctx, r.refundAmount), store_credit: money(ctx, r.storeCreditAmount), restocking_fee: money(ctx, r.restockingFee), refund_shipping: r.refundShipping },
      photos_count: photos,
      merchant_note: r.merchantNote,
      rejection_reason: r.rejectionReason,
      next_statuses: nextReturnStatuses(r.status),
      history: r.events.map((e) => ({ at: e.createdAt.toISOString(), by: e.actorLabel, from: e.fromStatus, to: e.toStatus })),
      untrusted_customer_input: {
        notice: UNTRUSTED_NOTICE,
        customer_name: personal(ctx, r.order.customerName),
        customer_phone: personal(ctx, r.order.customerPhone ? `+${r.order.customerPhone}` : null),
        customer_note: personal(ctx, r.customerNote),
        item_reasons: r.items.map((i) => i.reason).filter(Boolean),
        history_messages: r.events.filter((e) => e.message).map((e) => ({ at: e.createdAt.toISOString(), message: e.message })),
      },
      admin_url: `/app/${ctx.store.id}/retours/${r.id}`,
    };
    const text = lines(
      `Return ${r.reference} — ${RETURN_STATUS_LABELS[r.status]} (order ${r.order.reference}), reason: ${data.reason}`,
      ...data.items.map((i) => `- ${i.quantity}/${i.ordered} × ${i.name}${i.variant ? ` (${i.variant})` : ""}`),
      data.next_statuses.length ? `Can move to: ${data.next_statuses.join(", ")}` : "Final status: no further transition.",
    );
    return { text, data };
  },
});

export const updateReturnStatus = defineTool({
  name: "update_return_status",
  title: "Change return status",
  description: `Move a return through its state machine. APPROVED (optional note), REJECTED (reason required), CANCELLED, RECEIVED (all requested units received; restock: true puts them back in stock), RESOLVED (resolution STORE_CREDIT or REFUND for the suggested amount; REFUND only for a paid order; always needs confirm: true). The buyer is notified and every change is logged. ${RETURN_HELP}`,
  scopes: ["orders:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  input: z.object({
    return_id: zId,
    status: z.enum(["APPROVED", "REJECTED", "CANCELLED", "RECEIVED", "RESOLVED"]),
    reason: z.string().trim().max(500).optional().describe("Required for REJECTED; optional note otherwise."),
    restock: z.boolean().default(true).describe("RECEIVED only: put the received units back in stock."),
    resolution: z.enum(["STORE_CREDIT", "REFUND"]).optional().describe("RESOLVED only."),
    refund_shipping: z.boolean().default(false).describe("RESOLVED only: include delivery fees for a full return."),
    confirm: zConfirm,
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const r = await db.returnRequest.findFirst({ where: { id: a.return_id, storeId: ctx.store.id }, select: { id: true, reference: true, status: true, items: { select: { id: true, quantity: true } } } });
    if (!r) throw new ToolError("Return not found in this store.");
    if (!canTransitionReturn(r.status, a.status)) {
      const next = nextReturnStatuses(r.status);
      throw new ToolError(`Cannot move ${r.reference} from ${r.status} to ${a.status}. Allowed next statuses: ${next.length ? next.join(", ") : "none (final status)"}.`);
    }
    requireRole(ctx, a.status === "RECEIVED" ? "returns.receive" : "returns.manage", "Processing returns");
    const actor: ActorInfo = { kind: "merchant", id: ctx.actor.userId, label: ctx.actor.label };
    let detail = "";
    try {
      switch (a.status) {
        case "APPROVED":
          await approveReturn({ storeId: ctx.store.id, returnId: r.id, actor, note: a.reason ?? null });
          break;
        case "REJECTED":
          if (!a.reason || a.reason.length < 3) throw new ToolError("A reason (3 characters minimum) is required to reject a return.");
          await rejectReturn({ storeId: ctx.store.id, returnId: r.id, actor, reason: a.reason });
          break;
        case "CANCELLED":
          await cancelReturn({ storeId: ctx.store.id, returnId: r.id, actor, note: a.reason ?? null });
          break;
        case "RECEIVED": {
          const res = await receiveReturn({ storeId: ctx.store.id, returnId: r.id, actor, lines: r.items.map((i) => ({ returnItemId: i.id, receivedQty: i.quantity, condition: "neuf" as const, restock: a.restock })), note: a.reason ?? null });
          detail = `${res.restocked} unit(s) back in stock.`;
          break;
        }
        case "RESOLVED": {
          if (!a.resolution) throw new ToolError("resolution (STORE_CREDIT or REFUND) is required to resolve a return.");
          if (a.resolution === "REFUND") requireRole(ctx, "payments.confirm", "Recording a refund");
          if (a.resolution === "STORE_CREDIT") requireFeature(ctx, "storeCredit", "Store credit");
          requireConfirmation(a.confirm, `resolving ${r.reference} with a ${a.resolution === "REFUND" ? "refund" : "store credit"} for the suggested amount`);
          const store = await db.store.findUnique({ where: { id: ctx.store.id }, select: { returnPolicy: true } });
          const res = await resolveReturn({ storeId: ctx.store.id, returnId: r.id, actor, policy: parseReturnPolicy(store?.returnPolicy), resolution: a.resolution, refundShipping: a.refund_shipping, waiveRestockingFee: false, note: a.reason ?? null });
          detail = res.resolution === "REFUND" ? `Refund of ${fmt(ctx, res.amount)} recorded.` : `${fmt(ctx, res.storeCredit)} of store credit granted.`;
          break;
        }
      }
    } catch (e) {
      if (e instanceof ToolError) throw e;
      if (e instanceof ReturnError) throw new ToolError(e.message);
      console.error("[mcp] update_return_status", e);
      throw new ToolError("The return could not be updated because of an internal error. Nothing was modified; try again later.");
    }
    await auditApi(ctx, "return.status_changed", r.id, { reference: r.reference, from: r.status, to: a.status, resolution: a.resolution ?? null });
    revalidate(ctx, "retours", `retours/${r.id}`);
    return {
      text: lines(`Return ${r.reference}: ${RETURN_STATUS_LABELS[r.status]} → ${RETURN_STATUS_LABELS[a.status]}.`, detail || null),
      data: { return_id: r.id, reference: r.reference, from: r.status, to: a.status, next_statuses: nextReturnStatuses(a.status) },
    };
  },
});

export const PROMOTION_TOOLS: McpTool<Ctx>[] = [listAutomaticDiscounts, createAutomaticDiscount, setAutomaticDiscountActive, listGiftCards, issueGiftCard, grantStoreCredit, listReturns, getReturn, updateReturnStatus];
