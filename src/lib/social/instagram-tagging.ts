import { sanitizeError } from "./meta-batch";

/**
 * Identification de produits du catalogue sur les publications et Reels Instagram (API Instagram Graph, « Instagram
 * API with Facebook Login », guide « Product Tagging », consulté le 14/10/2026, v26.0).
 *
 * Flux documenté :
 *  1. GET /{ig-user-id}?fields=shopping_product_tag_eligibility → true si le compte est relié à une Boutique
 *     Instagram APPROUVÉE (sinon : rien n'est possible, voir docs/SOCIAL-COMMERCE.md) ;
 *  2. GET /{ig-user-id}/available_catalogs → catalogues utilisables ;
 *  3. GET /{ig-user-id}/catalog_product_search?catalog_id=…&q=<retailer_id> → product_id Meta + review_status ;
 *  4. POST /{ig-media-id}/product_tags?updated_tags=[{product_id, x, y}] → identification d'une publication EXISTANTE
 *     (20 identifications par publication, 30 par Reel ; ajout cumulatif).
 * Permissions : instagram_basic, instagram_shopping_tag_products, catalog_management (+ ads_management selon le rôle),
 * jeton UTILISATEUR (ici : le jeton d'utilisateur système de l'intégration whatsapp_cloud, même portefeuille Business).
 * Limites : comptes Créateur, Stories et Live non pris en charge ; 25 publications identifiées par 24 h. Depuis le
 * 10/08/2023, Meta réserve l'identification aux boutiques avec paiement intégré (checkout) dans la plupart des cas.
 *
 * Fonctionnalité derrière le drapeau SOCIAL_IG_PRODUCT_TAGGING=1 (désactivée par défaut).
 */

export function instagramTaggingEnabled(): boolean {
  return process.env.SOCIAL_IG_PRODUCT_TAGGING === "1";
}

/** Integration.kind de la configuration (sans secret propre : le jeton est celui de whatsapp_cloud). */
export const INSTAGRAM_KIND = "instagram_shopping";
export const IG_ID = /^\d{5,32}$/;
export const MAX_TAGS_PER_POST = 5; // choix produit : Meta en accepte 20 (publication) / 30 (Reel)
export const MAX_TAGGED_POSTS_PER_DAY = 25;

export type IgMedia = { id: string; caption: string; mediaType: string; productType: string; thumbnail: string | null; permalink: string | null; timestamp: string | null };
export type IgCatalogProduct = { productId: string; retailerId: string; name: string; reviewStatus: string; variantIds: string[] };
export type IgCatalog = { id: string; name: string; productCount: number | null };

export class InstagramApiError extends Error {
  constructor(message: string, public code: number | null) {
    super(message);
  }
}

/** Position des identifications sur une IMAGE (x, y entre 0 et 1) : colonne centrale, espacées ; absentes pour une vidéo. */
export function buildUpdatedTags(productIds: string[], mediaType: string): { product_id: string; x?: number; y?: number }[] {
  const unique = [...new Set(productIds.filter((id) => IG_ID.test(id)))].slice(0, MAX_TAGS_PER_POST);
  const image = mediaType === "IMAGE" || mediaType === "CAROUSEL_ALBUM";
  return unique.map((product_id, i) => (image ? { product_id, x: 0.5, y: Math.round((0.2 + i * 0.15) * 100) / 100 } : { product_id }));
}

/** Publication identifiable : ni Story ni Live (types documentés), image, vidéo, carrousel ou Reel. */
export function isTaggableMedia(m: Pick<IgMedia, "mediaType" | "productType">): boolean {
  if (m.productType === "STORY" || m.productType === "LIVE") return false;
  return ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"].includes(m.mediaType);
}

/** Choisit, parmi les résultats de recherche, l'article dont le retailer_id correspond exactement. */
export function matchCatalogProduct(results: IgCatalogProduct[], retailerIds: string[]): IgCatalogProduct | null {
  for (const rid of retailerIds) {
    const hit = results.find((r) => r.retailerId === rid);
    if (hit) return hit;
  }
  return null;
}

