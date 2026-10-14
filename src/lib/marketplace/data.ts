import { isDisplayableImageUrl, isStoredMediaUrl } from "@/lib/storage/public-url";
import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { effectivePrice } from "@/lib/commerce/pricing";
import { currencyDecimals } from "@/lib/money";
import { COUNTRIES, getCountry } from "@/config/site";
import { isOpenNow, productImages } from "@/lib/storefront/data";
import { MARKETPLACE_CATEGORIES, categoryBySlug, categoryForStore, citySlug, type MarketplaceCategory } from "./categories";
import { PAGE_SIZE, type MarketplaceQuery } from "./query";
import type { CityCount, MkImage, ProductCardData, StoreCardData, Suggestion } from "./types";

/**
 * Données de la marketplace. Toujours limité aux boutiques PUBLISHED et listées,
 * et aux produits ACTIVE. Aucune donnée privée (contact, commandes) n'est exposée.
 */

// marketplaceBlocked : retrait décidé par l'admin, que le marchand ne peut pas lever.
const LISTED: Prisma.StoreWhereInput = { status: "PUBLISHED", listedInMarketplace: true, marketplaceBlocked: false };
const VISIBLE_PRODUCT: Prisma.ProductWhereInput = { status: "ACTIVE", store: LISTED };
const COUNTED_ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"] as const;

/* ───────────── Sélections et mise en forme ───────────── */

const productSelect = {
  id: true,
  slug: true,
  name: true,
  images: true,
  price: true,
  compareAtPrice: true,
  promoPrice: true,
  promoStart: true,
  promoEnd: true,
  // Disponibilité : un produit ACTIF peut être en rupture ; la carte l'affiche « Épuisé » au lieu de
  // laisser croire qu'il est achetable.
  trackStock: true,
  stock: true,
  inventoryPolicy: true,
  variants: { select: { stock: true, inventoryPolicy: true }, take: 100 },
  store: { select: { slug: true, name: true, city: true, currency: true } },
} satisfies Prisma.ProductSelect;

/** Rupture réelle : stock suivi, vente refusée à zéro (DENY), et aucune variante encore disponible. */
function isSoldOut(p: { trackStock: boolean; stock: number; inventoryPolicy: string; variants: { stock: number; inventoryPolicy: string }[] }): boolean {
  if (!p.trackStock) return false;
  if (p.variants.length > 0) return p.variants.every((v) => v.inventoryPolicy === "DENY" && v.stock <= 0);
  return p.inventoryPolicy === "DENY" && p.stock <= 0;
}

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

const storeSelect = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  category: true,
  sector: true,
  city: true,
  country: true,
  logoUrl: true,
  bannerUrl: true,
  isFeatured: true,
  openingHours: true,
  timezone: true,
  _count: { select: { products: { where: { status: "ACTIVE" } } } },
  products: {
    where: { status: "ACTIVE" },
    orderBy: [{ isFeatured: "desc" }, { position: "asc" }, { createdAt: "desc" }],
    take: 3,
    select: { name: true, images: true },
  },
} satisfies Prisma.StoreSelect;

type StoreRow = Prisma.StoreGetPayload<{ select: typeof storeSelect }>;

function firstImage(images: unknown, fallbackAlt: string): MkImage | null {
  const img = productImages(images)[0];
  if (!img || !isSafeImageUrl(img.url)) return null;
  return { url: img.url, alt: img.alt?.trim() || fallbackAlt };
}

/** https, média téléversé (/media/… ou bucket) ou data:image héritée (pas de http en clair, pas de javascript:). */
function isSafeImageUrl(url: string): boolean {
  return isDisplayableImageUrl(url);
}

/** Image « légère » pour les couvertures, logos et suggestions : https ou média téléversé (jamais une data-URL). */
const isLinkedImage = (url: string | null | undefined): boolean => !!url && (url.startsWith("https://") || isStoredMediaUrl(url));

/** Au-delà de ce poids, une data-URL n'est pas embarquée dans la page : elle est servie par une route en cache. */
const INLINE_DATA_URL_MAX = 4096;

function productImage(p: { id: string; images: unknown; name: string }): MkImage | null {
  const img = firstImage(p.images, p.name);
  if (img && img.url.startsWith("data:") && img.url.length > INLINE_DATA_URL_MAX) {
    return { url: `/api/marketplace/image/${encodeURIComponent(p.id)}`, alt: img.alt };
  }
  return img;
}

