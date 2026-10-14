import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { randomToken } from "@/lib/utils";
import { effectivePrice } from "@/lib/commerce/pricing";
import { canSell, isBackorder, isSellable } from "@/lib/inventory/policy";
import { shareableImageUrl } from "@/lib/storage/public-url";
import { markdownToText } from "@/lib/products/markdown";
import { rateLimit } from "@/lib/rate-limit";
import { readRules } from "@/lib/collections/rules";
import { getCollectionProducts } from "@/lib/collections/service";
import { defineTool, ToolError, type McpServerDefinition, type McpTool } from "../protocol";
import { appBaseUrl, countPublicCall } from "../runtime";

/**
 * MCP vitrine public (`/api/mcp/store/{slug}`) : commerce agentique sans authentification.
 * Un assistant IA peut consulter le catalogue PUBLIC d'une boutique publiée et préparer un lien de panier ;
 * l'acheteur finalise lui-même sa commande sur la boutique. Jamais de commande ni de paiement créés ici,
 * jamais de donnée interne (prix d'achat, stock exact, clients, commandes).
 */

export const PUBLIC_STORE_SELECT = {
  id: true, slug: true, name: true, tagline: true, description: true, category: true, country: true, city: true, currency: true, timezone: true, status: true,
  whatsappNumber: true, contactEmail: true, contactPhone: true, address: true, openingHours: true, logoUrl: true, pickupEnabled: true, deliveryEnabled: true,
  whatsappOrdering: true, minOrderAmount: true, orderNotes: true, aiAgentsEnabled: true,
} satisfies Prisma.StoreSelect;

export type PublicStore = Prisma.StoreGetPayload<{ select: typeof PUBLIC_STORE_SELECT }>;
export type PublicContext = { store: PublicStore; ip: string };
type Ctx = PublicContext;

/** Boutique exposée aux agents : publiée (ou fermée temporairement pour la consultation) et option activée. */
export async function loadPublicStore(slug: string): Promise<PublicStore | null> {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return null;
  const store = await db.store.findUnique({ where: { slug }, select: PUBLIC_STORE_SELECT });
  if (!store || !store.aiAgentsEnabled) return null;
  if (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY") return null;
  return store;
}

const m = (ctx: Ctx, amount: number) => ({ amount, formatted: formatMoney(amount, ctx.store.currency) });
const storeUrl = (ctx: Ctx) => `${appBaseUrl()}/s/${ctx.store.slug}`;
const zId = z.string().min(8).max(64);

/** URL d'image partageable (https ou média téléversé rendu absolu), dans l'ordre des photos. */
function shareableImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i) => (i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string" ? shareableImageUrl((i as { url: string }).url) : undefined))
    .filter((u): u is string => !!u);
}

function publicImage(raw: unknown): string | null {
  return shareableImages(raw)[0] ?? null;
}

function excerpt(md: string | null | undefined, n: number): string {
  if (!md) return "";
  const t = markdownToText(md).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

type Purchasable = { trackStock: boolean; stock: number; inventoryPolicy: string; variants: { stock: number; available: boolean; inventoryPolicy: string }[] };
/** Achetable : en stock, non suivi, ou vendable en rupture (« continuer à vendre » = précommande). */
function isAvailable(p: Purchasable): boolean {
  if (p.variants.length) return p.variants.some((v) => v.available && isSellable({ trackStock: p.trackStock, stock: v.stock, policy: v.inventoryPolicy }));
  return isSellable({ trackStock: p.trackStock, stock: p.stock, policy: p.inventoryPolicy });
}
/** Uniquement en précommande (aucune unité en stock, mais vente autorisée). Jamais de quantité exposée. */
function isPreorderOnly(p: Purchasable): boolean {
  if (!isAvailable(p)) return false;
  if (p.variants.length) return p.variants.filter((v) => v.available && isSellable({ trackStock: p.trackStock, stock: v.stock, policy: v.inventoryPolicy })).every((v) => isBackorder({ trackStock: p.trackStock, stock: v.stock, policy: v.inventoryPolicy }));
  return isBackorder({ trackStock: p.trackStock, stock: p.stock, policy: p.inventoryPolicy });
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_FR: Record<string, string> = { mon: "lundi", tue: "mardi", wed: "mercredi", thu: "jeudi", fri: "vendredi", sat: "samedi", sun: "dimanche" };

export function readOpeningHours(raw: unknown): Record<string, [string, string][]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, [string, string][]> = {};
  for (const d of DAYS) {
    const v = (raw as Record<string, unknown>)[d];
    if (Array.isArray(v)) out[d] = v.filter((r): r is [string, string] => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === "string" && /^\d{2}:\d{2}$/.test(x)));
  }
  return out;
}

