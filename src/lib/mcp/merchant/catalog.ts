import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { slugify } from "@/lib/utils";
import { effectivePrice } from "@/lib/commerce/pricing";
import { checkProductsQuota } from "@/lib/commerce/quotas";
import { readOptions, stockSummary } from "@/lib/products/variants";
import { effectiveLowStockThreshold } from "@/lib/inventory/policy";
import { lowStockItems, storeLowStockThreshold } from "@/lib/inventory/service";
import { cleanMarkdown } from "@/lib/products/markdown";
import { normalizeTag } from "@/lib/products/schemas";
import { describeRules, readRules } from "@/lib/collections/rules";
import { collectionsByProduct, getCollectionProducts, lockStoreCategories } from "@/lib/collections/service";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { kindTracksStock, productKindOf } from "@/lib/digital/kinds";
import { listProductAssets } from "@/lib/digital/service";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { appBaseUrl } from "../runtime";
import { assertWritable, auditApi, bigPriceChange, fmt, hasScope, images, lines, money, pageOf, requireConfirmation, requireFeature, revalidate, zAmount, zConfirm, zCursor, zDateInput, zId, zLimit, parseDate } from "./common";

type Ctx = MerchantContext;

const STATUS = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
const STATUS_LABEL: Record<(typeof STATUS)[number], string> = { ACTIVE: "active (visible in the store)", DRAFT: "draft (hidden)", ARCHIVED: "archived" };

const zHttpsImage = z.object({
  url: z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(2000).describe("Public https image URL."),
  alt: z.string().trim().max(200).optional().describe("Alternative text (accessibility)."),
});
const zTags = z.array(z.string().trim().min(1).max(40)).max(50);
/** Politique de rupture (format Shopify) : deny = refuser la vente à zéro, continue = continuer à vendre (précommande). */
const zPolicy = z
  .enum(["deny", "continue", "DENY", "CONTINUE"])
  .transform((v) => v.toUpperCase() as "DENY" | "CONTINUE")
  .describe("Out-of-stock policy: 'deny' stops selling at zero stock, 'continue' keeps selling (pre-order, stock may go negative).");
const zThreshold = z.number().int().min(0).max(100_000).nullable().describe("Product low-stock alert threshold; null = store default threshold.");
const policyOut = (p: string) => (p === "CONTINUE" ? "continue" : "deny");

function productUrl(ctx: Ctx, slug: string) {
  return `${appBaseUrl()}/s/${ctx.store.slug}/p/${slug}`;
}

