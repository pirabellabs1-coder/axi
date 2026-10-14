import "server-only";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { formatMoney } from "@/lib/money";
import { effectivePrice } from "@/lib/commerce/pricing";
import { parseStreamUrl, liveStatus, type LiveStatus } from "./stream";

/**
 * Live shopping (lot 4 §18, équipe CAN) : lecture du prochain direct d'une boutique et de ses produits
 * épinglés, pour la section de boutique et l'écran marchand.
 * Les fonctions pures (liste blanche des plateformes, statut, compte à rebours) vivent dans `stream.ts`.
 */

export type PublicLiveProduct = { id: string; slug: string; name: string; priceLabel: string; image: string | null; soldOut: boolean; pinned: boolean };

export type PublicLiveEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  status: LiveStatus;
  /** Plateforme de diffusion et lien à ouvrir (aucun lecteur tiers n'est intégré, voir §Sécurité). */
  platform: string;
  streamUrl: string;
  products: PublicLiveProduct[];
};

const MAX_PINNED = 12;

/** Direct à afficher : celui en cours, sinon le prochain programmé dans les 30 jours. */
export async function publicLiveEvent(slug: string, now = new Date()): Promise<PublicLiveEvent | null> {
  const store = await db.store.findFirst({
    where: { slug, status: { in: ["PUBLISHED", "CLOSED_TEMPORARILY"] } },
    select: { id: true, currency: true, subscription: true },
  });
  if (!store) return null;
  if (!PLANS[effectivePlanId(store.subscription)].features.liveShopping) return null;
  return liveEventForStore(store.id, store.currency, now);
}

export async function liveEventForStore(storeId: string, currency: string, now = new Date()): Promise<PublicLiveEvent | null> {
  const horizon = new Date(now.getTime() + 30 * 24 * 3600_000);
  const event = await db.liveEvent.findFirst({
    where: { storeId, status: { in: ["SCHEDULED", "LIVE"] }, startsAt: { lte: horizon } },
    orderBy: [{ status: "desc" }, { startsAt: "asc" }],
  });
  if (!event) return null;
  const stream = parseStreamUrl(event.streamUrl);
  const status = liveStatus({ startsAt: event.startsAt, endsAt: event.endsAt, status: event.status }, now);
  if (status === "ended") return null;

  const ids = event.productIds.slice(0, MAX_PINNED);
  const rows = ids.length
    ? await db.product.findMany({
        where: { storeId, id: { in: ids }, status: "ACTIVE" },
        select: { id: true, slug: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, images: true, trackStock: true, stock: true },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const products: PublicLiveProduct[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const image = Array.isArray(p.images) ? ((p.images[0] as { url?: unknown } | undefined)?.url as string | undefined) : undefined;
    products.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      priceLabel: formatMoney(effectivePrice(p, now).price, currency),
      image: typeof image === "string" && (image.startsWith("https://") || image.startsWith("/")) ? image : null,
      soldOut: p.trackStock && p.stock <= 0,
      pinned: event.pinnedId === p.id,
    });
  }
  // Le produit épinglé passe en tête : c'est celui dont le marchand parle à l'instant.
  products.sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    status,
    platform: stream?.platform ?? "autre",
    streamUrl: stream?.url ?? "",
    products,
  };
}

/** Directs de l'écran marchand (les plus proches d'abord). */
export async function listLiveEvents(storeId: string) {
  return db.liveEvent.findMany({ where: { storeId }, orderBy: [{ startsAt: "desc" }], take: 50 });
}
