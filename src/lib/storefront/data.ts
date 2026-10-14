import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { storeRoleStillAllowed } from "@/lib/admin/roles";

const findStoreBySlug = cache(async (slug: string) =>
  db.store.findUnique({
    where: { slug },
    include: {
      // Ordre des collections choisi par le commerçant (/app/{storeId}/collections) ; nom en cas d'égalité.
      categories: { orderBy: [{ position: "asc" }, { name: "asc" }] },
      deliveryZones: { where: { active: true }, orderBy: { position: "asc" } },
      pickupSlots: { where: { active: true }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
      paymentMethods: { where: { active: true }, orderBy: { position: "asc" }, select: { id: true, kind: true, provider: true, label: true, instructions: true, accountNumber: true, accountName: true } },
      subscription: true,
    },
  }),
);

const isPublicStatus = (status: string) => status === "PUBLISHED" || status === "CLOSED_TEMPORARILY";

/** Boutique publique par slug — uniquement PUBLISHED ou CLOSED_TEMPORARILY (affiche « fermée »). */
export const getPublicStore = cache(async (slug: string) => {
  const store = await findStoreBySlug(slug);
  if (!store || !isPublicStatus(store.status)) return null;
  return store;
});

/** Cookie posé par l'éditeur d'apparence (valeur = slug) : la boutique s'affiche avec le thème brouillon. */
export const PREVIEW_COOKIE = "axi_preview";

export type StorefrontPreview = { unpublished: boolean; draft: boolean };

/** Le visiteur connecté est-il membre actif de la boutique ? */
const viewerIsMember = cache(async (storeId: string) => {
  const user = await getCurrentUser();
  if (!user) return false;
  const m = await db.membership.findUnique({ where: { userId_storeId: { userId: user.id, storeId } }, select: { expiresAt: true, role: true, user: { select: { isPlatformAdmin: true, platformRole: true } } } });
  if (!m || (m.expiresAt && m.expiresAt <= new Date())) return false;
  // Adhésion SUPPORT résiduelle : ignorée si l'utilisateur n'a plus la permission plateforme support.access.
  return storeRoleStillAllowed(m.role, m.user);
});

/** Aperçu de l'éditeur (`?preview=1`) : réservé aux membres actifs de la boutique. */
export async function canPreviewStore(storeId: string): Promise<boolean> {
  return viewerIsMember(storeId);
}

/**
 * Boutique pour la vitrine `/s/[slug]`, avec mode aperçu réservé aux membres :
 *  - boutique non publiée : visible uniquement par ses membres (sinon null, donc 404) ;
 *  - cookie d'aperçu posé par l'éditeur : le thème brouillon remplace le thème publié (membres seulement).
 * Les visiteurs anonymes ne déclenchent aucune requête supplémentaire sur une boutique publiée.
 */
export const getStorefront = cache(async (slug: string): Promise<{ store: NonNullable<Awaited<ReturnType<typeof findStoreBySlug>>>; preview: StorefrontPreview | null } | null> => {
  const store = await findStoreBySlug(slug);
  if (!store) return null;
  const isPublic = isPublicStatus(store.status);
  const wantsDraft = (await cookies()).get(PREVIEW_COOKIE)?.value === slug && (!!store.themeDraft || !!store.themeDocDraft);
  if (isPublic && !wantsDraft) return { store, preview: null };
  if (!(await viewerIsMember(store.id))) return isPublic ? { store, preview: null } : null;
  return {
    store: wantsDraft && store.themeDraft ? { ...store, themeConfig: store.themeDraft } : store,
    preview: { unpublished: !isPublic, draft: wantsDraft },
  };
});

export const getPublicStoreByHost = cache(async (host: string) => {
  const d = await db.domain.findUnique({ where: { hostname: host.toLowerCase() }, select: { verified: true, store: { select: { slug: true } } } });
  if (!d?.verified) return null;
  return getPublicStore(d.store.slug);
});

export const getPublicProducts = cache(async (storeId: string, opts: { categoryId?: string; q?: string } = {}) => {
  return db.product.findMany({
    where: {
      storeId,
      status: "ACTIVE",
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { description: { contains: opts.q, mode: "insensitive" } }] } : {}),
    },
    include: { variants: { orderBy: { position: "asc" } }, category: true },
    orderBy: [{ isFeatured: "desc" }, { position: "asc" }, { createdAt: "desc" }],
  });
});

export const getPublicProduct = cache(async (storeId: string, slug: string) => {
  return db.product.findFirst({
    where: { storeId, slug, status: "ACTIVE" },
    include: { variants: { orderBy: { position: "asc" } }, optionGroups: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } }, category: true },
  });
});

