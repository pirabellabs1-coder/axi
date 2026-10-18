/**
 * Contrat entre Axi et TikTok Shop (Open API 202309). Toutes les parties d'Axi passent par `TiktokShopApi` :
 * le client réel (`client.ts`) et le client simulé (`fake.ts`, `TIKTOK_SHOP_FAKE=1`, jamais en production)
 * l'implémentent à l'identique. Les montants TikTok sont des CHAÎNES décimales (« 12.50 ») dans la devise du marché.
 */

export type TokenSet = {
  accessToken: string;
  /** Expiration absolue (ms epoch). */
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  openId: string | null;
  sellerName: string | null;
  sellerBaseRegion: string | null;
  grantedScopes: string[];
};

export type TiktokShopInfo = { id: string; name: string; region: string; cipher: string; code: string | null; sellerType: string | null };

export type TiktokCategory = { id: string; name: string; parentId: string | null; isLeaf: boolean; path: string[] };

export type TiktokAttribute = {
  id: string;
  name: string;
  type: "PRODUCT_PROPERTY" | "SALES_PROPERTY";
  required: boolean;
  multiple: boolean;
  customizable: boolean;
  values: { id: string; name: string }[];
};

export type TiktokWarehouse = { id: string; name: string; isDefault: boolean; type: string };

export type TiktokProductSkuInput = {
  /** Présent en modification : identifiant SKU TikTok déjà attribué. */
  id?: string;
  sellerSku: string;
  price: { amount: string; currency: string };
  inventory: { warehouseId: string; quantity: number }[];
  salesAttributes: { name: string; valueName: string; skuImgUri?: string }[];
};

export type TiktokProductInput = {
  title: string;
  description: string;
  categoryId: string;
  mainImageUris: string[];
  skus: TiktokProductSkuInput[];
  productAttributes: { id: string; values: { id?: string; name?: string }[] }[];
  packageWeight: { value: string; unit: "KILOGRAM" };
  packageDimensions: { length: string; width: string; height: string; unit: "CENTIMETER" };
};

export type TiktokProductResult = { productId: string; skus: { id: string; sellerSku: string }[] };

export type TiktokProductStatus = {
  productId: string;
  /** DRAFT | PENDING | FAILED | ACTIVATE | SELLER_DEACTIVATED | PLATFORM_DEACTIVATED | FREEZE | DELETED */
  status: string;
  auditFailedReasons: string[];
};

export type TiktokOrderLineItem = {
  id: string;
  skuId: string;
  productId: string;
  sellerSku: string | null;
  productName: string;
  skuName: string | null;
  salePrice: string;
  originalPrice: string | null;
  currency: string;
};

export type TiktokOrder = {
  id: string;
  /** UNPAID | ON_HOLD | AWAITING_SHIPMENT | PARTIALLY_SHIPPING | AWAITING_COLLECTION | IN_TRANSIT | DELIVERED | COMPLETED | CANCELLED */
  status: string;
  createTime: number;
  updateTime: number;
  /** FULFILLMENT_BY_SELLER | FULFILLMENT_BY_TIKTOK */
  fulfillmentType: string | null;
  /** TIKTOK (étiquette fournie par TikTok) | SELLER (transporteur du vendeur) */
  shippingType: string | null;
  deliveryOptionId: string | null;
  buyerMessage: string | null;
  payment: {
    currency: string;
    subTotal: string;
    shippingFee: string;
    sellerDiscount: string;
    platformDiscount: string;
    tax: string;
    totalAmount: string;
  };
  recipient: { name: string; phone: string; fullAddress: string; regionCode: string | null };
  /** Une ligne PAR UNITÉ (modèle 202309) : on regroupe par SKU à l'import. */
  lineItems: TiktokOrderLineItem[];
};

export type TiktokShippingProvider = { id: string; name: string };

export class TiktokShopError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "rate_limit" | "validation" | "not_found" | "server" | "network" | "config",
    public readonly code: number | null = null,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "TiktokShopError";
  }
}

/** Opérations au nom d'une boutique (jeton + shop_cipher déjà connus par l'implémentation). */
export interface TiktokShopApi {
  getAuthorizedShops(): Promise<TiktokShopInfo[]>;
  getWarehouses(): Promise<TiktokWarehouse[]>;
  searchCategories(keyword: string): Promise<TiktokCategory[]>;
  getCategoryAttributes(categoryId: string): Promise<TiktokAttribute[]>;
  uploadImage(bytes: Uint8Array, fileName: string): Promise<{ uri: string }>;
  findProductIdBySellerSkus(sellerSkus: string[]): Promise<string | null>;
  createProduct(input: TiktokProductInput): Promise<TiktokProductResult>;
  updateProduct(productId: string, input: TiktokProductInput): Promise<TiktokProductResult>;
  getProductStatus(productId: string): Promise<TiktokProductStatus>;
  updateInventory(productId: string, skus: { id: string; warehouseId: string; quantity: number }[]): Promise<void>;
  searchOrders(p: { updateTimeGe: number; pageToken?: string | null; pageSize?: number }): Promise<{ orders: TiktokOrder[]; nextPageToken: string | null }>;
  getOrders(ids: string[]): Promise<TiktokOrder[]>;
  getShippingProviders(deliveryOptionId: string): Promise<TiktokShippingProvider[]>;
  markShipped(p: { orderId: string; lineItemIds: string[]; trackingNumber: string; shippingProviderId: string }): Promise<{ packageId: string | null }>;
}

/** Échange d'un code d'autorisation / rafraîchissement (hors boutique). */
export interface TiktokShopAuth {
  exchangeCode(authCode: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
}
