import { API_BASE, AUTH_BASE, type PlatformConfig } from "./config";
import { signRequest } from "./sign";
import {
  TiktokShopError,
  type TiktokAttribute,
  type TiktokCategory,
  type TiktokOrder,
  type TiktokProductInput,
  type TiktokProductResult,
  type TiktokProductStatus,
  type TiktokShippingProvider,
  type TiktokShopApi,
  type TiktokShopAuth,
  type TiktokShopInfo,
  type TiktokWarehouse,
  type TokenSet,
} from "./types";

/**
 * Client HTTP de l'Open API TikTok Shop (202309). Aucun import serveur : les dépendances (fetch, horloge, jetons)
 * sont injectées, ce qui le rend testable sans réseau.
 *
 *  - Signature HMAC-SHA256 de chaque requête (`sign.ts`), `timestamp` en secondes, jeton dans `x-tts-access-token`.
 *  - Délai maximal par appel (15 s) ; reprises bornées (2) avec backoff sur 429 / 5xx / réseau, UNIQUEMENT pour les
 *    opérations idempotentes (lectures, remplacement de stock). Création de produit et expédition ne sont jamais
 *    rejouées ici : l'idempotence est assurée en amont (recherche par seller_sku, contrôle de statut de commande).
 *  - Jeton expiré / invalide : un seul rafraîchissement (`tokens.refresh()`), puis nouvel essai.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type TokenProvider = { get(): Promise<string>; refresh(): Promise<string> };

export type ClientDeps = {
  platform: PlatformConfig;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
};

type Envelope<T> = { code?: number; message?: string; request_id?: string; data?: T };

const DEFAULT_TIMEOUT = 15_000;

/** Codes 1050xx : jeton d'accès invalide ou expiré (famille « authorization »). */
function isAuthCode(code: number): boolean {
  return code >= 105000 && code < 106000;
}

function classify(status: number, code: number | null, message: string): TiktokShopError {
  if (status === 429 || /too many|rate limit|qps/i.test(message)) return new TiktokShopError(`Quota d'appels TikTok atteint : ${message}`, "rate_limit", code, true);
  if (status === 401 || (code !== null && isAuthCode(code))) return new TiktokShopError(`Autorisation TikTok refusée : ${message}`, "auth", code, false);
  if (status === 404) return new TiktokShopError(`Ressource TikTok introuvable : ${message}`, "not_found", code, false);
  if (status >= 500) return new TiktokShopError(`Erreur TikTok (${status}) : ${message}`, "server", code, true);
  return new TiktokShopError(`TikTok a refusé la requête : ${message}`, "validation", code, false);
}

const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Conversion défensive d'une commande 202309 (champs snake_case) vers le modèle Axi. */
export function parseOrder(raw: unknown): TiktokOrder {
  const o = obj(raw);
  const pay = obj(o.payment);
  const addr = obj(o.recipient_address);
  return {
    id: s(o.id),
    status: s(o.status),
    createTime: Number(o.create_time ?? 0),
    updateTime: Number(o.update_time ?? 0),
    fulfillmentType: s(o.fulfillment_type) || null,
    shippingType: s(o.shipping_type) || null,
    deliveryOptionId: s(o.delivery_option_id) || null,
    buyerMessage: s(o.buyer_message) || null,
    payment: {
      currency: s(pay.currency),
      subTotal: s(pay.sub_total) || "0",
      shippingFee: s(pay.shipping_fee) || "0",
      sellerDiscount: s(pay.seller_discount) || "0",
      platformDiscount: s(pay.platform_discount) || "0",
      tax: s(pay.tax) || "0",
      totalAmount: s(pay.total_amount) || "0",
    },
    recipient: { name: s(addr.name), phone: s(addr.phone_number), fullAddress: s(addr.full_address), regionCode: s(addr.region_code) || null },
    lineItems: arr(o.line_items).map((l) => ({
      id: s(l.id),
      skuId: s(l.sku_id),
      productId: s(l.product_id),
      sellerSku: s(l.seller_sku) || null,
      productName: s(l.product_name),
      skuName: s(l.sku_name) || null,
      salePrice: s(l.sale_price) || "0",
      originalPrice: s(l.original_price) || null,
      currency: s(l.currency) || s(pay.currency),
    })),
  };
}

