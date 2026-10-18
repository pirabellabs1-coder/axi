import { createHash } from "node:crypto";
import {
  TiktokShopError,
  type TiktokAttribute,
  type TiktokCategory,
  type TiktokOrder,
  type TiktokProductInput,
  type TiktokProductResult,
  type TiktokShopApi,
  type TiktokShopAuth,
  type TokenSet,
} from "./types";

/**
 * Client SIMULÉ (`TIKTOK_SHOP_FAKE=1`, jamais actif en production : voir `isFakeMode`). Même contrat que le client
 * réel, état en mémoire du processus. Sert au développement local, à la recette et aux tests : connexion sans compte
 * partenaire, catégories et attributs fictifs, produits « en revue » puis actifs, commandes injectables.
 */

type FakeProduct = { id: string; input: TiktokProductInput; skus: { id: string; sellerSku: string }[]; status: string; inventory: Map<string, number>; reads: number };

type FakeState = {
  seq: number;
  products: Map<string, FakeProduct>;
  orders: Map<string, TiktokOrder>;
  shipped: { orderId: string; lineItemIds: string[]; trackingNumber: string; shippingProviderId: string }[];
  images: number;
  refreshCount: number;
};

const g = globalThis as unknown as { __axiTiktokFake?: FakeState };

export function fakeState(): FakeState {
  return (g.__axiTiktokFake ??= { seq: 0, products: new Map(), orders: new Map(), shipped: [], images: 0, refreshCount: 0 });
}

export function resetFake(): void {
  g.__axiTiktokFake = undefined;
}

/** Injecte une commande (recette : « simuler une commande TikTok »). */
export function injectFakeOrder(order: TiktokOrder): void {
  fakeState().orders.set(order.id, order);
}

const CATEGORIES: TiktokCategory[] = [
  { id: "600001", name: "Femme", parentId: null, isLeaf: false, path: ["Femme"] },
  { id: "601226", name: "Robes", parentId: "600001", isLeaf: true, path: ["Femme", "Robes"] },
  { id: "601227", name: "Hauts et t-shirts", parentId: "600001", isLeaf: true, path: ["Femme", "Hauts et t-shirts"] },
  { id: "700002", name: "Beauté", parentId: null, isLeaf: false, path: ["Beauté"] },
  { id: "700645", name: "Soins du visage", parentId: "700002", isLeaf: true, path: ["Beauté", "Soins du visage"] },
  { id: "800003", name: "Maison", parentId: null, isLeaf: false, path: ["Maison"] },
  { id: "800120", name: "Décoration", parentId: "800003", isLeaf: true, path: ["Maison", "Décoration"] },
];

const ATTRIBUTES: TiktokAttribute[] = [
  { id: "100198", name: "Marque", type: "PRODUCT_PROPERTY", required: false, multiple: false, customizable: true, values: [] },
  { id: "100347", name: "Matière", type: "PRODUCT_PROPERTY", required: true, multiple: true, customizable: true, values: [{ id: "1000058", name: "Coton" }, { id: "1000059", name: "Polyester" }, { id: "1000060", name: "Wax" }] },
  { id: "100000", name: "Couleur", type: "SALES_PROPERTY", required: false, multiple: false, customizable: true, values: [] },
];

const id = (prefix: string) => `${prefix}${String(1_700_000_000_000 + ++fakeState().seq)}`;

export function fakeTokens(seed: string, now = Date.now()): TokenSet {
  const h = createHash("sha256").update(`${seed}:${now}`).digest("hex");
  return {
    accessToken: `fake_at_${h.slice(0, 24)}`,
    accessTokenExpiresAt: now + 7 * 86_400_000,
    refreshToken: `fake_rt_${h.slice(24, 48)}`,
    refreshTokenExpiresAt: now + 365 * 86_400_000,
    openId: "fake_open_id",
    sellerName: "Boutique de démonstration",
    sellerBaseRegion: "FR",
    grantedScopes: ["seller.authorization.info", "seller.product.basic", "seller.product.write", "seller.order.info", "seller.fulfillment.basic", "seller.logistics"],
  };
}

export class FakeTiktokShopAuth implements TiktokShopAuth {
  async exchangeCode(authCode: string): Promise<TokenSet> {
    if (!authCode || authCode === "invalid") throw new TiktokShopError("Code d'autorisation invalide", "auth");
    return fakeTokens(authCode);
  }
  async refresh(refreshToken: string): Promise<TokenSet> {
    if (!refreshToken.startsWith("fake_rt_")) throw new TiktokShopError("Jeton de rafraîchissement invalide", "auth");
    fakeState().refreshCount++;
    return fakeTokens(refreshToken);
  }
}