function openNow(hours: Record<string, [string, string][]>, tz: string): boolean | null {
  if (!Object.keys(hours).length) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const day = String(parts.weekday).toLowerCase().slice(0, 3);
    const hm = `${parts.hour}:${parts.minute}`;
    return (hours[day] ?? []).some(([a, b]) => hm >= a && hm < b);
  } catch {
    return null;
  }
}

export function hoursText(hours: Record<string, [string, string][]>): string {
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return order.map((d) => `${DAY_FR[d]} : ${(hours[d] ?? []).length ? hours[d].map(([a, b]) => `${a}-${b}`).join(", ") : "fermé"}`).join(" ; ");
}

/* ───────────────────────── Outils ───────────────────────── */

export const getStoreInfo = defineTool({
  name: "get_store_info",
  title: "Store information",
  description: "Public information about the store: description, location, opening hours (and whether it is open now), WhatsApp contact link, delivery/pickup summary, payment methods and store policies (terms, returns, delivery pages).",
  scopes: [],
  annotations: { readOnlyHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    const s = ctx.store;
    const [pages, methods] = await Promise.all([
      db.storePage.findMany({ where: { storeId: s.id, published: true }, orderBy: { position: "asc" }, take: 10, select: { slug: true, title: true, body: true } }),
      db.paymentMethod.findMany({ where: { storeId: s.id, active: true }, select: { label: true, kind: true } }),
    ]);
    const hours = readOpeningHours(s.openingHours);
    const data = {
      name: s.name, tagline: s.tagline, description: excerpt(s.description, 1500), category: s.category, city: s.city, country: s.country, address: s.address,
      currency: s.currency, url: storeUrl(ctx), status: s.status === "PUBLISHED" ? "open_for_orders" : "temporarily_closed",
      opening_hours: hours, open_now: openNow(hours, s.timezone), timezone: s.timezone,
      whatsapp: s.whatsappNumber ? { number: `+${s.whatsappNumber}`, link: `https://wa.me/${s.whatsappNumber}` } : null,
      email: s.contactEmail, phone: s.contactPhone,
      ordering: { pickup: s.pickupEnabled, delivery: s.deliveryEnabled, whatsapp_order: s.whatsappOrdering, minimum_order: s.minOrderAmount ? m(ctx, s.minOrderAmount) : null, checkout_note: s.orderNotes },
      payment_methods: methods.map((p) => p.label),
      policies: pages.map((p) => ({ title: p.title, url: `${storeUrl(ctx)}/pages/${p.slug}`, summary: excerpt(p.body, 600) })),
    };
    const text = [
      `${s.name}${s.tagline ? `: ${s.tagline}` : ""} (${[s.city, s.country].filter(Boolean).join(", ")}). ${data.status === "open_for_orders" ? "Accepting orders." : "Temporarily closed: orders are paused."}`,
      Object.keys(hours).length ? `Hours: ${hoursText(hours)}${data.open_now != null ? ` (open now: ${data.open_now ? "yes" : "no"})` : ""}.` : null,
      data.whatsapp ? `WhatsApp: ${data.whatsapp.link}` : null,
      `Store: ${data.url}`,
    ].filter(Boolean).join("\n");
    return { text, data };
  },
});