async function uniqueSlug(tx: Tx, storeId: string, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "produit";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root.slice(0, 44)}-${i + 1}`;
    const clash = await tx.product.findFirst({ where: { storeId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `${root.slice(0, 40)}-${Date.now().toString(36)}`;
}

/** Remplace l'appartenance d'un produit aux collections MANUELLES (les collections automatiques suivent leurs règles). */
async function setManualCollections(tx: Tx, storeId: string, productId: string, collectionIds: string[]): Promise<{ applied: string[]; ignored: string[] }> {
  await lockStoreCategories(tx, storeId);
  const cols = await tx.category.findMany({ where: { storeId }, select: { id: true, rules: true } });
  const wanted = new Set(collectionIds);
  const applied: string[] = [];
  const ignored = collectionIds.filter((id) => !cols.some((c) => c.id === id && readRules(c.rules).type === "manual"));
  for (const c of cols) {
    const rules = readRules(c.rules);
    if (rules.type !== "manual") continue;
    const has = rules.productIds.includes(productId);
    if (wanted.has(c.id) && !has) {
      await tx.category.update({ where: { id: c.id }, data: { rules: { type: "manual", productIds: [...rules.productIds, productId] } } });
    } else if (!wanted.has(c.id) && has) {
      await tx.category.update({ where: { id: c.id }, data: { rules: { type: "manual", productIds: rules.productIds.filter((x) => x !== productId) } } });
    }
    if (wanted.has(c.id)) applied.push(c.id);
  }
  // La catégorie principale suit : conservée si toujours membre, sinon la première collection choisie.
  const p = await tx.product.findFirst({ where: { id: productId, storeId }, select: { categoryId: true } });
  const nextCategory = p?.categoryId && applied.includes(p.categoryId) ? p.categoryId : (applied[0] ?? null);
  if (p && p.categoryId !== nextCategory) await tx.product.update({ where: { id: productId }, data: { categoryId: nextCategory } });
  return { applied, ignored };
}

function productSummary(
  ctx: Ctx,
  p: {
    id: string; name: string; slug: string; status: string; price: number; compareAtPrice: number | null; promoPrice: number | null; promoStart: Date | null; promoEnd: Date | null;
    trackStock: boolean; stock: number; inventoryPolicy: string; tags: string[]; variants: { stock: number }[];
    kind?: string | null; isGiftCard?: boolean | null;
  },
) {
  const eff = effectivePrice(p);
  const stock = stockSummary(p);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    price: money(ctx, p.price),
    current_price: money(ctx, eff.price),
    on_sale: eff.isPromo,
    compare_at_price: money(ctx, p.compareAtPrice),
    // Vague 2 : nature du produit (physical | digital | service | gift_card).
    kind: productKindOf(p).toLowerCase(),
    stock_tracked: p.trackStock,
    stock: p.trackStock ? stock.total : null,
    /** Produit simple : politique du produit ; avec variantes : voir chaque variante (get_product). */
    inventory_policy: policyOut(p.inventoryPolicy),
    variants_count: p.variants.length,
    tags: p.tags,
    url: productUrl(ctx, p.slug),
  };
}

const SUMMARY_SELECT = {
  id: true, name: true, slug: true, status: true, price: true, compareAtPrice: true, promoPrice: true, promoStart: true, promoEnd: true,
  trackStock: true, stock: true, inventoryPolicy: true, tags: true, variants: { select: { stock: true } },
  kind: true, isGiftCard: true,
} satisfies Prisma.ProductSelect;

/* ───────────────────────── Lecture ───────────────────────── */

export const searchProducts = defineTool({
  name: "search_products",
  title: "Search products",
  description: "Search the store catalog by text (name, SKU, tag), status or collection. Returns prices (current price includes active promotions), stock and product ids for follow-up calls. Paginate with next_cursor.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    query: z.string().trim().max(100).optional().describe("Free text matched against name, SKU and tags."),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED", "ANY"]).default("ANY").describe("ANY = active and draft products (archived excluded unless ARCHIVED is requested)."),
    collection_id: zId.optional().describe("Only products in this collection (see list_collections)."),
    tag: z.string().trim().max(40).optional(),
    limit: zLimit(20, 50),
    cursor: zCursor,
  }),
  handler: async (ctx: Ctx, a) => {
    const where: Prisma.ProductWhereInput = { storeId: ctx.store.id, status: a.status === "ANY" ? { not: "ARCHIVED" } : a.status };
    if (a.query) {
      const tag = normalizeTag(a.query).toLowerCase();
      where.OR = [{ name: { contains: a.query, mode: "insensitive" } }, { sku: { contains: a.query, mode: "insensitive" } }, { tags: { has: tag } }, { tags: { has: a.query } }];
    }
    if (a.tag) where.tags = { has: a.tag };
    if (a.collection_id) {
      const col = await getCollectionProducts(ctx.store.id, a.collection_id, { includeInactive: true });
      if (!col) throw new ToolError("Collection not found in this store. Use list_collections to get valid ids.");
      where.id = { in: col.products.map((p) => p.id) };
    }
    const rows = await db.product.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: a.limit + 1,
      ...(a.cursor ? { cursor: { id: a.cursor }, skip: 1 } : {}),
    });
    const page = pageOf(rows, a.limit);
    const products = page.items.map((p) => productSummary(ctx, p));
    const text = products.length
      ? lines(
          `${products.length} product(s)${page.has_more ? " (more available: pass next_cursor)" : ""}:`,
          ...products.map((p) => `- ${p.name} [${p.status}] ${p.current_price?.formatted}${p.on_sale ? ` (promo, normally ${p.price?.formatted})` : ""}${p.stock_tracked ? `, stock ${p.stock}` : ""}${p.variants_count ? `, ${p.variants_count} variants` : ""} (id: ${p.id})`),
        )
      : "No product matches these criteria.";
    return { text, data: { products, next_cursor: page.next_cursor, has_more: page.has_more } };
  },
});

export const getProduct = defineTool({
  name: "get_product",
  title: "Get product details",
  description: "Full details of one product: description, prices, promotion window, variants (with their own price and stock), purchase options/supplements, images, tags and collections.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    product_id: zId.optional().describe("Product id (from search_products)."),
    slug: z.string().trim().max(120).optional().describe("Alternatively, the product slug."),
  }),
  handler: async (ctx: Ctx, a) => {
    if (!a.product_id && !a.slug) throw new ToolError("Provide product_id or slug.");
    const p = await db.product.findFirst({
      where: { storeId: ctx.store.id, ...(a.product_id ? { id: a.product_id } : { slug: a.slug }) },
      include: {
        variants: { orderBy: { position: "asc" } },
        optionGroups: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } },
      },
    });
    if (!p) throw new ToolError("Product not found in this store.");
    const digitalFiles = productKindOf(p) === "DIGITAL" ? await listProductAssets(ctx.store.id, p.id) : [];
    const cols = (await collectionsByProduct(ctx.store.id, [p.id])).get(p.id) ?? [];
    const eff = effectivePrice(p);
    const storeThreshold = await storeLowStockThreshold(ctx.store.id);
    const data = {
      ...productSummary(ctx, p),
      description: p.description ?? "",
      sku: p.sku,
      barcode: p.barcode,
      low_stock_threshold: p.lowStockThreshold,
      effective_low_stock_threshold: effectiveLowStockThreshold(p.lowStockThreshold, storeThreshold),
      oversold: p.trackStock && (p.variants.length ? p.variants.some((v) => v.stock < 0) : p.stock < 0),
      cost_price: money(ctx, p.costPrice),
      promo: p.promoPrice != null ? { price: money(ctx, p.promoPrice), starts_at: p.promoStart?.toISOString() ?? null, ends_at: p.promoEnd?.toISOString() ?? null, active_now: eff.isPromo } : null,
      min_quantity: p.minQty,
      max_quantity: p.maxQty,
      featured: p.isFeatured,
      product_type: p.productType,
      vendor: p.vendor,
      // Vague 2 : détails propres à la nature du produit (fichiers, limites, prestation).
      digital:
        productKindOf(p) === "DIGITAL"
          ? { files: digitalFiles.length, download_limit: p.downloadLimit ?? 5, download_validity_days: p.downloadValidityDays ?? 365, file_names: digitalFiles.map((f) => f.name) }
          : null,
      service:
        productKindOf(p) === "SERVICE"
          ? { duration_minutes: p.serviceDurationMinutes, location: p.serviceLocation, remote: p.serviceRemote, booking_note: p.serviceBookingNote }
          : null,
      post_purchase_instructions: p.postPurchaseInstructions,
      options: readOptions(p.options).map((o) => ({ name: o.name, type: o.type, values: o.values.map((v) => v.value) })),
      variants: p.variants.map((v) => ({
        id: v.id,
        name: v.name,
        attributes: v.attributes,
        price: money(ctx, v.price ?? eff.price),
        has_own_price: v.price != null,
        compare_at_price: money(ctx, v.compareAtPrice),
        sku: v.sku,
        barcode: v.barcode,
        stock: p.trackStock ? v.stock : null,
        inventory_policy: policyOut(v.inventoryPolicy),
        available: v.available,
      })),
      supplements: p.optionGroups.map((g) => ({ group: g.name, required: g.required, min: g.minSelect, max: g.maxSelect, choices: g.options.map((o) => ({ id: o.id, name: o.name, price_delta: money(ctx, o.priceDelta) })) })),
      images: images(p.images),
      collections: cols,
      created_at: p.createdAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
    };
    const text = lines(
      `${p.name} — ${STATUS_LABEL[p.status]}${data.kind !== "physical" ? ` (${data.kind.replace("_", " ")})` : ""}`,
      data.digital ? `Files: ${data.digital.files} (${data.digital.file_names.join(", ") || "none yet"}), ${data.digital.download_limit} download(s) per order, link valid ${data.digital.download_validity_days} day(s)` : null,
      data.service ? `Service${data.service.duration_minutes ? `, ${data.service.duration_minutes} min` : ""}${data.service.remote ? ", remote" : data.service.location ? `, at ${data.service.location}` : ""}` : null,
      `Price: ${fmt(ctx, eff.price)}${eff.isPromo ? ` (promotion; regular ${fmt(ctx, p.price)})` : ""}`,
      p.trackStock ? `Stock: ${data.stock} (low-stock threshold ${data.effective_low_stock_threshold}${p.lowStockThreshold == null ? ", store default" : ""})${p.variants.length ? "" : `, out-of-stock policy: ${data.inventory_policy}`}` : "Stock not tracked",
      data.variants.length ? `Variants: ${data.variants.map((v) => `${v.name} ${v.price?.formatted}${v.stock != null ? ` (stock ${v.stock}${v.inventory_policy === "continue" ? ", keeps selling when out of stock" : ""})` : ""}`).join("; ")}` : null,
      cols.length ? `Collections: ${cols.map((c) => c.name).join(", ")}` : null,
      `URL: ${data.url}`,
    );
    return { text, data };
  },
});

export const listCollections = defineTool({
  name: "list_collections",
  title: "List collections",
  description: "Collections of the store (manual lists or automatic rule-based collections) with their product count. Only manual collections accept add_products_to_collection.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    const [cols, products] = await Promise.all([
      db.category.findMany({ where: { storeId: ctx.store.id }, orderBy: { position: "asc" }, select: { id: true, name: true, slug: true, rules: true, published: true, sortOrder: true } }),
      db.product.findMany({ where: { storeId: ctx.store.id, status: { not: "ARCHIVED" } }, select: { id: true }, take: 5000 }),
    ]);
    const membership = await collectionsByProduct(ctx.store.id, products.map((p) => p.id));
    const counts = new Map<string, number>();
    for (const list of membership.values()) for (const c of list) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    const collections = cols.map((c) => {
      const rules = readRules(c.rules);
      return { id: c.id, name: c.name, slug: c.slug, type: rules.type, rules: describeRules(rules), published: c.published, products_count: counts.get(c.id) ?? 0, url: `${appBaseUrl()}/s/${ctx.store.slug}/collections/${c.slug}` };
    });
    const text = collections.length ? lines(`${collections.length} collection(s):`, ...collections.map((c) => `- ${c.name} (${c.type}, ${c.products_count} products${c.published ? "" : ", hidden"}) id: ${c.id}`)) : "This store has no collection yet.";
    return { text, data: { collections } };
  },
});

export const listLowStock = defineTool({
  name: "list_low_stock",
  title: "List low-stock items",
  description: "Active products and variants whose tracked stock is at or below their low-stock threshold (the product's own threshold, else the store default), out-of-stock and oversold first. Pass threshold to use one fixed level for every item instead. Use it to answer 'what is out of stock?' or to plan restocking.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true },
  input: z.object({
    threshold: z.number().int().min(0).max(100_000).optional().describe("Optional fixed stock level for all items (0 = out of stock only). Omit to use each product's threshold (else the store default)."),
    limit: zLimit(50, 200),
  }),
  handler: async (ctx: Ctx, a) => {
    const storeThreshold = a.threshold ?? (await storeLowStockThreshold(ctx.store.id));
    const rows = await lowStockItems(ctx.store.id, { storeThreshold, scope: "active", limit: a.limit, ignoreProductThreshold: a.threshold != null });
    const items = rows.map((r) => ({
      product_id: r.productId,
      variant_id: r.variantId,
      name: r.variantName ? `${r.name} (${r.variantName})` : r.name,
      sku: r.sku,
      stock: r.stock,
      threshold: r.threshold,
      inventory_policy: policyOut(r.policy),
      oversold: r.stock < 0,
    }));
    const out = items.filter((i) => i.stock <= 0).length;
    const oversold = items.filter((i) => i.oversold).length;
    const label = a.threshold != null ? `at or below ${a.threshold}` : `at or below their low-stock threshold (store default ${storeThreshold})`;
    const text = items.length
      ? lines(
          `${items.length} item(s) ${label} (${out} out of stock${oversold ? `, ${oversold} oversold` : ""}):`,
          ...items.map((i) => `- ${i.name}: ${i.stock}${i.oversold ? " (OVERSOLD: pre-orders to fulfil)" : i.stock <= 0 ? (i.inventory_policy === "continue" ? " (OUT OF STOCK, still selling as pre-order)" : " (OUT OF STOCK)") : ""}${a.threshold == null ? ` [threshold ${i.threshold}]` : ""}`),
        )
      : `No tracked item ${label}.`;
    return { text, data: { threshold: a.threshold ?? null, store_default_threshold: a.threshold == null ? storeThreshold : undefined, out_of_stock: out, oversold, items } };
  },
});

/* ───────────────────────── Écriture ───────────────────────── */

export const createProduct = defineTool({
  name: "create_product",
  title: "Create a product",
  description: "Create a simple product (without variants). Created as DRAFT by default so the merchant can review it before it appears in the store; pass status ACTIVE to publish immediately. Respects the plan's product limit.",
  scopes: ["catalog:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  input: z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().max(10_000).optional().describe("Markdown allowed (bold, lists, links)."),
    price: zAmount,
    compare_at_price: zAmount.optional().describe("Optional 'was' price shown crossed out (must be higher than price)."),
    status: z.enum(["ACTIVE", "DRAFT"]).default("DRAFT"),
    kind: z
      .enum(["physical", "digital", "service"])
      .default("physical")
      .describe("Product nature: 'physical' (shipped), 'digital' (downloadable files, no shipping and no stock) or 'service' (no shipping). Files are uploaded by the merchant in Axi. Gift cards are created from the Axi product page."),
    tags: zTags.optional(),
    collection_ids: z.array(zId).max(20).optional().describe("Manual collections to add the product to."),
    sku: z.string().trim().max(60).optional(),
    track_stock: z.boolean().default(false),
    stock: z.number().int().min(0).max(1_000_000).default(0).describe("Initial stock (only when track_stock is true)."),
    inventory_policy: zPolicy.optional(),
    low_stock_threshold: zThreshold.optional(),
    barcode: z.string().trim().max(60).optional().describe("Barcode (EAN, UPC, ISBN)."),
    images: z.array(zHttpsImage).max(10).optional(),
    product_type: z.string().trim().max(60).optional(),
    vendor: z.string().trim().max(60).optional(),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    if (a.compare_at_price != null && a.compare_at_price <= a.price) throw new ToolError("compare_at_price must be higher than price.");
    const kind = a.kind === "digital" ? "DIGITAL" : a.kind === "service" ? "SERVICE" : "PHYSICAL";
    if (kind !== "PHYSICAL") requireFeature(ctx, "digitalProducts", "Digital products and services");
    // Ni stock ni expédition pour un produit numérique.
    const trackStock = a.track_stock && kindTracksStock(kind);
    if (trackStock) requireFeature(ctx, "stockTracking", "Stock tracking");
    const maxPhotos = PLANS[ctx.planId].limits.photosPerProduct;
    if ((a.images?.length ?? 0) > maxPhotos) throw new ToolError(`The current plan allows ${maxPhotos} photo(s) per product.`);
    const quota = await checkProductsQuota(ctx.store.id, ctx.planId);
    if (!quota.allowed) throw new ToolError(`Product limit reached (${quota.used}/${quota.limit}) for the ${PLANS[ctx.planId].name} plan. The owner can upgrade at /app/${ctx.store.id}/abonnement.`, "plan_limit");

    const tags = [...new Set((a.tags ?? []).map(normalizeTag).filter(Boolean))];
    const result = await db.$transaction(async (tx) => {
      const slug = await uniqueSlug(tx, ctx.store.id, a.name);
      const count = await tx.product.count({ where: { storeId: ctx.store.id } });
      const product = await tx.product.create({
        data: {
          storeId: ctx.store.id,
          name: a.name,
          slug,
          description: a.description ? cleanMarkdown(a.description) : null,
          status: a.status,
          price: a.price,
          compareAtPrice: a.compare_at_price ?? null,
          sku: a.sku || null,
          kind,
          trackStock,
          stock: trackStock ? a.stock : 0,
          inventoryPolicy: a.inventory_policy ?? "DENY",
          lowStockThreshold: a.low_stock_threshold ?? null,
          barcode: a.barcode || null,
          tags,
          images: (a.images ?? []) as unknown as Prisma.InputJsonValue,
          productType: a.product_type || null,
          vendor: a.vendor || null,
          position: count,
        },
        select: { id: true, slug: true },
      });
      if (trackStock && a.stock > 0) {
        await tx.inventoryMovement.create({ data: { storeId: ctx.store.id, productId: product.id, delta: a.stock, reason: "ADJUSTMENT", note: `Stock initial (${ctx.actor.label})`, actorId: ctx.actor.userId } });
      }
      const cols = a.collection_ids?.length ? await setManualCollections(tx, ctx.store.id, product.id, a.collection_ids) : { applied: [], ignored: [] };
      await auditApi(ctx, "product.created", product.id, { name: a.name, status: a.status, price: a.price }, tx);
      await emitDomainEvent(tx, ctx.store.id, "product.created", { product_id: product.id, status: a.status, source: eventSource(ctx) }); // Lot 2 (W)
      return { ...product, cols };
    });
    revalidate(ctx, "produits");
    const url = productUrl(ctx, result.slug);
    return {
      text: lines(
        `Product "${a.name}" created as ${a.status} at ${fmt(ctx, a.price)} (id: ${result.id}).`,
        a.status === "DRAFT" ? "It is hidden from the store until its status is set to ACTIVE (update_product)." : `Visible at ${url}`,
        kind === "DIGITAL" ? "Digital product: upload the files from the Axi product page, then buyers receive a personal download link as soon as payment is confirmed." : null,
        kind === "SERVICE" ? "Service: no shipping. Add the duration, the location and the post-purchase instructions from the Axi product page." : null,
        result.cols.ignored.length ? `Ignored collections (not found or automatic): ${result.cols.ignored.join(", ")}` : null,
      ),
      data: { product_id: result.id, slug: result.slug, status: a.status, kind: kind.toLowerCase(), url, collections: result.cols.applied, ignored_collections: result.cols.ignored },
    };
  },
});

export const updateProduct = defineTool({
  name: "update_product",
  title: "Update a product",
  description: "Update a product's title, description, base price, crossed-out price, promotion (price and dates), status (ACTIVE publishes, DRAFT hides, ARCHIVED removes from sale), tags and manual collections. Only the fields provided are changed. Variant prices are changed with update_variant_price_stock.",
  scopes: ["catalog:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  input: z.object({
    product_id: zId,
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().max(10_000).optional(),
    price: zAmount.optional(),
    compare_at_price: zAmount.nullable().optional().describe("null removes the crossed-out price."),
    promo_price: zAmount.nullable().optional().describe("Promotional price (lower than price). null removes the promotion."),
    promo_start: zDateInput.nullable().optional(),
    promo_end: zDateInput.nullable().optional(),
    status: z.enum(STATUS).optional(),
    tags: zTags.optional().describe("Replaces all tags."),
    add_tags: zTags.optional(),
    remove_tags: zTags.optional(),
    collection_ids: z.array(zId).max(20).optional().describe("Replaces the product's manual collections."),
    sku: z.string().trim().max(60).nullable().optional(),
    featured: z.boolean().optional(),
    confirm: zConfirm.describe("Required (true) after the merchant confirmed a price change of more than 50 % (price or promotional price)."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const p = await db.product.findFirst({ where: { id: a.product_id, storeId: ctx.store.id }, select: { id: true, name: true, slug: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, compareAtPrice: true, tags: true, status: true } });
    if (!p) throw new ToolError("Product not found in this store.");
    if (a.status === "ACTIVE" && p.status === "ARCHIVED") {
      const quota = await checkProductsQuota(ctx.store.id, ctx.planId);
      if (!quota.allowed) throw new ToolError(`Product limit reached (${quota.used}/${quota.limit}): archive another product or upgrade the plan.`, "plan_limit");
    }
    const price = a.price ?? p.price;
    const promoPrice = a.promo_price === undefined ? p.promoPrice : a.promo_price;
    const compareAt = a.compare_at_price === undefined ? p.compareAtPrice : a.compare_at_price;
    if (promoPrice != null && promoPrice >= price) throw new ToolError("promo_price must be lower than price.");
    if (compareAt != null && compareAt <= price) throw new ToolError("compare_at_price must be higher than price (or null to remove it).");
    const promoStart = a.promo_start === undefined ? p.promoStart : a.promo_start === null ? null : parseDate(a.promo_start) ?? null;
    const promoEnd = a.promo_end === undefined ? p.promoEnd : a.promo_end === null ? null : parseDate(a.promo_end, true) ?? null;
    if (promoStart && promoEnd && promoEnd <= promoStart) throw new ToolError("promo_end must be after promo_start.");
    if (a.price !== undefined && bigPriceChange(p.price, a.price)) requireConfirmation(a.confirm, `price ${fmt(ctx, p.price)} → ${fmt(ctx, a.price)} changes by more than 50 %`);
    if (a.promo_price != null && promoPrice != null && promoPrice < price * 0.5) requireConfirmation(a.confirm, `promotional price ${fmt(ctx, promoPrice)} is more than 50 % below ${fmt(ctx, price)}`);

    let tags = a.tags ? a.tags.map(normalizeTag) : [...p.tags];
    if (a.add_tags) tags.push(...a.add_tags.map(normalizeTag));
    if (a.remove_tags) {
      const rm = new Set(a.remove_tags.map((t) => normalizeTag(t).toLowerCase()));
      tags = tags.filter((t) => !rm.has(t.toLowerCase()));
    }
    tags = [...new Set(tags.filter(Boolean))].slice(0, 50);

    const data: Prisma.ProductUpdateInput = {};
    const changed: string[] = [];
    if (a.name !== undefined) {
      data.name = a.name;
      changed.push("name");
    }
    if (a.description !== undefined) {
      data.description = cleanMarkdown(a.description) || null;
      changed.push("description");
    }
    if (a.price !== undefined) {
      data.price = a.price;
      changed.push("price");
    }
    if (a.compare_at_price !== undefined) {
      data.compareAtPrice = a.compare_at_price;
      changed.push("compare_at_price");
    }
    if (a.promo_price !== undefined) {
      data.promoPrice = a.promo_price;
      changed.push("promo_price");
    }
    if (a.promo_start !== undefined) {
      data.promoStart = promoStart;
      changed.push("promo_start");
    }
    if (a.promo_end !== undefined) {
      data.promoEnd = promoEnd;
      changed.push("promo_end");
    }
    if (a.status !== undefined) {
      data.status = a.status;
      changed.push("status");
    }
    if (a.tags || a.add_tags || a.remove_tags) {
      data.tags = tags;
      changed.push("tags");
    }
    if (a.sku !== undefined) {
      data.sku = a.sku || null;
      changed.push("sku");
    }
    if (a.featured !== undefined) {
      data.isFeatured = a.featured;
      changed.push("featured");
    }
    if (!changed.length && !a.collection_ids) throw new ToolError("Nothing to update: provide at least one field.");

    const cols = await db.$transaction(async (tx) => {
      if (changed.length) {
        const r = await tx.product.updateMany({ where: { id: p.id, storeId: ctx.store.id }, data: data as Prisma.ProductUpdateManyMutationInput });
        if (r.count === 0) throw new ToolError("Product not found in this store.");
      }
      const c = a.collection_ids ? await setManualCollections(tx, ctx.store.id, p.id, a.collection_ids) : null;
      await auditApi(ctx, "product.updated", p.id, { fields: [...changed, ...(c ? ["collections"] : [])], ...(a.price !== undefined ? { from: p.price, to: a.price } : {}) }, tx);
      // Lot 2 (W) : Axi ne supprime jamais un produit, l'archivage (retrait de la vente) est publié comme product.deleted.
      await emitDomainEvent(tx, ctx.store.id, a.status === "ARCHIVED" ? "product.deleted" : "product.updated", { product_id: p.id, ...(a.status ? { status: a.status } : {}), updated_fields: [...changed, ...(c ? ["collections"] : [])], source: eventSource(ctx) });
      return c;
    });
    revalidate(ctx, "produits", `produits/${p.id}`);
    return {
      text: lines(
        `Product "${a.name ?? p.name}" updated (${[...changed, ...(cols ? ["collections"] : [])].join(", ")}).`,
        a.price !== undefined ? `Price: ${fmt(ctx, p.price)} → ${fmt(ctx, a.price)}` : null,
        cols?.ignored.length ? `Ignored collections (not found or automatic): ${cols.ignored.join(", ")}` : null,
      ),
      data: { product_id: p.id, updated_fields: changed, collections: cols?.applied, ignored_collections: cols?.ignored },
    };
  },
});

/**
 * Politique de rupture (variante, ou produit sans variante) et seuil « stock bas » (toujours au niveau produit).
 * `undefined` = inchangé ; seuil `null` = retour au seuil par défaut de la boutique.
 */
async function applyInventorySettings(tx: Tx, ctx: Ctx, productId: string, variantId: string | null, policy: "DENY" | "CONTINUE" | undefined, threshold: number | null | undefined) {
  if (policy !== undefined) {
    const r = variantId
      ? await tx.variant.updateMany({ where: { id: variantId, productId, product: { storeId: ctx.store.id } }, data: { inventoryPolicy: policy } })
      : await tx.product.updateMany({ where: { id: productId, storeId: ctx.store.id }, data: { inventoryPolicy: policy } });
    if (r.count === 0) throw new ToolError("Item not found in this store.");
  }
  if (threshold !== undefined) {
    const cur = await tx.product.findFirst({ where: { id: productId, storeId: ctx.store.id }, select: { lowStockThreshold: true } });
    if (!cur) throw new ToolError("Product not found in this store.");
    // Horodaté seulement s'il change : pas d'alerte pour des franchissements antérieurs au nouveau seuil.
    if (cur.lowStockThreshold !== threshold) await tx.product.updateMany({ where: { id: productId, storeId: ctx.store.id }, data: { lowStockThreshold: threshold, lowStockThresholdChangedAt: new Date() } });
  }
}

/** Fixe un niveau de stock absolu (verrou de ligne, delta journalisé) — jamais négatif. */
async function setStockAbsolute(tx: Tx, ctx: Ctx, productId: string, variantId: string | null, quantity: number, note: string): Promise<{ from: number; to: number }> {
  const rows = variantId
    ? await tx.$queryRaw<{ stock: number }[]>`SELECT v.stock FROM "Variant" v JOIN "Product" p ON p.id = v."productId" WHERE v.id = ${variantId} AND p.id = ${productId} AND p."storeId" = ${ctx.store.id} FOR UPDATE OF v`
    : await tx.$queryRaw<{ stock: number }[]>`SELECT stock FROM "Product" WHERE id = ${productId} AND "storeId" = ${ctx.store.id} FOR UPDATE`;
  if (!rows[0]) throw new ToolError("Item not found in this store.");
  const from = Number(rows[0].stock);
  const delta = quantity - from;
  if (delta !== 0) {
    if (variantId) await tx.variant.update({ where: { id: variantId }, data: { stock: quantity } });
    else await tx.product.update({ where: { id: productId }, data: { stock: quantity } });
    await tx.inventoryMovement.create({ data: { storeId: ctx.store.id, productId, variantId, delta, reason: "ADJUSTMENT", note, actorId: ctx.actor.userId } });
  }
  return { from, to: quantity };
}

export const updateVariantPriceStock = defineTool({
  name: "update_variant_price_stock",
  title: "Update variant price or stock",
  description: "Set the price, crossed-out price, absolute stock level and/or out-of-stock policy (deny / continue selling) of a variant (or of a product without variants), and the product's low-stock threshold. Price changes need catalog:write; stock, policy and threshold changes need inventory:write. Stock changes are recorded in the inventory history.",
  scopes: ["catalog:write", "inventory:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  input: z.object({
    product_id: zId,
    variant_id: zId.optional().describe("Required when the product has variants (see get_product)."),
    price: zAmount.nullable().optional().describe("Variant price; null makes the variant use the product price."),
    compare_at_price: zAmount.nullable().optional(),
    stock: z.number().int().min(0).max(1_000_000).optional().describe("New absolute stock level."),
    inventory_policy: zPolicy.optional(),
    low_stock_threshold: zThreshold.optional(),
    note: z.string().trim().max(200).optional().describe("Reason shown in the inventory history."),
    confirm: zConfirm.describe("Required (true) after the merchant confirmed a price change of more than 50 %."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const wantsPrice = a.price !== undefined || a.compare_at_price !== undefined;
    const wantsInventory = a.stock !== undefined || a.inventory_policy !== undefined || a.low_stock_threshold !== undefined;
    if (!wantsPrice && !wantsInventory) throw new ToolError("Provide price, compare_at_price, stock, inventory_policy or low_stock_threshold.");
    if (wantsPrice && !hasScope(ctx, "catalog:write")) throw new ToolError("Changing prices requires the catalog:write scope.", "insufficient_scope");
    if (wantsInventory && !hasScope(ctx, "inventory:write")) throw new ToolError("Changing stock, out-of-stock policy or threshold requires the inventory:write scope.", "insufficient_scope");
    const p = await db.product.findFirst({ where: { id: a.product_id, storeId: ctx.store.id }, select: { id: true, name: true, price: true, trackStock: true, variants: { select: { id: true, name: true, price: true } } } });
    if (!p) throw new ToolError("Product not found in this store.");
    // Le seuil est au niveau produit : variant_id n'est exigé que pour le prix, le stock ou la politique de rupture.
    const perItem = wantsPrice || a.stock !== undefined || a.inventory_policy !== undefined;
    if (p.variants.length > 0 && !a.variant_id && perItem) throw new ToolError(`This product has ${p.variants.length} variants: provide variant_id (see get_product).`);
    const variant = a.variant_id ? p.variants.find((v) => v.id === a.variant_id) : null;
    if (a.variant_id && !variant) throw new ToolError("Variant not found for this product.");
    if (wantsInventory) {
      requireFeature(ctx, "stockTracking", "Stock tracking");
      if (a.stock !== undefined && !p.trackStock) throw new ToolError("Stock tracking is disabled for this product: the merchant must enable it in the product page first.");
    }
    if (!variant && a.price === null) throw new ToolError("A product without variants needs a price (use update_product).");
    const label = variant ? `${p.name} (${variant.name})` : p.name;
    if (a.price !== undefined) {
      const before = variant ? (variant.price ?? p.price) : p.price;
      const after = a.price ?? p.price;
      if (bigPriceChange(before, after)) requireConfirmation(a.confirm, `price of ${label} ${fmt(ctx, before)} → ${fmt(ctx, after)} changes by more than 50 %`);
    }

    const out = await db.$transaction(async (tx) => {
      let stock: { from: number; to: number } | null = null;
      if (wantsPrice) {
        if (variant) {
          const nextPrice = a.price === undefined ? variant.price : a.price;
          if (a.compare_at_price != null && a.compare_at_price <= (nextPrice ?? p.price)) throw new ToolError("compare_at_price must be higher than the price.");
          await tx.variant.update({ where: { id: variant.id }, data: { ...(a.price !== undefined ? { price: a.price } : {}), ...(a.compare_at_price !== undefined ? { compareAtPrice: a.compare_at_price } : {}) } });
        } else {
          const nextPrice = a.price ?? p.price;
          if (a.compare_at_price != null && a.compare_at_price <= nextPrice) throw new ToolError("compare_at_price must be higher than the price.");
          await tx.product.updateMany({ where: { id: p.id, storeId: ctx.store.id }, data: { ...(a.price != null ? { price: a.price } : {}), ...(a.compare_at_price !== undefined ? { compareAtPrice: a.compare_at_price } : {}) } });
        }
      }
      if (a.stock !== undefined) stock = await setStockAbsolute(tx, ctx, p.id, variant?.id ?? null, a.stock, a.note || `Ajustement (${ctx.actor.label})`);
      await applyInventorySettings(tx, ctx, p.id, variant?.id ?? null, a.inventory_policy, a.low_stock_threshold);
      await auditApi(ctx, wantsPrice ? "variant.price_updated" : "inventory.adjusted", variant?.id ?? p.id, { productId: p.id, price: a.price, compareAtPrice: a.compare_at_price, stock, inventoryPolicy: a.inventory_policy, lowStockThreshold: a.low_stock_threshold }, tx);
      // Lot 2 (W) : prix → product.updated ; quantité modifiée → inventory.updated.
      if (wantsPrice) await emitDomainEvent(tx, ctx.store.id, "product.updated", { product_id: p.id, variant_id: variant?.id ?? null, updated_fields: ["price"], source: eventSource(ctx) });
      if (stock && stock.to !== stock.from) await emitDomainEvent(tx, ctx.store.id, "inventory.updated", { product_id: p.id, variant_id: variant?.id ?? null, delta: stock.to - stock.from, stock: stock.to, source: eventSource(ctx) });
      return stock;
    });
    revalidate(ctx, "produits", `produits/${p.id}`, "produits/stock");
    return {
      text: lines(
        `${label} updated.`,
        a.price != null ? `Price: ${fmt(ctx, a.price)}` : a.price === null ? "Price: now uses the product price" : null,
        out ? `Stock: ${out.from} → ${out.to}` : null,
        a.inventory_policy ? `Out-of-stock policy: ${a.inventory_policy === "CONTINUE" ? "continue selling (pre-order)" : "stop selling at zero"}` : null,
        a.low_stock_threshold !== undefined ? `Low-stock threshold: ${a.low_stock_threshold ?? "store default"}` : null,
      ),
      data: { product_id: p.id, variant_id: variant?.id ?? null, price: a.price === undefined ? undefined : money(ctx, a.price), stock: out, inventory_policy: a.inventory_policy ? policyOut(a.inventory_policy) : undefined, low_stock_threshold: a.low_stock_threshold },
    };
  },
});

export const addProductsToCollection = defineTool({
  name: "add_products_to_collection",
  title: "Add products to a collection",
  description: "Add products to a MANUAL collection (products already in it are kept). Automatic collections are driven by rules and cannot be edited this way.",
  scopes: ["catalog:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  input: z.object({
    collection_id: zId,
    product_ids: z.array(zId).min(1).max(100),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    const res = await db.$transaction(async (tx) => {
      await lockStoreCategories(tx, ctx.store.id);
      const col = await tx.category.findFirst({ where: { id: a.collection_id, storeId: ctx.store.id }, select: { id: true, name: true, rules: true } });
      if (!col) throw new ToolError("Collection not found in this store.");
      const rules = readRules(col.rules);
      if (rules.type !== "manual") throw new ToolError(`"${col.name}" is an automatic collection (${describeRules(rules)}): change its rules in the merchant dashboard instead.`);
      const valid = new Set((await tx.product.findMany({ where: { storeId: ctx.store.id, id: { in: a.product_ids } }, select: { id: true } })).map((p) => p.id));
      const toAdd = [...new Set(a.product_ids)].filter((id) => valid.has(id) && !rules.productIds.includes(id));
      if (toAdd.length) await tx.category.update({ where: { id: col.id }, data: { rules: { type: "manual", productIds: [...rules.productIds, ...toAdd] } } });
      await auditApi(ctx, "collection.products_added", col.id, { added: toAdd.length }, tx);
      return { name: col.name, added: toAdd, unknown: a.product_ids.filter((id) => !valid.has(id)), total: rules.productIds.length + toAdd.length };
    });
    revalidate(ctx, "collections", `collections/${a.collection_id}`, "produits");
    return {
      text: lines(`${res.added.length} product(s) added to "${res.name}" (now ${res.total}).`, res.unknown.length ? `Unknown product ids ignored: ${res.unknown.join(", ")}` : null),
      data: { collection_id: a.collection_id, added: res.added, unknown_product_ids: res.unknown, products_count: res.total },
    };
  },
});

export const adjustInventory = defineTool({
  name: "adjust_inventory",
  title: "Adjust inventory",
  description: "Add or remove stock (positive delta = restock, negative = loss, breakage, own use…). A removal never takes the stock below zero, even with concurrent sales; a restock always applies (including after an oversell). Optionally set the out-of-stock policy and the product's low-stock threshold in the same call. Each adjustment is recorded with its reason.",
  scopes: ["inventory:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  input: z.object({
    product_id: zId,
    variant_id: zId.optional().describe("Required when the product has variants."),
    delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "delta must not be 0"),
    reason: z.string().trim().min(2).max(200).describe("Why the stock changes (e.g. 'Réassort fournisseur', 'Casse')."),
    inventory_policy: zPolicy.optional(),
    low_stock_threshold: zThreshold.optional(),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireFeature(ctx, "stockTracking", "Stock tracking");
    const p = await db.product.findFirst({ where: { id: a.product_id, storeId: ctx.store.id }, select: { id: true, name: true, trackStock: true, variants: { select: { id: true, name: true } } } });
    if (!p) throw new ToolError("Product not found in this store.");
    if (!p.trackStock) throw new ToolError("Stock tracking is disabled for this product: the merchant must enable it first.");
    if (p.variants.length > 0 && !a.variant_id) throw new ToolError("This product has variants: provide variant_id.");
    const variant = a.variant_id ? p.variants.find((v) => v.id === a.variant_id) : null;
    if (a.variant_id && !variant) throw new ToolError("Variant not found for this product.");
    const stock = await db.$transaction(async (tx) => {
      // Retrait conditionnel : jamais de stock négatif, même en concurrence avec le checkout ; un réassort s'applique toujours.
      const guardStock = a.delta < 0 ? { stock: { gte: -a.delta } } : {};
      const r = variant
        ? await tx.variant.updateMany({ where: { id: variant.id, productId: p.id, ...guardStock }, data: { stock: { increment: a.delta } } })
        : await tx.product.updateMany({ where: { id: p.id, storeId: ctx.store.id, ...guardStock }, data: { stock: { increment: a.delta } } });
      if (r.count === 0) throw new ToolError("Not enough stock: the stock cannot become negative.");
      const next = variant ? (await tx.variant.findUniqueOrThrow({ where: { id: variant.id }, select: { stock: true } })).stock : (await tx.product.findUniqueOrThrow({ where: { id: p.id }, select: { stock: true } })).stock;
      await tx.inventoryMovement.create({ data: { storeId: ctx.store.id, productId: p.id, variantId: variant?.id ?? null, delta: a.delta, reason: "ADJUSTMENT", note: `${a.reason} (${ctx.actor.label})`.slice(0, 250), actorId: ctx.actor.userId } });
      await applyInventorySettings(tx, ctx, p.id, variant?.id ?? null, a.inventory_policy, a.low_stock_threshold);
      await auditApi(ctx, "inventory.adjusted", variant?.id ?? p.id, { productId: p.id, delta: a.delta, reason: a.reason, inventoryPolicy: a.inventory_policy, lowStockThreshold: a.low_stock_threshold }, tx);
      await emitDomainEvent(tx, ctx.store.id, "inventory.updated", { product_id: p.id, variant_id: variant?.id ?? null, delta: a.delta, stock: next, source: eventSource(ctx) }); // Lot 2 (W)
      return next;
    });
    revalidate(ctx, "produits", `produits/${p.id}`, "produits/stock");
    const label = variant ? `${p.name} (${variant.name})` : p.name;
    return {
      text: lines(
        `${label}: ${a.delta > 0 ? "+" : ""}${a.delta}, new stock ${stock}.`,
        a.inventory_policy ? `Out-of-stock policy: ${a.inventory_policy === "CONTINUE" ? "continue selling (pre-order)" : "stop selling at zero"}` : null,
        a.low_stock_threshold !== undefined ? `Low-stock threshold: ${a.low_stock_threshold ?? "store default"}` : null,
      ),
      data: { product_id: p.id, variant_id: variant?.id ?? null, delta: a.delta, stock, inventory_policy: a.inventory_policy ? policyOut(a.inventory_policy) : undefined, low_stock_threshold: a.low_stock_threshold },
    };
  },
});

/** Lot 2 (W) : origine des événements webhook des écritures catalogue (outil MCP, ou API REST via `runTool`). */
function eventSource(ctx: Ctx): "api" | "mcp" {
  return (ctx as { via?: string }).via === "api" ? "api" : "mcp";
}

export const CATALOG_TOOLS: McpTool<Ctx>[] = [searchProducts, getProduct, createProduct, updateProduct, updateVariantPriceStock, listCollections, addProductsToCollection, adjustInventory, listLowStock];
