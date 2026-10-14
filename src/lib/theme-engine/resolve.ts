import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import { effectivePrice } from "@/lib/commerce/pricing";
import { getStorePages, isOpenNow, loyaltyInfo, productImages } from "@/lib/storefront/data";
import { storefrontPreset } from "@/lib/storefront/theme";
import { sanitizeThemeDocument, S } from "@/lib/storefront/theme-doc";
import { normalizeOptions, variantAttributes, isPurchasable, pickOrderVariant, requestedVariantParam } from "@/lib/storefront/variants";
import { effectiveLowStockThreshold, isBackorder, isSellable } from "@/lib/inventory/policy";
import { storeLowStockThreshold } from "@/lib/inventory/service";
import { applyFilters, matchesQuery, collectionSortKey, computeFacets, manualMemberIds, matchesRules, paginate, parseCatalogParams, parseRules, sortProducts, SORTS, type CatalogParams } from "@/lib/storefront/catalog";
import { isNewProduct, type CardProduct, type CollectionData, type ListingData, type MenuLink, type ProductPageData, type RenderData, type ReviewBlock, type ReviewItem, type StoreInfo } from "@/lib/storefront/render-types";
import { requestCurrencyView } from "@/lib/storefront/currency-context";
import { hoursRows, todayIndex } from "@/components/storefront/format";
import { migrateLegacyTheme } from "./defaults";
import type { TemplateId, ThemeDocument } from "./types";

/**
 * Résolution du thème et des données de rendu de la boutique publique.
 *  - `getThemeDocument` : brouillon en aperçu (membres seulement, vérifié par l'appelant), sinon document publié,
 *    sinon migration de l'ancien thème ; toujours revalidé défensivement.
 *  - `loadRenderData` : données sérialisables (produits, collections, menus, avis…) pour le modèle demandé.
 */

type StoreRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/storefront/data").getPublicStore>>>;

const PRODUCT_CAP = 500;
const SORT_KEYS = SORTS.map((s) => s.value);

export function getThemeDocument(store: Pick<StoreRow, "sector" | "themeId" | "themeConfig" | "bannerUrl" | "logoUrl" | "name" | "tagline" | "description" | "whatsappNumber" | "themeDoc" | "themeDocDraft">, opts: { preview?: boolean } = {}): ThemeDocument {
  const fallback = migrateLegacyTheme(store);
  const raw = opts.preview && store.themeDocDraft ? store.themeDocDraft : store.themeDoc;
  return raw ? sanitizeThemeDocument(raw, fallback) : fallback;
}

/* ───────────────────────── Produits ───────────────────────── */

