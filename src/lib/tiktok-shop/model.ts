/**
 * Forme de `Integration.config` pour kind = "tiktok_shop" (module PUR). Lecture tolérante : une valeur
 * absente ou corrompue retombe sur un défaut sûr, jamais d'exception à l'affichage.
 */

export type ProductLinkStatus = "draft" | "publishing" | "PENDING" | "FAILED" | "ACTIVATE" | "SELLER_DEACTIVATED" | "PLATFORM_DEACTIVATED" | "FREEZE" | "DELETED" | "error" | string;

export type ProductLink = {
  categoryId: string;
  categoryName: string;
  /** Attributs produit choisis par le marchand : id TikTok → valeurs (id de valeur proposée, ou texte libre). */
  attributes: { id: string; values: { id?: string; name?: string }[] }[];
  tiktokProductId: string | null;
  /** Clé de variante Axi (id de variante, ou « _ » pour un produit simple) → id SKU TikTok. */
  skus: Record<string, string>;
  /** Dernière quantité envoyée par clé de variante (la synchro de stock n'envoie que les écarts). */
  pushedStock: Record<string, number>;
  status: ProductLinkStatus;
  reviewReasons: string[];
  lastError: string | null;
  lastSyncedAt: number | null;
};

export type TtsSettings = {
  /** Majoration appliquée au prix converti (commission TikTok, change) : 0 à 5000 points de base (50 %). */
  markupBps: number;
  /** Poids de colis par défaut si le produit n'en a pas (grammes). */
  defaultWeightGrams: number;
  /** Dimensions de colis par défaut (cm), exigées par TikTok. */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Quantité annoncée à TikTok pour un article sans suivi de stock. */
  untrackedQuantity: number;
  /** Synchronisation active (commandes, stock, expéditions). */
  enabled: boolean;
};

export type TtsConfig = {
  shop: { id: string; name: string; region: string; cipher: string; currency: string } | null;
  /** Boutiques autorisées (choix si plusieurs). Le cipher n'est pas un secret mais n'est pas affiché. */
  shops: { id: string; name: string; region: string; cipher: string }[];
  warehouseId: string | null;
  settings: TtsSettings;
  tokens: { accessExpiresAt: number | null; refreshExpiresAt: number | null; openId: string | null; sellerName: string | null; sellerBaseRegion: string | null; scopes: string[] };
  products: Record<string, ProductLink>;
  /** URL d'image Axi → URI TikTok (pas de second téléversement). */
  imageUris: Record<string, string>;
  orders: { lastPullAt: number | null; lastImportAt: number | null; imported: number };
  connectedAt: number | null;
  connectedBy: string | null;
};

export const DEFAULT_SETTINGS: TtsSettings = { markupBps: 0, defaultWeightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10, untrackedQuantity: 50, enabled: true };

export const MAX_LINKED_PRODUCTS = 1000;

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown, min: number, max: number, dflt: number) => {
  const n = num(v);
  return n === null ? dflt : Math.min(max, Math.max(min, Math.trunc(n)));
};
const strRecord = (v: unknown): Record<string, string> => Object.fromEntries(Object.entries(o(v)).filter(([, x]) => typeof x === "string")) as Record<string, string>;
const numRecord = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(o(v)).filter(([, x]) => typeof x === "number" && Number.isFinite(x))) as Record<string, number>;

function readLink(v: unknown): ProductLink | null {
  const l = o(v);
  const categoryId = str(l.categoryId);
  if (!categoryId) return null;
  return {
    categoryId,
    categoryName: str(l.categoryName) ?? categoryId,
    attributes: (Array.isArray(l.attributes) ? l.attributes : [])
      .map((a) => o(a))
      .filter((a) => str(a.id))
      .map((a) => ({
        id: String(a.id),
        values: (Array.isArray(a.values) ? a.values : []).map((x) => o(x)).map((x) => (str(x.id) ? { id: String(x.id) } : { name: String(x.name ?? "").slice(0, 120) })).filter((x) => x.id || x.name),
      })),
    tiktokProductId: str(l.tiktokProductId),
    skus: strRecord(l.skus),
    pushedStock: numRecord(l.pushedStock),
    status: str(l.status) ?? "draft",
    reviewReasons: Array.isArray(l.reviewReasons) ? l.reviewReasons.map(String).slice(0, 10) : [],
    lastError: str(l.lastError),
    lastSyncedAt: num(l.lastSyncedAt),
  };
}