function parseTokens(d: Record<string, unknown>, now: number): TokenSet {
  const accessToken = s(d.access_token);
  const refreshToken = s(d.refresh_token);
  if (!accessToken || !refreshToken) throw new TiktokShopError("Réponse de jeton TikTok incomplète", "auth");
  // `*_expire_in` est un horodatage UNIX absolu (secondes) ; repli prudent si absent.
  const abs = (v: unknown, fallbackMs: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n * 1000 : now + fallbackMs;
  };
  return {
    accessToken,
    accessTokenExpiresAt: abs(d.access_token_expire_in, 3600_000),
    refreshToken,
    refreshTokenExpiresAt: abs(d.refresh_token_expire_in, 30 * 86_400_000),
    openId: s(d.open_id) || null,
    sellerName: s(d.seller_name) || null,
    sellerBaseRegion: s(d.seller_base_region) || null,
    grantedScopes: Array.isArray(d.granted_scopes) ? d.granted_scopes.map(String) : [],
  };
}

function productBody(input: TiktokProductInput, withSkuIds: boolean) {
  return {
    title: input.title,
    description: input.description,
    category_id: input.categoryId,
    main_images: input.mainImageUris.map((uri) => ({ uri })),
    product_attributes: input.productAttributes.map((a) => ({ id: a.id, values: a.values.map((v) => (v.id ? { id: v.id } : { name: v.name })) })),
    package_weight: input.packageWeight,
    package_dimensions: input.packageDimensions,
    skus: input.skus.map((k) => ({
      ...(withSkuIds && k.id ? { id: k.id } : {}),
      seller_sku: k.sellerSku,
      price: k.price,
      inventory: k.inventory.map((i) => ({ warehouse_id: i.warehouseId, quantity: i.quantity })),
      sales_attributes: k.salesAttributes.map((a) => ({ name: a.name, value_name: a.valueName, ...(a.skuImgUri ? { sku_img: { uri: a.skuImgUri } } : {}) })),
    })),
  };
}

function parseProductResult(d: Record<string, unknown>, fallbackId?: string): TiktokProductResult {
  const productId = s(d.product_id) || fallbackId || "";
  if (!productId) throw new TiktokShopError("Réponse produit TikTok sans identifiant", "server", null, false);
  return { productId, skus: arr(d.skus).map((k) => ({ id: s(k.id), sellerSku: s(k.seller_sku) })) };
}

/** Requêtes bas niveau signées (partagées par l'authentification et les appels boutique). */
class Transport {
  readonly fetchImpl: FetchLike;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
  readonly maxRetries: number;

  constructor(readonly deps: ClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((u, i) => fetch(u, i));
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT;
    this.maxRetries = deps.maxRetries ?? 2;
  }