const productInclude = {
  variants: { orderBy: { position: "asc" as const } },
  _count: { select: { optionGroups: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const loadProducts = cache(async (storeId: string) =>
  db.product.findMany({ where: { storeId, status: "ACTIVE" }, include: productInclude, orderBy: [{ isFeatured: "desc" }, { position: "asc" }, { createdAt: "desc" }], take: PRODUCT_CAP }),
);

const loadRatings = cache(async (storeId: string) => {
  const rows = await db.review.groupBy({ by: ["productId"], where: { storeId, status: "APPROVED", productId: { not: null } }, _avg: { rating: true }, _count: { _all: true } });
  return new Map(rows.filter((r) => r.productId).map((r) => [r.productId as string, { average: r._avg.rating ?? 0, count: r._count._all }]));
});

const loadSales = cache(async (storeId: string) => {
  const rows = await db.orderItem.groupBy({ by: ["productId"], where: { order: { storeId, status: { not: "CANCELLED" } } }, _sum: { quantity: true } });
  return new Map(rows.filter((r) => r.productId).map((r) => [r.productId as string, r._sum.quantity ?? 0]));
});

export function toCardProduct(p: ProductRow, now: Date, rating?: { average: number; count: number }, sales = 0): CardProduct {
  const ep = effectivePrice(p, now);
  // Achetable : en stock, ou vendable en rupture (politique CONTINUE = précommande, jamais affichée « épuisée »).
  const variants = p.variants.map((v) => ({ attributes: variantAttributes(v.attributes), purchasable: isPurchasable({ id: v.id, attributes: {}, stock: v.stock, inStock: isSellable({ trackStock: p.trackStock, stock: v.stock, policy: v.inventoryPolicy }), available: v.available }, p.trackStock), backorder: v.available && isBackorder({ trackStock: p.trackStock, stock: v.stock, policy: v.inventoryPolicy }), price: v.price ?? ep.price, compareAt: v.compareAtPrice }));
  const prices = variants.map((v) => v.price);
  const price = prices.length ? Math.min(...prices) : ep.price;
  const range = prices.length > 0 && new Set(prices).size > 1;
  const cheapest = variants.find((v) => v.price === price);
  const compare = ep.isPromo ? p.price : cheapest?.compareAt && cheapest.compareAt > price ? cheapest.compareAt : p.compareAtPrice && p.compareAtPrice > price ? p.compareAtPrice : null;
  const compareAt = compare && compare > price ? compare : null;
  // Même sémantique que l'admin (`isOnSale`, src/lib/collections/rules.ts).
  const onSale = ep.isPromo || (p.compareAtPrice != null && p.compareAtPrice > ep.price) || variants.some((v) => v.compareAt != null && v.compareAt > v.price);
  const soldOut = p.variants.length ? variants.every((v) => !v.purchasable) : !isSellable({ trackStock: p.trackStock, stock: p.stock, policy: p.inventoryPolicy });
  // Précommande : achetable, mais uniquement au-delà du stock (aucune variante achetable n'a de stock disponible).
  const preorder = !soldOut && (p.variants.length ? variants.filter((v) => v.purchasable).every((v) => v.backorder) : isBackorder({ trackStock: p.trackStock, stock: p.stock, policy: p.inventoryPolicy }));
  const images = productImages(p.images).slice(0, 2).map((i) => ({ url: i.url, alt: i.alt || p.name }));
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    vendor: p.vendor,
    description: p.description ? p.description.slice(0, 220) : null,
    price,
    compareAt,
    onSale,
    range,
    discountPct: compareAt ? Math.round(((compareAt - price) / compareAt) * 100) : 0,
    soldOut,
    preorder,
    images,
    simple: p.variants.length === 0 && p._count.optionGroups === 0,
    unitPrice: ep.price,
    minQty: Math.max(1, p.minQty),
    variantCount: p.variants.length,
    categoryId: p.categoryId,
    tags: p.tags,
    productType: p.productType,
    options: normalizeOptions(p.options, variants),
    isFeatured: p.isFeatured,
    position: p.position,
    createdAt: p.createdAt.toISOString(),
    isNew: isNewProduct(p.createdAt.toISOString(), now),
    sales,
    rating: rating && rating.count > 0 ? { average: Math.round(rating.average * 10) / 10, count: rating.count } : null,
    variants: variants.map((v) => ({ attributes: v.attributes, purchasable: v.purchasable })),
  };
}

/* ───────────────────────── Menus ───────────────────────── */

type RawMenuItem = { label?: unknown; type?: unknown; target?: unknown; url?: unknown; children?: unknown };

function resolveMenu(items: unknown, ctx: { base: string; collections: CollectionData[]; products: CardProduct[]; pages: { slug: string; title: string }[] }, depth = 0): MenuLink[] {
  if (!Array.isArray(items) || depth > 2) return [];
  const out: MenuLink[] = [];
  for (const it of items.slice(0, 20) as RawMenuItem[]) {
    if (!it || typeof it !== "object") continue;
    const label = typeof it.label === "string" ? it.label.trim().slice(0, 60) : "";
    const target = typeof it.target === "string" ? it.target : typeof it.url === "string" ? it.url : "";
    let href: string | null = null;
    switch (it.type) {
      case "home":
        href = ctx.base;
        break;
      case "catalog":
        href = `${ctx.base}/catalogue`;
        break;
      case "collection": {
        const c = ctx.collections.find((x) => x.id === target || x.handle === target);
        href = c ? `${ctx.base}/collections/${c.handle}` : null;
        break;
      }
      case "product": {
        const p = ctx.products.find((x) => x.id === target || x.slug === target);
        href = p ? `${ctx.base}/p/${p.slug}` : null;
        break;
      }
      case "page": {
        const pg = ctx.pages.find((x) => x.slug === target);
        href = pg ? `${ctx.base}/pages/${pg.slug}` : null;
        break;
      }
      case "search":
        href = `${ctx.base}/recherche`;
        break;
      default:
        href = internalHref(ctx.base, target);
    }
    if (!label || !href) continue;
    out.push({ label, href, children: resolveMenu(it.children, ctx, depth + 1) });
  }
  return out;
}

/** Lien de réglage → URL de la boutique (« /catalogue » devient « /s/slug/catalogue » ; https inchangé). */
export function internalHref(base: string, link: string | null | undefined): string | null {
  if (!link) return null;
  if (/^https:\/\//i.test(link) || /^(tel|mailto):/i.test(link) || link.startsWith("#")) return link;
  if (!link.startsWith("/") || link.startsWith("//")) return null;
  if (link === "/") return base;
  if (link.startsWith("/s/")) return link;
  return `${base}${link}`;
}

/* ───────────────────────── Avis ───────────────────────── */

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "Client";
  return `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase()}.`;
}

export async function loadReviews(storeId: string, opts: { productId?: string | null; rating?: number | null; page?: number; perPage: number }): Promise<ReviewBlock> {
  const base = { storeId, status: "APPROVED" as const, ...(opts.productId ? { productId: opts.productId } : {}) };
  const where = { ...base, ...(opts.rating ? { rating: opts.rating } : {}) };
  const [groups, total] = await Promise.all([db.review.groupBy({ by: ["rating"], where: base, _count: { _all: true } }), db.review.count({ where })]);
  const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const g of groups) {
    const r = Math.max(1, Math.min(5, Math.round(g.rating)));
    histogram[5 - r] += g._count._all;
    sum += r * g._count._all;
    count += g._count._all;
  }
  const pages = Math.max(1, Math.ceil(total / opts.perPage));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const rows = total
    ? await db.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * opts.perPage,
        take: opts.perPage,
        select: { id: true, customerName: true, rating: true, body: true, reply: true, createdAt: true, orderId: true, product: { select: { name: true, slug: true, images: true, status: true } } },
      })
    : [];
  const items: ReviewItem[] = rows.map((r) => ({
    id: r.id,
    name: shortName(r.customerName),
    rating: Math.max(1, Math.min(5, Math.round(r.rating))),
    body: r.body,
    reply: r.reply,
    createdAt: r.createdAt.toISOString(),
    verified: !!r.orderId,
    product: r.product && r.product.status === "ACTIVE" ? { name: r.product.name, slug: r.product.slug, image: productImages(r.product.images)[0]?.url ?? null } : null,
  }));
  return { summary: { average: count ? Math.round((sum / count) * 10) / 10 : 0, count, histogram }, items, page, pages, rating: opts.rating ?? null, productScoped: !!opts.productId };
}