const SAFE_KEY = /^[\w-]{1,64}$/;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Lien produit (propriété PROPRE uniquement : jamais une valeur héritée d'un prototype). */
export function linkOf(config: Pick<TtsConfig, "products">, productId: string): ProductLink | undefined {
  return Object.hasOwn(config.products, productId) ? config.products[productId] : undefined;
}

export function readConfig(raw: unknown): TtsConfig {
  const c = o(raw);
  const shop = o(c.shop);
  const settings = o(c.settings);
  const tokens = o(c.tokens);
  const orders = o(c.orders);
  // Objet sans prototype + clés filtrées : aucune clé (« __proto__ », « constructor »…) ne peut polluer un prototype.
  const products: Record<string, ProductLink> = Object.create(null);
  for (const [k, v] of Object.entries(o(c.products))) {
    if (!SAFE_KEY.test(k) || UNSAFE_KEYS.has(k)) continue;
    const l = readLink(v);
    if (l) products[k] = l;
  }
  return {
    shop: str(shop.id) && str(shop.cipher) ? { id: String(shop.id), name: str(shop.name) ?? "", region: str(shop.region) ?? "", cipher: String(shop.cipher), currency: str(shop.currency) ?? "" } : null,
    shops: (Array.isArray(c.shops) ? c.shops : []).map((x) => o(x)).filter((x) => str(x.id) && str(x.cipher)).map((x) => ({ id: String(x.id), name: str(x.name) ?? "", region: str(x.region) ?? "", cipher: String(x.cipher) })),
    warehouseId: str(c.warehouseId),
    settings: {
      markupBps: int(settings.markupBps, 0, 5000, DEFAULT_SETTINGS.markupBps),
      defaultWeightGrams: int(settings.defaultWeightGrams, 1, 100_000, DEFAULT_SETTINGS.defaultWeightGrams),
      lengthCm: int(settings.lengthCm, 1, 300, DEFAULT_SETTINGS.lengthCm),
      widthCm: int(settings.widthCm, 1, 300, DEFAULT_SETTINGS.widthCm),
      heightCm: int(settings.heightCm, 1, 300, DEFAULT_SETTINGS.heightCm),
      untrackedQuantity: int(settings.untrackedQuantity, 0, 9999, DEFAULT_SETTINGS.untrackedQuantity),
      enabled: settings.enabled !== false,
    },
    tokens: {
      accessExpiresAt: num(tokens.accessExpiresAt),
      refreshExpiresAt: num(tokens.refreshExpiresAt),
      openId: str(tokens.openId),
      sellerName: str(tokens.sellerName),
      sellerBaseRegion: str(tokens.sellerBaseRegion),
      scopes: Array.isArray(tokens.scopes) ? tokens.scopes.map(String) : [],
    },
    products,
    imageUris: strRecord(c.imageUris),
    orders: { lastPullAt: num(orders.lastPullAt), lastImportAt: num(orders.lastImportAt), imported: int(orders.imported, 0, Number.MAX_SAFE_INTEGER, 0) },
    connectedAt: num(c.connectedAt),
    connectedBy: str(c.connectedBy),
  };
}

export const emptyLink = (categoryId: string, categoryName: string): ProductLink => ({
  categoryId,
  categoryName,
  attributes: [],
  tiktokProductId: null,
  skus: {},
  pushedStock: {},
  status: "draft",
  reviewReasons: [],
  lastError: null,
  lastSyncedAt: null,
});

export const STATUS_LABELS: Record<string, string> = {
  draft: "À publier",
  publishing: "Envoi en cours",
  PENDING: "En revue TikTok",
  FAILED: "Refusé par TikTok",
  ACTIVATE: "En ligne",
  SELLER_DEACTIVATED: "Désactivé",
  PLATFORM_DEACTIVATED: "Désactivé par TikTok",
  FREEZE: "Gelé par TikTok",
  DELETED: "Supprimé",
  error: "Erreur",
};