/** Logo léger uniquement (https, média téléversé ou petite data-URL), sinon initiales. */
function safeLogo(url: string | null): string | null {
  if (!url) return null;
  if (isLinkedImage(url)) return url;
  if (url.startsWith("data:image/") && url.length <= INLINE_DATA_URL_MAX * 4) return url;
  return null;
}

function toProductCard(p: ProductRow, now: Date): ProductCardData {
  const eff = effectivePrice(p, now);
  const compareAt = eff.isPromo ? p.price : p.compareAtPrice != null && p.compareAtPrice > p.price ? p.compareAtPrice : null;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    image: productImage(p),
    price: eff.price,
    compareAt,
    isPromo: eff.isPromo || compareAt != null,
    currency: p.store.currency,
    store: { slug: p.store.slug, name: p.store.name, city: p.store.city },
    soldOut: isSoldOut(p),
  };
}

async function ratingsFor(storeIds: string[]): Promise<Map<string, { average: number; count: number }>> {
  if (!storeIds.length) return new Map();
  const rows = await db.review.groupBy({
    by: ["storeId"],
    where: { storeId: { in: storeIds }, status: "APPROVED" },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(rows.filter((r) => r._count._all > 0 && r._avg.rating != null).map((r) => [r.storeId, { average: Math.round(r._avg.rating! * 10) / 10, count: r._count._all }]));
}

async function toStoreCards(rows: StoreRow[], now = new Date()): Promise<StoreCardData[]> {
  const ratings = await ratingsFor(rows.map((r) => r.id));
  return rows.map((s) => {
    const cat = categoryForStore(s);
    const banner = s.bannerUrl && isLinkedImage(s.bannerUrl) ? { url: s.bannerUrl, alt: `Boutique ${s.name}` } : null;
    // Couverture : photo https ou téléversée uniquement (les data-URL héritées sont souvent des vignettes ou aplats).
    const productCover = s.products.map((p) => firstImage(p.images, p.name)).find((img) => isLinkedImage(img?.url)) ?? null;
    let openNow: boolean | null = null;
    try {
      openNow = isOpenNow(s.openingHours, s.timezone, now);
    } catch {
      openNow = null; // fuseau horaire invalide : on n'affiche rien
    }
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      tagline: s.tagline,
      categorySlug: cat.slug,
      categoryLabel: cat.short,
      city: s.city,
      countryName: getCountry(s.country).name,
      logoUrl: safeLogo(s.logoUrl),
      cover: banner ?? productCover,
      isFeatured: s.isFeatured,
      productCount: s._count.products,
      rating: ratings.get(s.id) ?? null,
      openNow,
    };
  });
}

/* ───────────── Filtres ───────────── */

function categoryWhere(cat: MarketplaceCategory): Prisma.StoreWhereInput {
  return { OR: [{ category: cat.id }, ...(cat.sectors.length ? [{ sector: { in: cat.sectors } }] : [])] };
}

/** Toutes les orthographes d'une ville (« Porto-Novo », « Porto Novo »...) partageant le même slug. */
async function cityVariants(ville: string): Promise<string[]> {
  const slug = citySlug(ville);
  const match = (await getCities(500)).find((c) => c.slug === slug);
  return match ? match.variants : [ville];
}

async function storeFilters(q: Pick<MarketplaceQuery, "cat" | "pays" | "ville">): Promise<Prisma.StoreWhereInput[]> {
  const and: Prisma.StoreWhereInput[] = [LISTED];
  const cat = categoryBySlug(q.cat);
  if (cat) and.push(categoryWhere(cat));
  if (q.pays) and.push({ country: q.pays });
  if (q.ville) and.push({ city: { in: await cityVariants(q.ville) } });
  return and;
}

const ZERO_DECIMAL_CURRENCIES = [...new Set([...COUNTRIES.map((c) => c.currency), "EUR", "USD"])].filter((c) => currencyDecimals(c) === 0);

function activePromoWhere(now: Date): Prisma.ProductWhereInput {
  return { promoPrice: { not: null }, AND: [{ OR: [{ promoStart: null }, { promoStart: { lte: now } }] }, { OR: [{ promoEnd: null }, { promoEnd: { gte: now } }] }] };
}

/**
 * Fourchette de prix saisie en unités affichées (FCFA, euros...) : convertie selon les décimales de la devise.
 * Porte sur le prix effectif : prix promo s'il est en cours, sinon prix de base.
 */
function priceWhere(min: number | undefined, max: number | undefined, now: Date): Prisma.ProductWhereInput | null {
  if (min == null && max == null) return null;
  const range = (factor: number): Prisma.IntFilter => ({
    ...(min != null ? { gte: min * factor } : {}),
    ...(max != null ? { lte: max * factor } : {}),
  });
  const promo = activePromoWhere(now);
  const byCurrency = (factor: number): Prisma.ProductWhereInput => ({
    OR: [
      { AND: [promo, { promoPrice: range(factor) }] },
      { AND: [{ NOT: promo }, { price: range(factor) }] },
    ],
  });
  return {
    OR: [
      { AND: [{ store: { currency: { in: ZERO_DECIMAL_CURRENCIES } } }, byCurrency(1)] },
      { AND: [{ store: { currency: { notIn: ZERO_DECIMAL_CURRENCIES } } }, byCurrency(100)] },
    ],
  };
}

/* ───────────── Accueil ───────────── */

export const getMarketplaceStats = cache(async () => {
  const [stores, products, cities] = await Promise.all([
    db.store.count({ where: LISTED }),
    db.product.count({ where: VISIBLE_PRODUCT }),
    db.store.groupBy({ by: ["city"], where: { ...LISTED, city: { not: null } } }),
  ]);
  const distinct = new Set(cities.map((c) => (c.city ? citySlug(c.city) : "")).filter(Boolean));
  return { stores, products, cities: distinct.size };
});

export async function getFeaturedStores(limit = 10): Promise<StoreCardData[]> {
  const featured = await db.store.findMany({ where: { ...LISTED, isFeatured: true }, select: storeSelect, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }], take: limit });
  let rows = featured;
  if (rows.length < Math.min(limit, 4)) {
    // Peu de boutiques mises en avant : on complète avec les boutiques les plus fournies.
    const more = await db.store.findMany({
      where: { ...LISTED, isFeatured: false },
      select: storeSelect,
      orderBy: [{ products: { _count: "desc" } }, { publishedAt: { sort: "desc", nulls: "last" } }],
      take: limit - rows.length,
    });
    rows = [...rows, ...more];
  }
  return toStoreCards(rows);
}