type Json = Record<string, unknown>;

/** Client minimal (jeton jamais journalisé ; messages nettoyés). */
export function instagramApi(token: string, version: string, fetchImpl: typeof fetch = fetch) {
  const call = async (path: string, init: { method: "GET" | "POST"; params?: Record<string, string> }): Promise<Json> => {
    const qs = new URLSearchParams(init.params ?? {});
    let res: Response;
    try {
      res = await fetchImpl(`https://graph.facebook.com/${version}/${path}${qs.toString() ? `?${qs}` : ""}`, {
        method: init.method,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      throw new InstagramApiError("Instagram : erreur réseau ou délai dépassé", null);
    }
    const json = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string; code?: number } };
    if (!res.ok || json.error) {
      throw new InstagramApiError(sanitizeError(`Instagram ${res.status} : ${json.error?.message ?? "erreur inconnue"}`, 300, [token]), typeof json.error?.code === "number" ? json.error.code : null);
    }
    return json;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

  return {
    async eligibility(igUserId: string): Promise<boolean> {
      const r = await call(igUserId, { method: "GET", params: { fields: "shopping_product_tag_eligibility" } });
      return r.shopping_product_tag_eligibility === true;
    },
    async catalogs(igUserId: string): Promise<IgCatalog[]> {
      const r = await call(`${igUserId}/available_catalogs`, { method: "GET", params: { fields: "catalog_id,catalog_name,product_count" } });
      const data = Array.isArray(r.data) ? (r.data as Json[]) : [];
      return data.map((c) => ({ id: str(c.catalog_id), name: str(c.catalog_name).slice(0, 120), productCount: typeof c.product_count === "number" ? c.product_count : null })).filter((c) => IG_ID.test(c.id));
    },
    async recentMedia(igUserId: string, limit = 12): Promise<IgMedia[]> {
      const r = await call(`${igUserId}/media`, {
        method: "GET",
        params: { fields: "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp", limit: String(Math.min(25, limit)) },
      });
      const data = Array.isArray(r.data) ? (r.data as Json[]) : [];
      return data
        .map((m) => {
          const mediaType = str(m.media_type);
          const thumb = str(m.thumbnail_url) || (mediaType === "IMAGE" || mediaType === "CAROUSEL_ALBUM" ? str(m.media_url) : "");
          return {
            id: str(m.id),
            caption: str(m.caption).replace(/\s+/g, " ").slice(0, 140),
            mediaType,
            productType: str(m.media_product_type),
            thumbnail: thumb.startsWith("https://") ? thumb : null,
            permalink: str(m.permalink).startsWith("https://www.instagram.com/") ? str(m.permalink) : null,
            timestamp: str(m.timestamp) || null,
          };
        })
        .filter((m) => IG_ID.test(m.id));
    },
    async searchProducts(igUserId: string, catalogId: string, q: string): Promise<IgCatalogProduct[]> {
      const r = await call(`${igUserId}/catalog_product_search`, { method: "GET", params: { catalog_id: catalogId, q: q.slice(0, 100) } });
      const data = Array.isArray(r.data) ? (r.data as Json[]) : [];
      return data.map((p) => ({
        productId: str(p.product_id),
        retailerId: str(p.retailer_id),
        name: str(p.product_name).slice(0, 150),
        reviewStatus: str(p.review_status),
        variantIds: Array.isArray(p.product_variants) ? (p.product_variants as Json[]).map((v) => str(v.product_id)).filter((id) => IG_ID.test(id)) : [],
      }));
    },
    async tagMedia(mediaId: string, tags: { product_id: string; x?: number; y?: number }[]): Promise<boolean> {
      const r = await call(`${mediaId}/product_tags`, { method: "POST", params: { updated_tags: JSON.stringify(tags) } });
      return r.success === true;
    },
  };
}

export type InstagramApi = ReturnType<typeof instagramApi>;