export const searchCatalog = defineTool({
  name: "search_catalog",
  title: "Search the catalog",
  description: "Search products currently for sale in this store by keywords, collection or price range. Returns current prices (promotions included), availability and product page links. Prices are integers in the store currency's smallest unit (XOF: whole francs).",
  scopes: [],
  annotations: { readOnlyHint: true },
  input: z.object({
    query: z.string().trim().max(100).optional().describe("Keywords (product name, tag)."),
    collection: z.string().trim().max(80).optional().describe("Collection handle (slug) to browse."),
    min_price: z.number().int().min(0).optional(),
    max_price: z.number().int().min(0).optional(),
    in_stock_only: z.boolean().default(true),
    limit: z.number().int().min(1).max(24).default(12),
  }),
  handler: async (ctx: Ctx, a) => {
    const where: Prisma.ProductWhereInput = { storeId: ctx.store.id, status: "ACTIVE" };
    if (a.query) where.OR = [{ name: { contains: a.query, mode: "insensitive" } }, { tags: { has: a.query.toLowerCase() } }, { description: { contains: a.query, mode: "insensitive" } }];
    if (a.collection) {
      const col = await db.category.findFirst({ where: { storeId: ctx.store.id, slug: a.collection, published: true }, select: { id: true } });
      if (!col) throw new ToolError("Unknown collection for this store.");
      const res = await getCollectionProducts(ctx.store.id, col.id);
      where.id = { in: res?.products.map((p) => p.id) ?? [] };
    }
    const rows = await db.product.findMany({
      where,
      orderBy: [{ isFeatured: "desc" }, { position: "asc" }],
      take: 200,
      select: { id: true, name: true, slug: true, description: true, price: true, compareAtPrice: true, promoPrice: true, promoStart: true, promoEnd: true, images: true, trackStock: true, stock: true, inventoryPolicy: true, tags: true, variants: { select: { stock: true, available: true, price: true, inventoryPolicy: true } } },
    });
    const now = new Date();
    const items = rows
      .map((p) => {
        const eff = effectivePrice(p, now);
        const variantPrices = p.variants.map((v) => v.price ?? eff.price);
        const from = variantPrices.length ? Math.min(...variantPrices) : eff.price;
        return { p, eff, from, available: isAvailable(p), preorder: isPreorderOnly(p) };
      })
      .filter((x) => (!a.in_stock_only || x.available) && (a.min_price == null || x.from >= a.min_price) && (a.max_price == null || x.from <= a.max_price))
      .slice(0, a.limit)
      .map(({ p, eff, from, available, preorder }) => ({
        id: p.id, name: p.name, price: m(ctx, from), price_from: p.variants.length > 1, on_sale: eff.isPromo, regular_price: eff.isPromo ? m(ctx, p.price) : null,
        compare_at_price: p.compareAtPrice ? m(ctx, p.compareAtPrice) : null, available, preorder, has_variants: p.variants.length > 0,
        summary: excerpt(p.description, 240), image: publicImage(p.images), url: `${storeUrl(ctx)}/p/${p.slug}`,
      }));
    const text = items.length ? [`${items.length} product(s) at ${ctx.store.name}:`, ...items.map((i) => `- ${i.name}: ${i.price_from ? "from " : ""}${i.price.formatted}${i.on_sale ? " (on sale)" : ""}${i.available ? (i.preorder ? " (pre-order)" : "") : " (sold out)"}, ${i.url} (id: ${i.id})`)].join("\n") : "No product matches.";
    return { text, data: { store: ctx.store.name, currency: ctx.store.currency, products: items } };
  },
});