/** Tri par défaut du modèle « Recherche » (réglage `default_sort`) ; valeur inconnue = pertinence. */
function searchSortKey(v: string): CatalogParams["sort"] {
  return (SORT_KEYS as readonly string[]).includes(v) ? (v as NonNullable<CatalogParams["sort"]>) : null;
}

/* ───────────────────────── Données de rendu ───────────────────────── */

export type RenderRequest = {
  template: TemplateId | null;
  searchParams?: Record<string, string | string[] | undefined>;
  productSlug?: string;
  collectionHandle?: string;
  pageSlug?: string;
  /** Aperçu de l'éditeur : données d'exemple si l'élément demandé n'existe pas. */
  sample?: boolean;
};

export async function loadRenderData(store: StoreRow, doc: ThemeDocument, req: RenderRequest, opts: { unpublished?: boolean } = {}): Promise<RenderData | null> {
  const now = new Date();
  const preset = storefrontPreset(store.sector, store.themeId);
  const base = `/s/${store.slug}`;
  const sp = req.searchParams ?? {};
  const listingTemplate = req.template === "collection" || req.template === "catalog" || req.template === "search";

  const [rows, ratings, sales, pages, menuRows] = await Promise.all([
    req.template ? loadProducts(store.id) : Promise.resolve([] as ProductRow[]),
    req.template ? loadRatings(store.id) : Promise.resolve(new Map<string, { average: number; count: number }>()),
    listingTemplate || store.categories.some((c) => c.sortOrder === "best_selling") ? loadSales(store.id) : Promise.resolve(new Map<string, number>()),
    getStorePages(store.id),
    db.storeMenu.findMany({ where: { storeId: store.id }, select: { handle: true, items: true } }),
  ]);

  const cards = rows.map((p) => toCardProduct(p, now, ratings.get(p.id), sales.get(p.id) ?? 0));
  const products = Object.fromEntries(cards.map((c) => [c.id, c]));

  const collections: CollectionData[] = store.categories
    .filter((c) => c.published)
    .map((c) => {
      const rules = parseRules(c.rules);
      const members = rules ? cards.filter((p) => matchesRules(p, rules)) : manualMemberIds(c.rules, c.id, cards).map((id) => products[id]);
      return {
        id: c.id,
        handle: c.slug,
        name: c.name,
        description: c.description,
        image: c.imageUrl ? { url: c.imageUrl, alt: c.name } : members.find((m) => m.images[0])?.images[0] ?? null,
        seoTitle: c.seoTitle,
        seoDescription: c.seoDescription,
        sortOrder: c.sortOrder,
        // Collection manuelle triée « manuel » : l'ordre choisi par le commerçant est conservé.
        productIds: (!rules && (c.sortOrder ?? "manual") === "manual" ? members : sortProducts(members, collectionSortKey(c.sortOrder))).map((p) => p.id),
      };
    });

  // Menus : ceux du commerçant, sinon menus par défaut (accueil, catalogue, collections, pages).
  const mctx = { base, collections, products: cards, pages };
  const menus: Record<string, MenuLink[]> = {};
  for (const m of menuRows) menus[m.handle] = resolveMenu(m.items, mctx);
  if (!menus.main?.length) {
    menus.main = [
      { label: "Accueil", href: base, children: [] },
      { label: preset.copy.catalogTitle, href: `${base}/catalogue`, children: collections.slice(0, 8).map((c) => ({ label: c.name, href: `${base}/collections/${c.handle}`, children: [] })) },
      ...collections.slice(0, 3).map((c) => ({ label: c.name, href: `${base}/collections/${c.handle}`, children: [] })),
    ];
  }
  if (!menus.footer?.length) {
    menus.footer = [{ label: preset.copy.catalogTitle, href: `${base}/catalogue`, children: [] }, ...pages.map((p) => ({ label: p.title, href: `${base}/pages/${p.slug}`, children: [] }))];
  }

  const zones = store.deliveryZones.map((z) => ({ name: z.name, fee: z.fee, freeAbove: z.freeAbove, etaLabel: z.etaLabel }));
  const freeAbove = zones.map((z) => z.freeAbove).filter((x): x is number => typeof x === "number" && x > 0);
  const info: StoreInfo = {
    id: store.id,
    slug: store.slug,
    name: store.name,
    tagline: store.tagline,
    description: store.description,
    logoUrl: store.logoUrl,
    bannerUrl: store.bannerUrl,
    city: store.city,
    address: store.address,
    phone: store.contactPhone ?? store.whatsappNumber,
    email: store.contactEmail,
    whatsappNumber: store.whatsappNumber,
    whatsappOrdering: store.whatsappOrdering && !!store.whatsappNumber,
    currency: store.currency,
    closed: store.status === "CLOSED_TEMPORARILY",
    unpublished: !!opts.unpublished,
    booking: preset.booking,
    sector: preset.sector,
    copy: preset.copy,
    openNow: isOpenNow(store.openingHours, store.timezone, now),
    hours: hoursRows(store.openingHours),
    todayIndex: todayIndex(store.timezone, now),
    deliveryEnabled: store.deliveryEnabled && zones.length > 0,
    pickupEnabled: store.pickupEnabled,
    deliveryZones: zones,
    freeShippingFrom: freeAbove.length ? Math.min(...freeAbove) : null,
    paymentLabels: [...new Set(store.paymentMethods.map((m) => m.label))].slice(0, 6),
    showPoweredBy: store.showPoweredBy,
    loyalty: loyaltyInfo(store.loyaltyConfig),
    metaPixelId: store.metaPixelId,
    gaMeasurementId: store.gaMeasurementId,
  };

  const data: RenderData = {
    store: info,
    now: now.toISOString(),
    collections,
    products,
    allProductIds: cards.map((c) => c.id),
    menus,
    reviews: { summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }, items: [], page: 1, pages: 1, rating: null, productScoped: false },
    pages,
    // Lot 2 (devises) : devise d'affichage de l'acheteur, chargée une fois par requête (cookie `axi_cur`).
    // Les montants de `RenderData` restent en devise boutique ; seule la présentation convertit.
    currency: await requestCurrencyView(store),
  };

  const tpl = req.template ? doc.templates[req.template] : null;
  const reviewSection = tpl ? tpl.order.map((id) => tpl.sections[id]).find((s) => s && s.type === "reviews" && !s.disabled) : undefined;
  const reviewLimit = reviewSection ? Math.max(3, Math.min(24, S.num(reviewSection.settings, "limit", 6))) : 8;

  /* Fiche produit */
  if (req.template === "product") {
    let product = req.productSlug ? await db.product.findFirst({ where: { storeId: store.id, slug: req.productSlug, status: "ACTIVE" }, include: { variants: { orderBy: { position: "asc" } }, optionGroups: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } }, category: true } }) : null;
    if (!product && req.sample && rows[0]) product = await db.product.findFirst({ where: { id: rows[0].id }, include: { variants: { orderBy: { position: "asc" } }, optionGroups: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } }, category: true } });
    if (!product) return null;
    const ep = effectivePrice(product, now);
    // Données exposées selon le thème : stock exact seulement si affiché, référence seulement si affichée.
    const mainSection = tpl ? tpl.order.map((id) => tpl.sections[id]).find((s) => s && s.type === "main-product" && !s.disabled) : undefined;
    const showStock = doc.settings.product.showStock;
    const showSku = doc.settings.product.showSku || !!mainSection?.blocks.some((b) => b.type === "sku" && !b.disabled);
    // Stock : quantité exacte seulement si affichée (jamais négative : une survente n'est pas exposée) ; « stock bas » selon
    // le seuil du produit, sinon de la boutique ; CONTINUE à zéro = précommande (achetable, non barrée).
    const lowThreshold = effectiveLowStockThreshold(product.lowStockThreshold, product.trackStock ? await storeLowStockThreshold(store.id) : null);
    const stockView = (stock: number, policy: string) => {
      const item = { trackStock: product!.trackStock, stock, policy };
      return { stock: showStock ? Math.max(0, stock) : null, inStock: isSellable(item), backorder: isBackorder(item), continueSelling: product!.trackStock && policy === "CONTINUE", lowStock: product!.trackStock && stock > 0 && stock <= lowThreshold };
    };
    const variants = product.variants.map((v) => ({ id: v.id, name: v.name, attributes: variantAttributes(v.attributes), price: v.price, compareAtPrice: v.compareAtPrice, sku: showSku ? v.sku : null, ...stockView(v.stock, v.inventoryPolicy), available: v.available, imageUrl: isDisplayableImageUrl(v.imageUrl) ? v.imageUrl : null }));
    const compare = ep.isPromo ? product.price : product.compareAtPrice && product.compareAtPrice > ep.price ? product.compareAtPrice : null;
    const coll = collections.find((c) => c.productIds.includes(product!.id)) ?? null;
    const requested = requestedVariantParam(sp);
    const page: ProductPageData = {
      id: product.id,
      slug: product.slug,
      name: product.name,
      vendor: product.vendor,
      productType: product.productType,
      description: product.description,
      images: productImages(product.images).map((i) => ({ url: i.url, alt: i.alt || product!.name })),
      basePrice: ep.price,
      compareAt: compare,
      sku: showSku ? product.sku : null,
      trackStock: product.trackStock,
      ...stockView(product.stock, product.inventoryPolicy),
      minQty: Math.max(1, product.minQty),
      maxQty: product.maxQty,
      options: normalizeOptions(product.options, variants),
      variants,
      optionGroups: product.optionGroups.map((g) => ({ id: g.id, name: g.name, required: g.required, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta })) })),
      details: parseDetails(product.details),
      tags: product.tags,
      collection: coll ? { name: coll.name, handle: coll.handle } : product.category ? { name: product.category.name, handle: product.category.slug } : null,
      rating: products[product.id]?.rating ?? null,
      requestedVariantId: requested && variants.some((v) => v.id === requested) ? requested : null,
      url: `${base}/p/${product.slug}`,
      isGiftCard: product.isGiftCard,
      productKind: product.kind,
    };
    data.product = page;
    // Avis du produit : filtre par note et pagination (?note=5&avis=2).
    const note = Number(Array.isArray(sp.note) ? sp.note[0] : sp.note);
    const avis = Number(Array.isArray(sp.avis) ? sp.avis[0] : sp.avis);
    data.reviews = await loadReviews(store.id, { productId: product.id, rating: note >= 1 && note <= 5 ? Math.round(note) : null, page: Number.isFinite(avis) ? avis : 1, perPage: reviewLimit });
  } else if (req.template) {
    data.reviews = await loadReviews(store.id, { perPage: reviewLimit });
  }

  /* Listes : collection, catalogue, recherche */
  if (listingTemplate && tpl) {
    // Réglages de la section principale réellement rendue (`main-search` sur la recherche, sinon `main-collection`).
    const mainType = req.template === "search" ? "main-search" : "main-collection";
    const main = tpl.order.map((id) => tpl.sections[id]).find((s) => s?.type === mainType);
    const perPage = main ? Math.max(8, Math.min(60, S.num(main.settings, "per_page", 24))) : 24;
    const params: CatalogParams = parseCatalogParams(sp);
    let pool = cards;
    let listing: Omit<ListingData, "productIds" | "total" | "page" | "pages" | "facets" | "params" | "perPage">;
    if (req.template === "collection") {
      const c = collections.find((x) => x.handle === req.collectionHandle) ?? (req.sample ? collections[0] : undefined);
      if (!c) return null;
      pool = c.productIds.map((id) => products[id]).filter(Boolean);
      listing = { kind: "collection", title: c.name, description: c.description, image: c.image, collectionId: c.id, query: "", basePath: `${base}/collections/${c.handle}` };
      if (!params.sort) params.sort = collectionSortKey(c.sortOrder);
      params.collection = null;
    } else if (req.template === "search") {
      listing = { kind: "search", title: params.q ? `Résultats pour « ${params.q} »` : "Rechercher", description: null, image: null, collectionId: null, query: params.q, basePath: `${base}/recherche` };
      // Tri par défaut choisi dans la section « Recherche » ; sans requête, aucun résultat (l'aperçu de l'éditeur
      // montre le catalogue en exemple pour que le commerçant voie la mise en page des résultats).
      if (!params.sort && main) params.sort = searchSortKey(S.str(main.settings, "default_sort", "pertinence"));
      if (!params.q && !req.sample) pool = [];
    } else {
      listing = { kind: "catalog", title: preset.copy.catalogTitle, description: null, image: null, collectionId: null, query: "", basePath: `${base}/catalogue` };
    }
    const queryPool = params.q ? pool.filter((p) => matchesQuery(p, params.q)) : pool;
    const facets = computeFacets(queryPool, req.template === "collection" ? [] : collections);
    const membership = new Map(collections.map((c) => [c.handle, new Set(c.productIds)]));
    const filtered = sortProducts(applyFilters(queryPool, { ...params, q: "" }, membership), params.sort ?? "pertinence");
    const pg = paginate(filtered, params.page, perPage);
    data.listing = { ...listing, productIds: pg.items.map((p) => p.id), total: filtered.length, page: pg.page, pages: pg.pages, perPage, facets, params };
  }

  /* Page de contenu */
  if (req.template === "page") {
    const slug = req.pageSlug ?? (req.sample ? pages[0]?.slug : undefined);
    const p = slug && /^[a-z0-9-]{1,80}$/.test(slug) ? await db.storePage.findFirst({ where: { storeId: store.id, slug, published: true }, select: { title: true, body: true, updatedAt: true } }) : null;
    if (p) data.page = { title: p.title, body: p.body, updatedAt: p.updatedAt.toISOString() };
    else if (req.sample) data.page = { title: "Exemple de page", body: "Le contenu de vos pages (livraison, retours, à propos) s'affiche ici.", updatedAt: now.toISOString() };
    else return null;
  }

  return data;
}

