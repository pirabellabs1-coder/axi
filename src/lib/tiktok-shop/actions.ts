"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { requireStore } from "@/lib/auth/permissions";
import { badIds, fail, guard, parseForm, success, zBool, type ActionResult } from "@/lib/action";
import { TIKTOK_SHOP_KIND } from "./config";
import { apiFor, loadIntegration, updateConfig } from "./connection";
import { eligibilityErrors } from "./mapping";
import { emptyLink, linkOf, MAX_LINKED_PRODUCTS } from "./model";
import { activateShop } from "./oauth";
import { loadProductForSync, publishProduct } from "./sync";
import { TiktokShopError } from "./types";

/**
 * Actions de l'écran Intégrations → TikTok Shop. Connexion (boutique, réglages, déconnexion) : `integrations.manage` ;
 * produits (catégorie, attributs, publication) : `products.manage`. Toute lecture / écriture est filtrée par la
 * boutique du contexte (`ctx.store.id`) ; un produit d'une autre boutique est introuvable.
 */

const page = (storeId: string) => `/app/${storeId}/integrations/tiktok-shop`;
const zId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Identifiant invalide");
const zTtsId = z.string().regex(/^\d{1,32}$/, "Identifiant TikTok invalide");

/** Erreur TikTok → message lisible ; le reste passe par `guard`. */
async function tts<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  return guard(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof TiktokShopError) return fail(e.message);
      throw e;
    }
  });
}

export async function selectTiktokShop(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return tts(async () => {
    const parsed = parseForm(z.object({ storeId: zId, shopId: zTtsId }), formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "integrations.manage");
    const current = await loadIntegration(ctx.store.id);
    const shop = current?.config.shops.find((s) => s.id === parsed.data.shopId);
    if (!current || !shop) return fail("Boutique TikTok inconnue : reconnectez TikTok Shop.");
    const { api } = await apiFor(ctx.store.id, { requireShop: false });
    // Client dédié au cipher choisi : on relit les entrepôts de CETTE boutique.
    const scoped = await scopedApi(ctx.store.id, shop.cipher, api);
    const r = await activateShop(ctx.store.id, shop, ctx.user.id, scoped);
    if (!r.ok) return fail(r.error);
    revalidatePath(page(ctx.store.id));
    return success(undefined, "Boutique TikTok Shop activée");
  });
}

async function scopedApi(storeId: string, cipher: string, fallback: Awaited<ReturnType<typeof apiFor>>["api"]) {
  const { isFakeMode, platformConfig } = await import("./config");
  if (isFakeMode()) return fallback;
  const platform = platformConfig();
  if (!platform) throw new TiktokShopError("TikTok Shop n'est pas configuré sur la plateforme", "config");
  const { TiktokShopClient } = await import("./client");
  const { tokenProvider } = await import("./connection");
  return new TiktokShopClient({ platform }, tokenProvider(storeId), cipher);
}

const settingsSchema = z.object({
  storeId: zId,
  markupPercent: z.coerce.number().min(0, "Entre 0 et 50 %").max(50, "Entre 0 et 50 %"),
  defaultWeightGrams: z.coerce.number().int().min(1, "Poids invalide").max(100_000, "Poids invalide"),
  lengthCm: z.coerce.number().int().min(1).max(300),
  widthCm: z.coerce.number().int().min(1).max(300),
  heightCm: z.coerce.number().int().min(1).max(300),
  untrackedQuantity: z.coerce.number().int().min(0).max(9999),
  enabled: zBool,
});

export async function saveTiktokSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return tts(async () => {
    const parsed = parseForm(settingsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "integrations.manage");
    await updateConfig(ctx.store.id, (c) => ({
      ...c,
      settings: { markupBps: Math.round(d.markupPercent * 100), defaultWeightGrams: d.defaultWeightGrams, lengthCm: d.lengthCm, widthCm: d.widthCm, heightCm: d.heightCm, untrackedQuantity: d.untrackedQuantity, enabled: d.enabled },
    }));
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "tiktok_shop.settings", metadata: { markupPercent: d.markupPercent, enabled: d.enabled } });
    revalidatePath(page(ctx.store.id));
    return success(undefined, "Réglages enregistrés. Republiez vos produits pour appliquer un nouveau prix.");
  });
}

/** Déconnexion : jetons effacés, connexion désactivée. Les produits restent sur TikTok (gérés dans Seller Center). */
export async function disconnectTiktokShop(storeId: string): Promise<ActionResult> {
  return tts(async () => {
    if (badIds(storeId)) return fail("Requête invalide");
    const ctx = await requireStore(storeId, "integrations.manage");
    await db.integration.updateMany({
      where: { storeId: ctx.store.id, kind: TIKTOK_SHOP_KIND },
      data: { status: "inactive", secretsEncrypted: null, lastError: null },
    });
    await updateConfig(ctx.store.id, (c) => ({ ...c, shop: null, shops: [], warehouseId: null, tokens: { accessExpiresAt: null, refreshExpiresAt: null, openId: null, sellerName: null, sellerBaseRegion: null, scopes: [] } })).catch(() => {});
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "tiktok_shop.disconnected" });
    revalidatePath(page(ctx.store.id));
    return success(undefined, "TikTok Shop déconnecté. Pensez aussi à retirer l'autorisation d'Axi dans TikTok Seller Center.");
  });
}

export async function syncTiktokNow(storeId: string): Promise<ActionResult> {
  return tts(async () => {
    if (badIds(storeId)) return fail("Requête invalide");
    const ctx = await requireStore(storeId, "integrations.manage");
    const { requestStockSync } = await import("./sync");
    await requestStockSync(ctx.store.id);
    return success(undefined, "Synchronisation lancée : commandes, stock et expéditions dans un instant.");
  });
}