export async function getNewStores(limit = 8): Promise<StoreCardData[]> {
  const rows = await db.store.findMany({ where: LISTED, select: storeSelect, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: limit });
  return toStoreCards(rows);
}

/** Produits les plus commandés sur 30 jours ; complétés par les produits mis en avant si l'historique est maigre. */
export async function getTrendingProducts(limit = 10): Promise<{ products: ProductCardData[]; fromOrders: boolean }> {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const top = await db.orderItem.groupBy({
    by: ["productId"],
    where: {
      productId: { not: null },
      order: { createdAt: { gte: since }, status: { in: [...COUNTED_ORDER_STATUSES] } },
      product: VISIBLE_PRODUCT,
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });
  const ids = top.map((t) => t.productId!).filter(Boolean);
  const ranked = ids.length ? await db.product.findMany({ where: { id: { in: ids }, ...VISIBLE_PRODUCT }, select: productSelect }) : [];
  const byId = new Map(ranked.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is ProductRow => !!p);
  let rows = ordered;
  if (rows.length < limit) {
    const fill = await db.product.findMany({
      where: { ...VISIBLE_PRODUCT, id: { notIn: ids } },
      select: productSelect,
      orderBy: [{ isFeatured: "desc" }, { store: { isFeatured: "desc" } }, { updatedAt: "desc" }],
      take: limit - rows.length,
    });
    rows = [...rows, ...fill];
  }
  return { products: rows.map((p) => toProductCard(p, now)), fromOrders: ordered.length >= Math.min(4, limit) };
}

export async function getPromoProducts(limit = 8): Promise<ProductCardData[]> {
  const now = new Date();
  const rows = await db.product.findMany({
    where: {
      ...VISIBLE_PRODUCT,
      OR: [activePromoWhere(now), { compareAtPrice: { not: null } }],
    },
    select: productSelect,
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
  return rows
    .map((p) => toProductCard(p, now))
    .filter((p) => p.compareAt != null && p.compareAt > p.price)
    .sort((a, b) => (b.compareAt! - b.price) / b.compareAt! - (a.compareAt! - a.price) / a.compareAt!)
    .slice(0, limit);
}

export const getCities = cache(async (limit = 24): Promise<CityCount[]> => {
  const rows = await db.store.groupBy({
    by: ["city", "country"],
    where: { ...LISTED, city: { not: null } },
    _count: { _all: true },
  });
  const merged = new Map<string, CityCount>();
  for (const r of rows) {
    if (!r.city?.trim()) continue;
    const slug = citySlug(r.city);
    if (!slug) continue;
    const prev = merged.get(slug);
    if (prev) {
      prev.stores += r._count._all;
      if (!prev.variants.includes(r.city)) prev.variants.push(r.city);
    } else merged.set(slug, { city: r.city.trim(), slug, country: r.country, stores: r._count._all, variants: [r.city] });
  }
  return [...merged.values()].sort((a, b) => b.stores - a.stores || a.city.localeCompare(b.city, "fr")).slice(0, limit);
});

/** Nombre de boutiques par catégorie (pour les tuiles). */
export async function getCategoryCounts(): Promise<Record<string, number>> {
  const rows = await db.store.groupBy({ by: ["category", "sector"], where: LISTED, _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const r of rows) {
    const cat = categoryForStore(r);
    out[cat.slug] = (out[cat.slug] ?? 0) + r._count._all;
  }
  return out;
}

/* ───────────── Recherche ───────────── */

export type SearchResult = {
  products: ProductCardData[];
  stores: StoreCardData[];
  productTotal: number;
  storeTotal: number;
  page: number;
  pageCount: number;
};

function textProductWhere(q: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { category: { name: { contains: q, mode: "insensitive" } } },
      { store: { name: { contains: q, mode: "insensitive" } } },
    ],
  };
}

function textStoreWhere(q: string): Prisma.StoreWhereInput {
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { tagline: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { products: { some: { status: "ACTIVE", name: { contains: q, mode: "insensitive" } } } },
    ],
  };
}

function productOrder(tri: MarketplaceQuery["tri"]): Prisma.ProductOrderByWithRelationInput[] {
  switch (tri) {
    case "nouveautes":
      return [{ createdAt: "desc" }, { id: "asc" }];
    case "prix-croissant":
      return [{ price: "asc" }, { id: "asc" }];
    case "prix-decroissant":
      return [{ price: "desc" }, { id: "asc" }];
    default:
      return [{ isFeatured: "desc" }, { store: { isFeatured: "desc" } }, { updatedAt: "desc" }, { id: "asc" }];
  }
}

/**
 * Pagination par « paquets » : les correspondances dans le nom passent avant celles
 * trouvées dans la description (pertinence simple, sans index plein texte).
 */
async function paginateProducts(buckets: Prisma.ProductWhereInput[], orderBy: Prisma.ProductOrderByWithRelationInput[], skip: number, take: number) {
  const counts = await Promise.all(buckets.map((where) => db.product.count({ where })));
  const rows: ProductRow[] = [];
  let offset = skip;
  for (let i = 0; i < buckets.length && rows.length < take; i++) {
    if (offset >= counts[i]) {
      offset -= counts[i];
      continue;
    }
    const part = await db.product.findMany({ where: buckets[i], select: productSelect, orderBy, skip: offset, take: take - rows.length });
    rows.push(...part);
    offset = 0;
  }
  return { rows, total: counts.reduce((a, b) => a + b, 0) };
}

export async function searchMarketplace(query: MarketplaceQuery): Promise<SearchResult> {
  const now = new Date();
  const sf = await storeFilters(query);
  const price = priceWhere(query.min, query.max, now);
  const productBase: Prisma.ProductWhereInput = { AND: [{ status: "ACTIVE" }, { store: { AND: sf } }, ...(price ? [price] : [])] };
  const storeWhere: Prisma.StoreWhereInput = { AND: [...sf, ...(query.q ? [textStoreWhere(query.q)] : [])] };

  const skip = (query.page - 1) * PAGE_SIZE;

  let productBuckets: Prisma.ProductWhereInput[];
  if (query.q && query.tri === "pertinence") {
    const nameMatch: Prisma.ProductWhereInput = { name: { contains: query.q, mode: "insensitive" } };
    productBuckets = [{ AND: [productBase, nameMatch] }, { AND: [productBase, textProductWhere(query.q), { NOT: nameMatch }] }];
  } else {
    productBuckets = [query.q ? { AND: [productBase, textProductWhere(query.q)] } : productBase];
  }

  const wantProducts = query.onglet === "produits";
  const [productPage, storeTotal, storeRows] = await Promise.all([
    wantProducts
      ? paginateProducts(productBuckets, productOrder(query.tri), skip, PAGE_SIZE)
      : Promise.all(productBuckets.map((where) => db.product.count({ where }))).then((c) => ({ rows: [] as ProductRow[], total: c.reduce((a, b) => a + b, 0) })),
    db.store.count({ where: storeWhere }),
    wantProducts
      ? Promise.resolve([] as StoreRow[])
      : db.store.findMany({
          where: storeWhere,
          select: storeSelect,
          orderBy:
            query.tri === "nouveautes"
              ? [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }]
              : [{ isFeatured: "desc" }, { products: { _count: "desc" } }, { id: "asc" }],
          skip,
          take: PAGE_SIZE,
        }),
  ]);

  const total = wantProducts ? productPage.total : storeTotal;
  return {
    products: productPage.rows.map((p) => toProductCard(p, now)),
    stores: await toStoreCards(storeRows, now),
    productTotal: productPage.total,
    storeTotal,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/* ───────────── Catégorie et ville ───────────── */

export async function getCollection(filter: { cat?: string; ville?: string }, opts: { stores?: number; products?: number } = {}) {
  const now = new Date();
  const sf = await storeFilters(filter);
  const [storeRows, storeTotal, productRows, productTotal] = await Promise.all([
    db.store.findMany({ where: { AND: sf }, select: storeSelect, orderBy: [{ isFeatured: "desc" }, { products: { _count: "desc" } }, { id: "asc" }], take: opts.stores ?? 12 }),
    db.store.count({ where: { AND: sf } }),
    db.product.findMany({ where: { status: "ACTIVE", store: { AND: sf } }, select: productSelect, orderBy: productOrder("pertinence"), take: opts.products ?? 12 }),
    db.product.count({ where: { status: "ACTIVE", store: { AND: sf } } }),
  ]);
  return { stores: await toStoreCards(storeRows, now), storeTotal, products: productRows.map((p) => toProductCard(p, now)), productTotal };
}

/** Retrouve le nom d'une ville à partir de son slug d'URL (null si aucune boutique listée). */
export async function resolveCity(slug: string): Promise<CityCount | null> {
  const cities = await getCities(500);
  return cities.find((c) => c.slug === slug) ?? null;
}

/* ───────────── Suggestions ───────────── */

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export async function suggest(q: string): Promise<Suggestion[]> {
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  const [stores, products, cities] = await Promise.all([
    db.store.findMany({
      where: { ...LISTED, OR: [{ name: { contains: term, mode: "insensitive" } }, { tagline: { contains: term, mode: "insensitive" } }] },
      select: { slug: true, name: true, city: true, logoUrl: true, category: true, sector: true },
      orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
      take: 3,
    }),
    db.product.findMany({ where: { ...VISIBLE_PRODUCT, name: { contains: term, mode: "insensitive" } }, select: productSelect, orderBy: productOrder("pertinence"), take: 5 }),
    getCities(200),
  ]);
  const now = new Date();
  const n = norm(term);
  const out: Suggestion[] = [];
  for (const c of MARKETPLACE_CATEGORIES) {
    if (norm(c.label).includes(n) || norm(c.short).includes(n)) out.push({ type: "category", label: c.label, sub: "Catégorie", href: `/marketplace/categorie/${c.slug}`, image: null });
  }
  for (const c of cities) {
    if (norm(c.city).includes(n)) out.push({ type: "city", label: c.city, sub: `${c.stores} ${c.stores > 1 ? "boutiques" : "boutique"}`, href: `/marketplace/ville/${c.slug}`, image: null });
  }
  const meta = out.slice(0, 2);
  const storeSugg: Suggestion[] = stores.map((s) => ({
    type: "store",
    label: s.name,
    sub: [categoryForStore(s).short, s.city].filter(Boolean).join(", "),
    href: `/s/${s.slug}`,
    image: s.logoUrl && isLinkedImage(s.logoUrl) ? s.logoUrl : null,
  }));
  const productSugg: Suggestion[] = products.map((p) => {
    const card = toProductCard(p, now);
    return { type: "product", label: card.name, sub: card.store.name, href: `/s/${card.store.slug}/p/${card.slug}`, image: card.image && isLinkedImage(card.image.url) ? card.image.url : null };
  });
  return [...meta, ...storeSugg, ...productSugg.slice(0, Math.max(0, 8 - meta.length - storeSugg.length))].slice(0, 8);
}