function parseDetails(raw: unknown): { title: string; body: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({ title: typeof d.title === "string" ? d.title.trim().slice(0, 80) : "", body: typeof d.body === "string" ? d.body.slice(0, 5000) : "" }))
    .filter((d) => d.title && d.body)
    .slice(0, 12);
}

/* ───────────────────────── Panier restauré (?panier=) ───────────────────────── */

/** Lignes de panier affichables (nom, variante, prix indicatif, image) pour des articles validés par loadCartDraft. */
export async function cartLinesSnapshot(storeId: string, items: { productId: string; variantId: string | null; optionIds: string[]; quantity: number }[]) {
  if (!items.length) return [];
  const now = new Date();
  const products = await db.product.findMany({
    where: { storeId, status: "ACTIVE", id: { in: [...new Set(items.map((i) => i.productId))] } },
    include: { variants: true, optionGroups: { include: { options: true } } },
  });
  return items.flatMap((i) => {
    const p = products.find((x) => x.id === i.productId);
    if (!p) return [];
    // Variante inconnue ou désactivée : la ligne n'est pas restaurée.
    const picked = pickOrderVariant(p, i.variantId);
    if (!picked.ok) return [];
    const v = picked.variant;
    const opts = p.optionGroups.flatMap((g) => g.options).filter((o) => i.optionIds.includes(o.id));
    const unitPrice = (v?.price ?? effectivePrice(p, now).price) + opts.reduce((s, o) => s + o.priceDelta, 0);
    return [{ productId: p.id, variantId: v?.id ?? null, optionIds: opts.map((o) => o.id), quantity: i.quantity, snapshot: { name: p.name, variantName: v?.name ?? null, unitPrice, image: v?.imageUrl ?? productImages(p.images)[0]?.url ?? null, productSlug: p.slug, optionNames: opts.map((o) => o.name) } }];
  });
}