export async function setTiktokCategory(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return tts(async () => {
    const parsed = parseForm(z.object({ storeId: zId, productId: zId, categoryId: zTtsId, categoryName: z.string().trim().min(1).max(300) }), formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    const product = await loadProductForSync(ctx.store.id, d.productId);
    if (!product) return fail("Produit introuvable.");
    const blockers = eligibilityErrors(product);
    if (blockers.length) return fail(blockers.join(" "));
    const { api, config } = await apiFor(ctx.store.id);
    // Catégorie feuille valide pour cette boutique : l'API d'attributs la refuse sinon.
    await api.getCategoryAttributes(d.categoryId);
    if (!linkOf(config, d.productId) && Object.keys(config.products).length >= MAX_LINKED_PRODUCTS) return fail(`Limite de ${MAX_LINKED_PRODUCTS} produits reliés atteinte.`);
    await updateConfig(ctx.store.id, (c) => {
      const prev = linkOf(c, d.productId);
      c.products[d.productId] = prev ? { ...prev, categoryId: d.categoryId, categoryName: d.categoryName, attributes: prev.categoryId === d.categoryId ? prev.attributes : [] } : emptyLink(d.categoryId, d.categoryName);
      return c;
    });
    revalidatePath(page(ctx.store.id));
    return success(undefined, "Catégorie TikTok enregistrée");
  });
}

export async function saveTiktokAttributes(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return tts(async () => {
    const storeId = String(formData.get("storeId") ?? "");
    const productId = String(formData.get("productId") ?? "");
    if (!zId.safeParse(storeId).success || !zId.safeParse(productId).success) return fail("Requête invalide");
    const ctx = await requireStore(storeId, "products.manage");
    // Le produit doit appartenir à CETTE boutique avant toute lecture/écriture de la configuration.
    if (!(await loadProductForSync(ctx.store.id, productId))) return fail("Produit introuvable.");
    const { api, config } = await apiFor(ctx.store.id);
    const link = linkOf(config, productId);
    if (!link) return fail("Choisissez d'abord une catégorie.");
    const attributes = (await api.getCategoryAttributes(link.categoryId)).filter((a) => a.type === "PRODUCT_PROPERTY");
    const out: { id: string; values: { id?: string; name?: string }[] }[] = [];
    const fieldErrors: Record<string, string[]> = {};
    for (const a of attributes) {
      const chosen = formData.getAll(`attr_${a.id}`).map(String).filter(Boolean).slice(0, a.multiple ? 20 : 1);
      const custom = String(formData.get(`attr_${a.id}_custom`) ?? "").trim().slice(0, 120);
      const values: { id?: string; name?: string }[] = [];
      for (const v of chosen) if (a.values.some((x) => x.id === v)) values.push({ id: v });
      if (custom && a.customizable) values.push({ name: custom });
      if (a.required && !values.length) fieldErrors[`attr_${a.id}`] = [`« ${a.name} » est obligatoire`];
      if (values.length) out.push({ id: a.id, values: a.multiple ? values : values.slice(0, 1) });
    }
    if (Object.keys(fieldErrors).length) return fail("Renseignez les attributs obligatoires.", fieldErrors);
    await updateConfig(ctx.store.id, (c) => {
      if (linkOf(c, productId)) c.products[productId].attributes = out;
      return c;
    });
    revalidatePath(`${page(ctx.store.id)}/produits/${productId}`);
    return success(undefined, "Attributs enregistrés");
  });
}

/** Publication immédiate ; une erreur passagère (réseau, quota, taux) bascule sur un job retenté. */
export async function publishTiktokProduct(storeId: string, productId: string): Promise<ActionResult> {
  return tts(async () => {
    if (badIds(storeId, productId)) return fail("Requête invalide");
    const ctx = await requireStore(storeId, "products.manage");
    if (!(await loadProductForSync(ctx.store.id, productId))) return fail("Produit introuvable.");
    try {
      const r = await publishProduct(ctx.store.id, productId);
      revalidatePath(page(ctx.store.id));
      if (!r.ok) return fail(r.error ?? "Publication impossible");
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "tiktok_shop.product_published", target: productId });
      return success(undefined, "Produit envoyé à TikTok : il passe en revue (quelques heures en général).");
    } catch (e) {
      if (e instanceof TiktokShopError && e.retryable) {
        await enqueue("tiktok_shop.publish", { storeId: ctx.store.id, productId }, { storeId: ctx.store.id });
        return success(undefined, "TikTok ne répond pas pour l'instant : la publication sera retentée automatiquement.");
      }
      throw e;
    }
  });
}

/** Retire le lien : quantité 0 sur TikTok (le produit n'est plus achetable), lien supprimé dans Axi. */
export async function unlinkTiktokProduct(storeId: string, productId: string): Promise<ActionResult> {
  return tts(async () => {
    if (badIds(storeId, productId)) return fail("Requête invalide");
    const ctx = await requireStore(storeId, "products.manage");
    const { api, config } = await apiFor(ctx.store.id);
    const link = linkOf(config, productId);
    if (!link) return fail("Ce produit n'est pas relié à TikTok.");
    if (link.tiktokProductId && config.warehouseId && Object.keys(link.skus).length) {
      await api.updateInventory(link.tiktokProductId, Object.values(link.skus).map((id) => ({ id, warehouseId: config.warehouseId!, quantity: 0 })));
    }
    await updateConfig(ctx.store.id, (c) => {
      if (Object.hasOwn(c.products, productId)) delete c.products[productId];
      return c;
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "tiktok_shop.product_unlinked", target: productId });
    revalidatePath(page(ctx.store.id));
    return success(undefined, "Produit retiré de TikTok Shop (stock à zéro). Supprimez-le dans Seller Center si besoin.");
  });
}