  async send<T>(p: { url: string; init: RequestInit; retry: boolean }): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(p.url, { ...p.init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        const err = new TiktokShopError(`TikTok injoignable : ${(e as Error).message}`, "network", null, true);
        if (p.retry && attempt < this.maxRetries) {
          await this.sleep(500 * 2 ** attempt++);
          continue;
        }
        throw err;
      }
      let body: Envelope<T> | null = null;
      try {
        body = (await res.json()) as Envelope<T>;
      } catch {
        body = null;
      }
      const code = typeof body?.code === "number" ? body.code : null;
      if (res.ok && code === 0) return (body?.data ?? ({} as T)) as T;
      const err = classify(res.status, code, String(body?.message ?? res.statusText ?? "réponse illisible").slice(0, 300));
      if (p.retry && err.retryable && attempt < this.maxRetries) {
        const after = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 500 * 2 ** attempt);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

export class TiktokShopAuthClient implements TiktokShopAuth {
  private t: Transport;
  constructor(deps: ClientDeps) {
    this.t = new Transport(deps);
  }

  private async token(params: Record<string, string>): Promise<TokenSet> {
    const u = new URL(`${AUTH_BASE}/api/v2/token/${params.grant_type === "refresh_token" ? "refresh" : "get"}`);
    u.searchParams.set("app_key", this.t.deps.platform.appKey);
    u.searchParams.set("app_secret", this.t.deps.platform.appSecret);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const data = await this.t.send<Record<string, unknown>>({ url: u.toString(), init: { method: "GET" }, retry: true });
    return parseTokens(data, this.t.now());
  }

  exchangeCode(authCode: string) {
    return this.token({ auth_code: authCode, grant_type: "authorized_code" });
  }

  refresh(refreshToken: string) {
    return this.token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  }
}

export class TiktokShopClient implements TiktokShopApi {
  private t: Transport;

  constructor(
    deps: ClientDeps,
    private readonly tokens: TokenProvider,
    private readonly shopCipher: string | null,
  ) {
    this.t = new Transport(deps);
  }

  /** Appel signé ; `shop` ajoute shop_cipher (obligatoire pour toute ressource de boutique). */
  async call<T>(method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; shop?: boolean; retry?: boolean; form?: FormData } = {}): Promise<T> {
    const doCall = async (accessToken: string) => {
      const query: Record<string, string> = { app_key: this.t.deps.platform.appKey, timestamp: String(Math.floor(this.t.now() / 1000)) };
      for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") query[k] = String(v);
      if (opts.shop !== false) {
        if (!this.shopCipher) throw new TiktokShopError("Aucune boutique TikTok sélectionnée", "config");
        query.shop_cipher = this.shopCipher;
      }
      const body = opts.form ? null : opts.body === undefined ? null : JSON.stringify(opts.body);
      const contentType = opts.form ? "multipart/form-data" : "application/json";
      query.sign = signRequest({ path, query, body, contentType, appSecret: this.t.deps.platform.appSecret });
      const url = `${API_BASE}${path}?${new URLSearchParams(query).toString()}`;
      const headers: Record<string, string> = { "x-tts-access-token": accessToken };
      // multipart : laisser fetch poser la frontière (boundary).
      if (!opts.form) headers["content-type"] = "application/json";
      return this.t.send<T>({ url, init: { method, headers, body: opts.form ?? body ?? undefined }, retry: opts.retry ?? method === "GET" });
    };
    try {
      return await doCall(await this.tokens.get());
    } catch (e) {
      if (e instanceof TiktokShopError && e.kind === "auth") return doCall(await this.tokens.refresh());
      throw e;
    }
  }

  async getAuthorizedShops(): Promise<TiktokShopInfo[]> {
    const d = await this.call<{ shops?: unknown }>("GET", "/authorization/202309/shops", { shop: false });
    return arr(d.shops).map((x) => ({ id: s(x.id), name: s(x.name), region: s(x.region), cipher: s(x.cipher), code: s(x.code) || null, sellerType: s(x.seller_type) || null }));
  }

  async getWarehouses(): Promise<TiktokWarehouse[]> {
    const d = await this.call<{ warehouses?: unknown }>("GET", "/logistics/202309/warehouses");
    return arr(d.warehouses).map((w) => ({ id: s(w.id), name: s(w.name), isDefault: w.is_default === true, type: s(w.type) }));
  }

  async searchCategories(keyword: string): Promise<TiktokCategory[]> {
    const d = await this.call<{ categories?: unknown }>("GET", "/product/202309/categories", { query: { keyword: keyword.trim() || undefined } });
    const all = arr(d.categories).map((c) => ({ id: s(c.id), name: s(c.local_name) || s(c.name), parentId: s(c.parent_id) || null, isLeaf: c.is_leaf === true }));
    const byId = new Map(all.map((c) => [c.id, c]));
    const pathOf = (c: { name: string; parentId: string | null }) => {
      const out = [c.name];
      let p = c.parentId ? byId.get(c.parentId) : undefined;
      for (let i = 0; p && i < 8; i++, p = p.parentId ? byId.get(p.parentId) : undefined) out.unshift(p.name);
      return out;
    };
    const k = keyword.trim().toLowerCase();
    return all
      .filter((c) => c.isLeaf && (!k || pathOf(c).join(" ").toLowerCase().includes(k)))
      .slice(0, 50)
      .map((c) => ({ ...c, path: pathOf(c) }));
  }

  async getCategoryAttributes(categoryId: string): Promise<TiktokAttribute[]> {
    const d = await this.call<{ attributes?: unknown }>("GET", `/product/202309/categories/${encodeURIComponent(categoryId)}/attributes`);
    return arr(d.attributes).map((a) => ({
      id: s(a.id),
      name: s(a.name),
      type: s(a.type) === "SALES_PROPERTY" ? "SALES_PROPERTY" : "PRODUCT_PROPERTY",
      // L'API publie le champ avec la coquille « is_requried » ; on accepte les deux orthographes.
      required: a.is_requried === true || a.is_required === true,
      multiple: a.is_multiple_selection === true,
      customizable: a.is_customizable === true,
      values: arr(a.values).map((v) => ({ id: s(v.id), name: s(v.name) })),
    }));
  }

  async uploadImage(bytes: Uint8Array, fileName: string): Promise<{ uri: string }> {
    const form = new FormData();
    form.set("data", new Blob([new Uint8Array(bytes)]), fileName);
    form.set("use_case", "MAIN_IMAGE");
    const d = await this.call<{ uri?: unknown }>("POST", "/product/202309/images/upload", { form, shop: false, retry: true });
    const uri = s(d.uri);
    if (!uri) throw new TiktokShopError("Téléversement d'image TikTok sans URI", "server", null, true);
    return { uri };
  }

  async findProductIdBySellerSkus(sellerSkus: string[]): Promise<string | null> {
    if (!sellerSkus.length) return null;
    const d = await this.call<{ products?: unknown }>("POST", "/product/202309/products/search", { query: { page_size: 10 }, body: { seller_skus: sellerSkus.slice(0, 20) }, retry: true });
    return s(arr(d.products)[0]?.id) || null;
  }

  async createProduct(input: TiktokProductInput): Promise<TiktokProductResult> {
    const d = await this.call<Record<string, unknown>>("POST", "/product/202309/products", { body: productBody(input, false), retry: false });
    return parseProductResult(d);
  }

  async updateProduct(productId: string, input: TiktokProductInput): Promise<TiktokProductResult> {
    const d = await this.call<Record<string, unknown>>("PUT", `/product/202309/products/${encodeURIComponent(productId)}`, { body: productBody(input, true), retry: false });
    return parseProductResult(d, productId);
  }

  async getProductStatus(productId: string): Promise<TiktokProductStatus> {
    const d = await this.call<Record<string, unknown>>("GET", `/product/202309/products/${encodeURIComponent(productId)}`);
    const reasons = arr(d.audit_failed_reasons).flatMap((r) => (Array.isArray(r.reasons) ? r.reasons.map(String) : []));
    return { productId, status: s(d.status) || "UNKNOWN", auditFailedReasons: reasons.slice(0, 10) };
  }

  async updateInventory(productId: string, skus: { id: string; warehouseId: string; quantity: number }[]): Promise<void> {
    // Remplacement de quantité : rejouable sans effet de bord, donc reprises autorisées.
    await this.call("POST", `/product/202309/products/${encodeURIComponent(productId)}/inventory/update`, {
      body: { skus: skus.map((k) => ({ id: k.id, inventory: [{ warehouse_id: k.warehouseId, quantity: k.quantity }] })) },
      retry: true,
    });
  }

  async searchOrders(p: { updateTimeGe: number; pageToken?: string | null; pageSize?: number }) {
    const d = await this.call<{ orders?: unknown; next_page_token?: unknown }>("POST", "/order/202309/orders/search", {
      query: { page_size: p.pageSize ?? 50, page_token: p.pageToken ?? undefined, sort_field: "update_time", sort_order: "ASC" },
      body: { update_time_ge: Math.floor(p.updateTimeGe / 1000) },
      retry: true,
    });
    return { orders: arr(d.orders).map(parseOrder), nextPageToken: s(d.next_page_token) || null };
  }

  async getOrders(ids: string[]): Promise<TiktokOrder[]> {
    if (!ids.length) return [];
    const d = await this.call<{ orders?: unknown }>("GET", "/order/202309/orders", { query: { ids: ids.slice(0, 50).join(",") } });
    return arr(d.orders).map(parseOrder);
  }

  async getShippingProviders(deliveryOptionId: string): Promise<TiktokShippingProvider[]> {
    const d = await this.call<{ shipping_providers?: unknown }>("GET", `/logistics/202309/delivery_options/${encodeURIComponent(deliveryOptionId)}/shipping_providers`);
    return arr(d.shipping_providers).map((x) => ({ id: s(x.id), name: s(x.name) }));
  }

  async markShipped(p: { orderId: string; lineItemIds: string[]; trackingNumber: string; shippingProviderId: string }) {
    const d = await this.call<{ package_id?: unknown }>("POST", `/fulfillment/202309/orders/${encodeURIComponent(p.orderId)}/packages`, {
      body: { order_line_item_ids: p.lineItemIds, tracking_number: p.trackingNumber, shipping_provider_id: p.shippingProviderId },
      retry: false,
    });
    return { packageId: s(d.package_id) || null };
  }
}
