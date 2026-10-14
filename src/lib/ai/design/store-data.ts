import "server-only";
import { db } from "@/lib/db";
import { parseBrandKit } from "@/lib/brand-kit/palette";
import { editorDocument } from "@/lib/theme/bootstrap";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import type { StoreDesignData } from "./compile";

/**
 * Lot 4 §9 : données RÉELLES de la boutique injectées automatiquement dans le prompt et dans le compilateur
 * (nom, slogan, 20 meilleurs produits, collections, moyens de paiement, zones de livraison, horaires,
 * présence d'avis). Aucune donnée personnelle : ni client, ni commande, ni montant.
 */

const DAYS: Record<string, string> = { mon: "lundi", tue: "mardi", wed: "mercredi", thu: "jeudi", fri: "vendredi", sat: "samedi", sun: "dimanche" };

/** Horaires lisibles à partir de `Store.openingHours` ({ mon: [["08:00","18:00"]] }). */
export function formatOpeningHours(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const parts: string[] = [];
  for (const [key, label] of Object.entries(DAYS)) {
    const slots = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(slots) || !slots.length) continue;
    const ranges = slots
      .filter((s): s is [string, string] => Array.isArray(s) && typeof s[0] === "string" && typeof s[1] === "string")
      .map((s) => `${s[0]}-${s[1]}`);
    if (ranges.length) parts.push(`${label} ${ranges.join(" et ")}`);
  }
  return parts.length ? parts.join(" ; ") : null;
}

type StoreRow = {
  id: string;
  name: string;
  tagline: string | null;
  sector: string;
  city: string | null;
  country: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  openingHours: unknown;
  brandKit: unknown;
  themeDoc: unknown;
  themeDocDraft: unknown;
  themeId: string;
  themeConfig: unknown;
  whatsappNumber: string | null;
  description: string | null;
};

/** Charge les données de conception d'une boutique. `photos` : URL déjà téléversées, fournies par le formulaire. */
export async function loadStoreDesignData(store: StoreRow, photos: string[] = []): Promise<StoreDesignData> {
  const storeId = store.id;
  const [products, collections, methods, zones, reviewCount] = await Promise.all([
    db.product.findMany({
      where: { storeId, status: "ACTIVE" },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      take: 20,
      select: { id: true, name: true, images: true, category: { select: { name: true } } },
    }),
    db.category.findMany({ where: { storeId, published: true }, orderBy: { position: "asc" }, take: 20, select: { id: true, name: true } }),
    db.paymentMethod.findMany({ where: { storeId, active: true }, orderBy: { position: "asc" }, take: 10, select: { label: true } }),
    db.deliveryZone.findMany({ where: { storeId, active: true }, orderBy: { position: "asc" }, take: 12, select: { name: true } }),
    db.review.count({ where: { storeId, status: "APPROVED" } }),
  ]);

  const { doc } = editorDocument(store as unknown as Parameters<typeof editorDocument>[0]);

  return {
    storeName: store.name,
    tagline: store.tagline ?? store.description ?? null,
    sector: store.sector,
    city: store.city,
    country: store.country,
    photos: photos.filter((u) => isDisplayableImageUrl(u)).slice(0, 6),
    logoUrl: store.logoUrl && isDisplayableImageUrl(store.logoUrl) ? store.logoUrl : null,
    bannerUrl: store.bannerUrl && isDisplayableImageUrl(store.bannerUrl) ? store.bannerUrl : null,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      collection: p.category?.name ?? null,
      hasImage: Array.isArray(p.images) && p.images.length > 0,
    })),
    collections: collections.map((c) => ({ id: c.id, name: c.name })),
    paymentMethods: methods.map((m) => m.label),
    deliveryZones: zones.map((z) => z.name),
    hours: formatOpeningHours(store.openingHours),
    hasReviews: reviewCount > 0,
    brandKit: parseBrandKit(store.brandKit),
    current: doc,
  };
}

/** Champs à sélectionner pour `loadStoreDesignData`. */
export const STORE_DESIGN_SELECT = {
  id: true,
  name: true,
  tagline: true,
  sector: true,
  city: true,
  country: true,
  logoUrl: true,
  bannerUrl: true,
  openingHours: true,
  brandKit: true,
  themeDoc: true,
  themeDocDraft: true,
  themeId: true,
  themeConfig: true,
  whatsappNumber: true,
  description: true,
} as const;