export const getPublicProduct = defineTool({
  name: "get_product",
  title: "Product details",
  description: "Public details of a product: description, price, variants (size, color…) with their availability, required or optional supplements (with option ids for create_checkout_link) and images.",
  scopes: [],
  annotations: { readOnlyHint: true },
  input: z.object({ product_id: zId.optional(), slug: z.string().trim().max(120).optional() }),
  handler: async (ctx: Ctx, a) => {
    if (!a.product_id && !a.slug) throw new ToolError("Provide product_id or slug.");
    const p = await db.product.findFirst({
      where: { storeId: ctx.store.id, status: "ACTIVE", ...(a.product_id ? { id: a.product_id } : { slug: a.slug }) },
      include: { variants: { orderBy: { position: "asc" } }, optionGroups: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
    });
    if (!p) throw new ToolError("Product not found or not for sale.");
    const eff = effectivePrice(p);
    const data = {
      id: p.id, name: p.name, description: excerpt(p.description, 3000), price: m(ctx, eff.price), on_sale: eff.isPromo, regular_price: eff.isPromo ? m(ctx, p.price) : null,
      available: isAvailable(p), preorder: isPreorderOnly(p), min_quantity: p.minQty, max_quantity: p.maxQty,
      variants: p.variants.map((v) => {
        const item = { trackStock: p.trackStock, stock: v.stock, policy: v.inventoryPolicy };
        return { id: v.id, name: v.name, attributes: v.attributes, price: m(ctx, v.price ?? eff.price), available: v.available && isSellable(item), preorder: v.available && isBackorder(item) };
      }),
      supplements: p.optionGroups.map((g) => ({ group: g.name, required: g.required, min: g.minSelect, max: g.maxSelect, options: g.options.map((o) => ({ id: o.id, name: o.name, extra: m(ctx, o.priceDelta) })) })),
      images: shareableImages(p.images).slice(0, 5),
      url: `${storeUrl(ctx)}/p/${p.slug}`,
    };
    const text = [
      `${p.name}: ${data.price.formatted}${eff.isPromo ? ` (on sale, regular ${data.regular_price?.formatted})` : ""}${data.available ? (data.preorder ? " (available for pre-order, shipping delayed)" : "") : " (sold out)"}`,
      data.variants.length ? `Variants: ${data.variants.map((v) => `${v.name} ${v.price.formatted}${v.available ? (v.preorder ? " (pre-order)" : "") : " (sold out)"} [id ${v.id}]`).join("; ")}` : null,
      data.supplements.length ? `Supplements: ${data.supplements.map((g) => `${g.group}${g.required ? " (required)" : ""}: ${g.options.map((o) => `${o.name} +${o.extra.formatted} [id ${o.id}]`).join(", ")}`).join(" | ")}` : null,
      data.url,
    ].filter(Boolean).join("\n");
    return { text, data };
  },
});

const zItems = z
  .array(
    z.object({
      product_id: zId,
      variant_id: zId.optional().describe("Required when the product has variants."),
      quantity: z.number().int().min(1).max(999).default(1),
      option_ids: z.array(zId).max(20).optional().describe("Supplement option ids (see get_product)."),
    }),
  )
  .min(1)
  .max(20);

/** check_availability : réponse binaire (disponible / indisponible), 20 unités au plus par ligne (pas de sondage du stock). */
const zAvailabilityItems = z
  .array(
    z.object({
      product_id: zId,
      variant_id: zId.optional(),
      quantity: z.number().int().min(1).max(20).default(1),
      option_ids: z.array(zId).max(20).optional(),
    }),
  )
  .min(1)
  .max(20);

type ItemInput = z.output<typeof zItems>[number];

async function resolveItems(ctx: Ctx, items: ItemInput[]) {
  const products = await db.product.findMany({
    where: { storeId: ctx.store.id, status: "ACTIVE", id: { in: [...new Set(items.map((i) => i.product_id))] } },
    include: { variants: true, optionGroups: { include: { options: true } } },
  });
  const now = new Date();
  return items.map((i) => {
    const p = products.find((x) => x.id === i.product_id);
    if (!p) return { input: i, ok: false as const, reason: "Product not found or not for sale." };
    const variant = i.variant_id ? p.variants.find((v) => v.id === i.variant_id) : null;
    if (i.variant_id && !variant) return { input: i, ok: false as const, name: p.name, reason: "Unknown variant for this product." };
    if (p.variants.length && !variant) return { input: i, ok: false as const, name: p.name, reason: `Choose a variant: ${p.variants.map((v) => `${v.name} [${v.id}]`).join(", ")}.` };
    const options = p.optionGroups.flatMap((g) => g.options).filter((o) => i.option_ids?.includes(o.id));
    const missing = p.optionGroups.filter((g) => g.required && !g.options.some((o) => i.option_ids?.includes(o.id)));
    const name = variant ? `${p.name} (${variant.name})` : p.name;
    const stockItem = { trackStock: p.trackStock, stock: variant ? variant.stock : p.stock, policy: variant ? variant.inventoryPolicy : p.inventoryPolicy };
    const base = variant?.price ?? effectivePrice(p, now).price;
    const unit = base + options.reduce((s, o) => s + o.priceDelta, 0);
    let reason: string | null = null;
    if (variant && !variant.available) reason = "This variant is not available.";
    else if (!canSell(stockItem, i.quantity)) reason = "Not available in this quantity.";
    else if (i.quantity < p.minQty) reason = `Minimum quantity is ${p.minQty}.`;
    else if (p.maxQty != null && i.quantity > p.maxQty) reason = `Maximum quantity is ${p.maxQty}.`;
    else if (missing.length) reason = `Required choice missing: ${missing.map((g) => g.name).join(", ")}.`;
    // Précommande : seulement quand il n'y a plus de stock (« continuer à vendre »). Une quantité au-delà d'un stock
    // positif reste « available » : sinon la réponse révélerait le niveau de stock par sondage.
    return { input: i, ok: reason == null, name, reason, unitPrice: unit, options, preorder: reason == null && isBackorder(stockItem) };
  });
}

export const checkAvailability = defineTool({
  name: "check_availability",
  title: "Check availability",
  description: "Check whether items (product, variant, quantity up to 20, supplements) can be ordered right now. Answers only available / available for pre-order (shipping delayed) / not available, never the stock level; prices come from get_product and are recomputed by the store at checkout.",
  scopes: [],
  annotations: { readOnlyHint: true },
  input: z.object({ items: zAvailabilityItems }),
  handler: async (ctx: Ctx, a) => {
    const res = await resolveItems(ctx, a.items);
    const items = res.map((r) => ({ product_id: r.input.product_id, variant_id: r.input.variant_id ?? null, name: r.name ?? null, quantity: r.input.quantity, available: r.ok, ...(r.ok ? { availability: r.preorder ? ("preorder" as const) : ("in_stock" as const) } : { reason: r.reason ?? "Not available." }) }));
    const text = items.map((i) => `- ${i.name ?? i.product_id} × ${i.quantity}: ${"reason" in i ? `not available (${i.reason})` : i.availability === "preorder" ? "available for pre-order (disponible en précommande, expédition différée)" : "available"}`).join("\n");
    return { text, data: { store_accepts_orders: ctx.store.status === "PUBLISHED", items } };
  },
});

export const getDeliveryOptions = defineTool({
  name: "get_delivery_options",
  title: "Delivery and pickup options",
  description: "How buyers can receive their order: delivery zones with fees, free-delivery thresholds and delays, in-store pickup with time slots, ordering through WhatsApp, and accepted payment methods.",
  scopes: [],
  annotations: { readOnlyHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    const s = ctx.store;
    const [zones, slots, methods] = await Promise.all([
      s.deliveryEnabled ? db.deliveryZone.findMany({ where: { storeId: s.id, active: true }, orderBy: { position: "asc" }, take: 50 }) : Promise.resolve([]),
      s.pickupEnabled ? db.pickupSlot.findMany({ where: { storeId: s.id, active: true }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }], take: 50 }) : Promise.resolve([]),
      db.paymentMethod.findMany({ where: { storeId: s.id, active: true }, select: { label: true, kind: true } }),
    ]);
    const dayName = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const data = {
      delivery: s.deliveryEnabled ? zones.map((z) => ({ zone: z.name, fee: m(ctx, z.fee), free_above: z.freeAbove != null ? m(ctx, z.freeAbove) : null, delay: z.etaLabel })) : null,
      pickup: s.pickupEnabled ? { address: s.address, slots: slots.map((x) => ({ day: dayName[x.dayOfWeek], from: x.startTime, to: x.endTime })) } : null,
      whatsapp_order: s.whatsappOrdering && !!s.whatsappNumber,
      payment_methods: methods.map((p) => ({ label: p.label, kind: p.kind })),
      minimum_order: s.minOrderAmount ? m(ctx, s.minOrderAmount) : null,
    };
    const text = [
      data.delivery ? (data.delivery.length ? `Delivery: ${data.delivery.map((z) => `${z.zone} ${z.fee.formatted}${z.free_above ? ` (free from ${z.free_above.formatted})` : ""}${z.delay ? `, ${z.delay}` : ""}`).join("; ")}` : "Delivery: on request.") : "No delivery.",
      data.pickup ? `Pickup${s.address ? ` at ${s.address}` : ""}${data.pickup.slots.length ? `: ${data.pickup.slots.map((x) => `${x.day} ${x.from}-${x.to}`).join(", ")}` : ""}.` : "No pickup.",
      data.payment_methods.length ? `Payment: ${data.payment_methods.map((p) => p.label).join(", ")}.` : null,
    ].filter(Boolean).join("\n");
    return { text, data };
  },
});

