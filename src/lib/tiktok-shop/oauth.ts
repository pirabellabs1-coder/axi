import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAppSecret } from "@/lib/crypto";
import { TiktokShopClient } from "./client";
import { isFakeMode, platformConfig, TIKTOK_SHOP_KIND } from "./config";
import { authClient, loadIntegration, sealTokens, tokenMeta, updateConfig } from "./connection";
import { FakeTiktokShopClient } from "./fake";
import { marketFor, marketNames } from "./markets";
import { DEFAULT_SETTINGS, readConfig, type TtsConfig } from "./model";
import { createState, verifyState } from "./state";
import { TiktokShopError, type TiktokShopApi, type TiktokShopInfo } from "./types";

/**
 * Autorisation vendeur TikTok Shop (OAuth « service » du Partner Center) :
 *  1. `/api/tiktok-shop/connect?storeId=…` : membre avec `integrations.manage` → state signé + cookie nonce →
 *     redirection vers services.tiktokshop.com/open/authorize?service_id=…&state=… ;
 *  2. TikTok redirige vers l'URL de callback déclarée (`/api/tiktok-shop/callback?code=…&state=…`) ;
 *  3. state vérifié (signature, expiration, nonce du cookie, MÊME utilisateur connecté), capacité revérifiée sur la
 *     boutique, code échangé contre les jetons (chiffrés), boutiques autorisées listées.
 */

export function stateKey(): string {
  return requireAppSecret();
}

export function beginAuthorization(p: { storeId: string; userId: string }): { state: string; nonce: string } {
  return createState(stateKey(), p);
}

export function checkState(raw: string | null, cookieNonce: string | null | undefined, userId: string | null | undefined) {
  return verifyState(stateKey(), raw, { cookieNonce, userId });
}

/** Client lié à un jeton fraîchement obtenu (avant enregistrement), éventuellement à une boutique. */
function transientApi(accessToken: string, cipher: string | null): TiktokShopApi {
  if (isFakeMode()) return new FakeTiktokShopClient();
  const platform = platformConfig();
  if (!platform) throw new TiktokShopError("TikTok Shop n'est pas configuré", "config");
  return new TiktokShopClient({ platform }, { get: async () => accessToken, refresh: async () => accessToken }, cipher);
}

/** Une boutique TikTok ne peut être reliée qu'à une seule boutique Axi (routage des webhooks sans ambiguïté). */
async function shopTakenElsewhere(storeId: string, shopId: string): Promise<boolean> {
  const other = await db.integration.findFirst({
    where: { kind: TIKTOK_SHOP_KIND, storeId: { not: storeId }, status: { in: ["active", "pending", "error"] }, config: { path: ["shop", "id"], equals: shopId } },
    select: { id: true },
  });
  return !!other;
}

export type ConnectOutcome = { ok: true; status: "active" | "choose_shop" } | { ok: false; error: string };