export function productImages(images: unknown): { url: string; alt?: string }[] {
  if (!Array.isArray(images)) return [];
  return images.filter((i): i is { url: string; alt?: string } => !!i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string");
}

/** Marketplace : boutiques publiées et listées. */
export async function listMarketplaceStores(opts: { q?: string; category?: string; country?: string; take?: number } = {}) {
  return db.store.findMany({
    where: {
      status: "PUBLISHED",
      listedInMarketplace: true,
      marketplaceBlocked: false,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.country ? { country: opts.country } : {}),
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { tagline: { contains: opts.q, mode: "insensitive" } }, { city: { contains: opts.q, mode: "insensitive" } }] } : {}),
    },
    select: {
      id: true, slug: true, name: true, tagline: true, category: true, city: true, country: true, logoUrl: true, bannerUrl: true, isFeatured: true, publishedAt: true,
      _count: { select: { products: { where: { status: "ACTIVE" } }, orders: true } },
    },
    orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }],
    take: opts.take ?? 60,
  });
}

/** Horaires : la boutique est-elle ouverte maintenant ? (null si non renseigné) */
export function isOpenNow(openingHours: unknown, timezone: string, now = new Date()): boolean | null {
  if (!openingHours || typeof openingHours !== "object") return null;
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const day = String(parts.weekday).toLowerCase().slice(0, 3);
  const hm = `${parts.hour}:${parts.minute}`;
  const idx = days.indexOf(day);
  const key = days[idx];
  const ranges = (openingHours as Record<string, [string, string][]>)[key];
  if (!ranges) return false;
  return ranges.some(([a, b]) => hm >= a && hm <= b);
}

/* ───────────────────────── Avis, pages, fidélité, quota ───────────────────────── */

export type PublicReview = { id: string; customerName: string; rating: number; body: string; reply: string | null; createdAt: Date; productName: string | null };

/** Avis APPROUVÉS uniquement (modération marchand). Nom affiché abrégé : « Aïcha K. ». */
export function getStoreReviews(storeId: string, opts: { productId?: string; take?: number } = {}) {
  return getStoreReviewsCached(storeId, opts.productId ?? null, opts.take ?? 3);
}

// Arguments primitifs : `cache` compare par identité.
const getStoreReviewsCached = cache(async (storeId: string, productId: string | null, take: number) => {
  const where = { storeId, status: "APPROVED" as const, ...(productId ? { productId } : {}) };
  const [rows, agg] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, customerName: true, rating: true, body: true, reply: true, createdAt: true, product: { select: { name: true } } },
    }),
    db.review.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const reviews: PublicReview[] = rows.map((r) => ({ id: r.id, customerName: shortName(r.customerName), rating: clampRating(r.rating), body: r.body, reply: r.reply, createdAt: r.createdAt, productName: r.product?.name ?? null }));
  return { reviews, average: agg._avg.rating ?? 0, count: agg._count._all };
});

/** Pages personnalisées publiées (liens du pied de page). */
export const getStorePages = cache(async (storeId: string) => {
  return db.storePage.findMany({ where: { storeId, published: true }, orderBy: [{ position: "asc" }, { title: "asc" }], select: { slug: true, title: true } });
});

export const getStorePage = cache(async (storeId: string, slug: string) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return db.storePage.findFirst({ where: { storeId, slug, published: true }, select: { slug: true, title: true, body: true, updatedAt: true } });
});

/** Produits similaires : même catégorie d'abord, complétés par les produits mis en avant. */
export const getSimilarProducts = cache(async (storeId: string, productId: string, categoryId: string | null, take = 4) => {
  const include = { variants: { orderBy: { position: "asc" as const } } };
  const same = categoryId
    ? await db.product.findMany({ where: { storeId, status: "ACTIVE", categoryId, id: { not: productId } }, include, orderBy: [{ isFeatured: "desc" }, { position: "asc" }], take })
    : [];
  if (same.length >= take) return same;
  const more = await db.product.findMany({
    where: { storeId, status: "ACTIVE", id: { notIn: [productId, ...same.map((p) => p.id)] } },
    include,
    orderBy: [{ isFeatured: "desc" }, { position: "asc" }],
    take: take - same.length,
  });
  return [...same, ...more];
});

export type LoyaltyInfo = { pointsPer1000: number; rewardPoints: number; rewardValue: number };

/** Config fidélité lue défensivement (JSON marchand). null si désactivée ou incomplète. */
export function loyaltyInfo(config: unknown): LoyaltyInfo | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (c.enabled !== true) return null;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : d);
  return { pointsPer1000: n(c.pointsPer1000, 1), rewardPoints: n(c.rewardPoints, 100), rewardValue: n(c.rewardValue, 0) };
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "Client";
  return `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase()}.`;
}

function clampRating(n: number) {
  return Math.max(1, Math.min(5, Math.round(n)));
}