export const createCheckoutLink = defineTool({
  name: "create_checkout_link",
  title: "Create a checkout link",
  description: "Prepare a cart for the buyer and return a link to this store where THEY review it and complete the order themselves (delivery details, payment). This tool never places an order and never charges anything. Give the link to the buyer.",
  scopes: [],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input: z.object({ items: zItems }),
  handler: async (ctx: Ctx, a) => {
    if (ctx.store.status !== "PUBLISHED") throw new ToolError("This store is temporarily closed and does not accept orders right now.");
    const rl = await rateLimit(`mcp-public:checkout:ip:${ctx.ip}`, 10, 600);
    if (!rl.ok) throw new ToolError(`Too many checkout links created. Try again in ${Math.ceil(rl.retryAfter / 60)} minute(s).`);
    const res = await resolveItems(ctx, a.items);
    const bad = res.filter((r) => !r.ok);
    if (bad.length) throw new ToolError(`Some items cannot be ordered: ${bad.map((b) => `${b.name ?? b.input.product_id}: ${b.reason}`).join(" ")}`);
    const token = randomToken(16);
    await db.cart.create({
      data: {
        storeId: ctx.store.id,
        token,
        items: {
          create: res.map((r) => ({
            productId: r.input.product_id,
            variantId: r.input.variant_id ?? null,
            quantity: r.input.quantity,
            options: (r.options ?? []).map((o) => ({ optionId: o.id, name: o.name, priceDelta: o.priceDelta })) as unknown as Prisma.InputJsonValue,
          })),
        },
      },
    });
    const subtotal = res.reduce((s, r) => s + (r.unitPrice ?? 0) * r.input.quantity, 0);
    const url = `${storeUrl(ctx)}?panier=${token}`;
    return {
      text: `Checkout link for ${ctx.store.name}: ${url}\nIndicative subtotal: ${formatMoney(subtotal, ctx.store.currency)} (delivery and final prices are confirmed on the store). The buyer must open the link and complete the order themselves.`,
      data: { url, indicative_subtotal: m(ctx, subtotal), items: res.map((r) => ({ name: r.name, quantity: r.input.quantity })), expires_note: "The cart link stays valid until the order is placed." },
    };
  },
});