export async function completeAuthorization(p: { storeId: string; userId: string; code: string }): Promise<ConnectOutcome> {
  const tokens = await authClient().exchangeCode(p.code);
  const api = transientApi(tokens.accessToken, null);
  const all = await api.getAuthorizedShops();
  const shops = all.filter((s) => s.id && s.cipher && marketFor(s.region));

  const previous = await loadIntegration(p.storeId);
  const base: TtsConfig = previous ? previous.config : readConfig({ settings: DEFAULT_SETTINGS });
  const keepShop = base.shop && shops.some((s) => s.id === base.shop!.id) ? base.shop : null;
  const config: TtsConfig = {
    ...base,
    // Changement de boutique TikTok : les liens produits et images de l'ancienne n'ont plus de sens.
    ...(keepShop ? {} : { shop: null, warehouseId: null, products: {}, imageUris: {}, orders: { lastPullAt: null, lastImportAt: null, imported: base.orders.imported } }),
    shops: shops.map((s) => ({ id: s.id, name: s.name.slice(0, 120), region: s.region, cipher: s.cipher })),
    tokens: tokenMeta(tokens),
    connectedAt: Date.now(),
    connectedBy: p.userId,
  };
  const noMarket = shops.length === 0;
  const lastError = noMarket
    ? all.length
      ? `Votre boutique TikTok est enregistrée dans un marché non pris en charge (${all.map((s) => s.region).join(", ")}).`
      : `Aucune boutique TikTok Shop n'est rattachée à ce compte. TikTok Shop est ouvert dans : ${marketNames()}.`
    : null;
  await db.integration.upsert({
    where: { storeId_kind: { storeId: p.storeId, kind: TIKTOK_SHOP_KIND } },
    create: { storeId: p.storeId, kind: TIKTOK_SHOP_KIND, status: noMarket ? "error" : "pending", config: config as unknown as Prisma.InputJsonValue, secretsEncrypted: sealTokens(tokens), lastError },
    update: { status: noMarket ? "error" : keepShop ? "active" : "pending", config: config as unknown as Prisma.InputJsonValue, secretsEncrypted: sealTokens(tokens), lastError },
  });
  await audit({ storeId: p.storeId, actorId: p.userId, action: "tiktok_shop.connected", metadata: { shops: shops.map((s) => `${s.region}:${s.id}`), scopes: tokens.grantedScopes.slice(0, 20) } });
  if (noMarket) return { ok: false, error: lastError! };
  if (keepShop) return { ok: true, status: "active" };
  if (shops.length === 1) {
    const r = await activateShop(p.storeId, shops[0], p.userId, transientApi(tokens.accessToken, shops[0].cipher));
    return r.ok ? { ok: true, status: "active" } : r;
  }
  return { ok: true, status: "choose_shop" };
}

/** Active une boutique TikTok autorisée : contrôle d'unicité, entrepôt de vente par défaut, devise du marché. */
export async function activateShop(storeId: string, shop: Pick<TiktokShopInfo, "id" | "name" | "region" | "cipher">, actorId: string, api: TiktokShopApi): Promise<{ ok: true } | { ok: false; error: string }> {
  const market = marketFor(shop.region);
  if (!market) return { ok: false, error: `Le marché ${shop.region} n'est pas pris en charge. TikTok Shop est ouvert dans : ${marketNames()}.` };
  if (await shopTakenElsewhere(storeId, shop.id)) return { ok: false, error: "Cette boutique TikTok Shop est déjà reliée à une autre boutique Axi." };
  const warehouses = await api.getWarehouses();
  const warehouse = warehouses.find((w) => w.isDefault && w.type !== "RETURN_WAREHOUSE") ?? warehouses.find((w) => w.type !== "RETURN_WAREHOUSE") ?? null;
  // Contrôle d'unicité + écriture ATOMIQUES : verrou consultatif par boutique TikTok, tenu jusqu'à la fin de la
  // transaction ; deux boutiques Axi qui choisissent le même shop en même temps sont sérialisées.
  const claimed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tts:${shop.id}`}))`;
    if (await shopTakenElsewhere(storeId, shop.id)) return false;
    await updateConfig(
      storeId,
      (c) => ({
        ...c,
        shop: { id: shop.id, name: shop.name.slice(0, 120), region: market.region, cipher: shop.cipher, currency: market.currency },
        warehouseId: warehouse?.id ?? null,
        ...(c.shop && c.shop.id !== shop.id ? { products: {}, imageUris: {}, orders: { ...c.orders, lastPullAt: null } } : {}),
      }),
      () => ({ status: "active", lastError: warehouse ? null : "Aucun entrepôt d'expédition dans votre boutique TikTok : créez-en un dans Seller Center." }),
    );
    return true;
  });
  if (!claimed) return { ok: false, error: "Cette boutique TikTok Shop est déjà reliée à une autre boutique Axi." };
  await audit({ storeId, actorId, action: "tiktok_shop.shop_selected", metadata: { shopId: shop.id, region: market.region } });
  return { ok: true };
}