export class FakeTiktokShopClient implements TiktokShopApi {
  async getAuthorizedShops() {
    return [
      { id: "7495000000000000001", name: "Ma boutique TikTok (FR)", region: "FR", cipher: "fake_cipher_fr", code: "FRLCX1", sellerType: "LOCAL" },
      { id: "7495000000000000002", name: "Ma boutique TikTok (UK)", region: "GB", cipher: "fake_cipher_gb", code: "GBLCX2", sellerType: "LOCAL" },
    ];
  }
  async getWarehouses() {
    return [{ id: "7300000000000000001", name: "Entrepôt principal", isDefault: true, type: "SALES_WAREHOUSE" }];
  }
  async searchCategories(keyword: string) {
    const k = keyword.trim().toLowerCase();
    return CATEGORIES.filter((c) => c.isLeaf && (!k || c.path.join(" ").toLowerCase().includes(k)));
  }
  async getCategoryAttributes(categoryId: string) {
    if (!CATEGORIES.some((c) => c.id === categoryId && c.isLeaf)) throw new TiktokShopError("Catégorie inconnue", "validation");
    return ATTRIBUTES;
  }
  async uploadImage() {
    fakeState().images++;
    return { uri: `tos-fake/${id("img")}` };
  }
  async findProductIdBySellerSkus(sellerSkus: string[]) {
    for (const p of fakeState().products.values()) if (p.skus.some((k) => sellerSkus.includes(k.sellerSku))) return p.id;
    return null;
  }
  private validate(input: TiktokProductInput) {
    if (!input.mainImageUris.length) throw new TiktokShopError("Au moins une image est requise", "validation");
    if (!input.skus.length) throw new TiktokShopError("Au moins un SKU est requis", "validation");
    const required = ATTRIBUTES.filter((a) => a.required && a.type === "PRODUCT_PROPERTY").map((a) => a.id);
    for (const r of required) if (!input.productAttributes.some((a) => a.id === r && a.values.length)) throw new TiktokShopError(`Attribut obligatoire manquant : ${r}`, "validation");
  }
  async createProduct(input: TiktokProductInput): Promise<TiktokProductResult> {
    this.validate(input);
    const p: FakeProduct = { id: id("17"), input, skus: input.skus.map((k) => ({ id: id("17"), sellerSku: k.sellerSku })), status: "PENDING", inventory: new Map(), reads: 0 };
    input.skus.forEach((k, i) => p.inventory.set(p.skus[i].id, k.inventory[0]?.quantity ?? 0));
    fakeState().products.set(p.id, p);
    return { productId: p.id, skus: p.skus };
  }
  async updateProduct(productId: string, input: TiktokProductInput): Promise<TiktokProductResult> {
    const p = fakeState().products.get(productId);
    if (!p) throw new TiktokShopError("Produit introuvable", "not_found");
    this.validate(input);
    p.input = input;
    p.skus = input.skus.map((k) => ({ id: k.id ?? id("17"), sellerSku: k.sellerSku }));
    p.status = "PENDING";
    return { productId, skus: p.skus };
  }
  async getProductStatus(productId: string) {
    const p = fakeState().products.get(productId);
    if (!p) throw new TiktokShopError("Produit introuvable", "not_found");
    // Revue simulée : le produit devient actif à la deuxième lecture.
    if (p.status === "PENDING" && ++p.reads >= 2) p.status = "ACTIVATE";
    return { productId, status: p.status, auditFailedReasons: [] };
  }
  async updateInventory(productId: string, skus: { id: string; warehouseId: string; quantity: number }[]) {
    const p = fakeState().products.get(productId);
    if (!p) throw new TiktokShopError("Produit introuvable", "not_found");
    for (const k of skus) p.inventory.set(k.id, k.quantity);
  }
  async searchOrders(p: { updateTimeGe: number }) {
    const orders = [...fakeState().orders.values()].filter((o) => o.updateTime * 1000 >= p.updateTimeGe);
    return { orders, nextPageToken: null };
  }
  async getOrders(ids: string[]) {
    return ids.map((i) => fakeState().orders.get(i)).filter((o): o is TiktokOrder => !!o);
  }
  async getShippingProviders() {
    return [
      { id: "6617675021119438849", name: "Colissimo" },
      { id: "6617675021119438850", name: "Chronopost" },
      { id: "6617675021119438851", name: "DHL" },
    ];
  }
  async markShipped(p: { orderId: string; lineItemIds: string[]; trackingNumber: string; shippingProviderId: string }) {
    const order = fakeState().orders.get(p.orderId);
    if (!order) throw new TiktokShopError("Commande introuvable", "not_found");
    fakeState().shipped.push(p);
    order.status = "IN_TRANSIT";
    return { packageId: id("pkg") };
  }
}