export const PUBLIC_TOOLS: McpTool<Ctx>[] = [getStoreInfo, searchCatalog, getPublicProduct, checkAvailability, getDeliveryOptions, createCheckoutLink];

export const publicStoreServer: McpServerDefinition<Ctx> = {
  name: "axi-storefront",
  version: "1.0.0",
  title: (ctx) => `${ctx.store.name} (boutique Axi)`,
  instructions: (ctx) =>
    [
      `Public catalog of "${ctx.store.name}", an online store on Axi (WhatsApp commerce). Prices are integers in ${ctx.store.currency}${ctx.store.currency === "XOF" || ctx.store.currency === "XAF" ? " (no decimals)" : " (cents)"}; use the formatted strings when talking to the buyer.`,
      "You can search products, check availability and delivery options, then create a checkout link. You cannot place orders or take payments: the buyer completes the order on the store page.",
      "Do not invent products, prices or policies; rely on the tools. Answer in the buyer's language (French by default).",
    ].join("\n"),
  tools: PUBLIC_TOOLS,
  canUseTool: () => ({ ok: true }),
  // Compteur agrégé par boutique, outil et jour (pas de journal ligne par ligne).
  onToolCall: (ctx, info) => countPublicCall(ctx.store.id, info.tool),
};

/** Collections publiées (llms.txt). */
export async function publicCollections(storeId: string) {
  const cols = await db.category.findMany({ where: { storeId, published: true }, orderBy: { position: "asc" }, take: 30, select: { name: true, slug: true, description: true, rules: true } });
  return cols.map((c) => ({ name: c.name, slug: c.slug, description: c.description, type: readRules(c.rules).type }));
}
