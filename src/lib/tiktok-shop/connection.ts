import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { TiktokShopAuthClient, TiktokShopClient, type TokenProvider } from "./client";
import { isFakeMode, platformConfig, TIKTOK_SHOP_KIND } from "./config";
import { FakeTiktokShopAuth, FakeTiktokShopClient } from "./fake";
import { readConfig, type TtsConfig } from "./model";
import { TiktokShopError, type TiktokShopApi, type TiktokShopAuth, type TokenSet } from "./types";

export { readConfig, type TtsConfig } from "./model";

/**
 * Connexion d'une boutique Axi à TikTok Shop, stockée dans `Integration` (kind = "tiktok_shop") :
 *  - `config` (JSON, non secret) : boutique TikTok choisie, entrepôt, réglages, échéances des jetons, liens produits ;
 *  - `secretsEncrypted` : `{ accessToken, refreshToken }` chiffrés (AES-256-GCM, `encryptSecret`), jamais renvoyés au client.
 * Toute lecture est filtrée par `storeId` (clé unique storeId + kind).
 *
 * Concurrence : `config` est modifié par verrou OPTIMISTE sur `updatedAt` (webhooks, jobs et écrans écrivent en
 * parallèle) : relecture et nouvel essai en cas de conflit, jamais d'écrasement silencieux.
 */

export type IntegrationRow = { id: string; storeId: string; status: string; config: unknown; secretsEncrypted: string | null; updatedAt: Date; lastError: string | null };

export async function loadIntegration(storeId: string): Promise<{ row: IntegrationRow; config: TtsConfig } | null> {
  const row = await db.integration.findUnique({
    where: { storeId_kind: { storeId, kind: TIKTOK_SHOP_KIND } },
    select: { id: true, storeId: true, status: true, config: true, secretsEncrypted: true, updatedAt: true, lastError: true },
  });
  return row ? { row, config: readConfig(row.config) } : null;
}

/**
 * Modifie `config` (et éventuellement d'autres colonnes) sous verrou optimiste. `mutate` reçoit une copie et la
 * retourne ; il peut être rejoué (fonction pure de la config lue).
 */
export async function updateConfig(
  storeId: string,
  mutate: (c: TtsConfig, row: IntegrationRow) => TtsConfig,
  extra: (c: TtsConfig) => Partial<{ status: string; lastError: string | null; secretsEncrypted: string | null }> = () => ({}),
): Promise<TtsConfig> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await loadIntegration(storeId);
    if (!current) throw new TiktokShopError("TikTok Shop n'est pas connecté à cette boutique", "config");
    // Copie fraîche via readConfig (et non structuredClone) : `products` reste un objet sans prototype.
    const next = mutate(readConfig(current.row.config), current.row);
    const done = await db.integration.updateMany({
      where: { id: current.row.id, storeId, kind: TIKTOK_SHOP_KIND, updatedAt: current.row.updatedAt },
      data: { config: next as unknown as Prisma.InputJsonValue, ...extra(next) },
    });
    if (done.count === 1) return next;
  }
  throw new TiktokShopError("Modification concurrente de la connexion TikTok Shop, réessayez", "server", null, true);
}

type Secrets = { accessToken: string; refreshToken: string };

export function sealTokens(t: Pick<TokenSet, "accessToken" | "refreshToken">): string {
  return encryptSecret(JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken }));
}

function openTokens(sealed: string | null): Secrets {
  if (!sealed) throw new TiktokShopError("Jetons TikTok absents : reconnectez la boutique", "auth");
  const s = JSON.parse(decryptSecret(sealed)) as Partial<Secrets>;
  if (!s.accessToken || !s.refreshToken) throw new TiktokShopError("Jetons TikTok illisibles : reconnectez la boutique", "auth");
  return { accessToken: s.accessToken, refreshToken: s.refreshToken };
}

export function authClient(): TiktokShopAuth {
  if (isFakeMode()) return new FakeTiktokShopAuth();
  const platform = platformConfig();
  if (!platform) throw new TiktokShopError("TikTok Shop n'est pas configuré sur la plateforme (TIKTOK_SHOP_APP_KEY)", "config");
  return new TiktokShopAuthClient({ platform });
}

/** Marge avant expiration : on rafraîchit 5 minutes avant l'échéance. */
export const REFRESH_SKEW_MS = 5 * 60_000;

export function needsRefresh(accessExpiresAt: number | null | undefined, now = Date.now()): boolean {
  return !accessExpiresAt || accessExpiresAt - now <= REFRESH_SKEW_MS;
}

/**
 * Rafraîchit les jetons d'une boutique. Deux processus concurrents : le perdant du verrou optimiste relit le jeton
 * écrit par le gagnant (pas de double rafraîchissement persistant). Jeton de rafraîchissement refusé : intégration
 * en erreur, le marchand doit reconnecter (message affiché dans l'écran).
 */
export async function refreshTokens(storeId: string, auth: TiktokShopAuth = authClient(), now = Date.now()): Promise<string> {
  // Jetons connus de l'appelant AVANT le verrou : s'ils ont changé une fois le verrou obtenu, un autre processus vient
  // de rafraîchir et son jeton fait foi (un seul appel de rafraîchissement concurrent par boutique).
  const before = await loadIntegration(storeId);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tts:refresh:${storeId}`}))`;
      return refreshLocked(storeId, auth, now, before?.row.secretsEncrypted ?? null);
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function refreshLocked(storeId: string, auth: TiktokShopAuth, now: number, sealedBefore: string | null): Promise<string> {
  const current = await loadIntegration(storeId);
  if (!current) throw new TiktokShopError("TikTok Shop n'est pas connecté", "config");
  if (sealedBefore && current.row.secretsEncrypted && current.row.secretsEncrypted !== sealedBefore && !needsRefresh(current.config.tokens.accessExpiresAt, now)) {
    return openTokens(current.row.secretsEncrypted).accessToken;
  }
  const secrets = openTokens(current.row.secretsEncrypted);
  if (current.config.tokens.refreshExpiresAt && current.config.tokens.refreshExpiresAt <= now) {
    await markAuthError(storeId, "Autorisation TikTok expirée : reconnectez votre boutique TikTok Shop.");
    throw new TiktokShopError("Autorisation TikTok expirée", "auth");
  }
  let fresh: TokenSet;
  try {
    fresh = await auth.refresh(secrets.refreshToken);
  } catch (e) {
    if (e instanceof TiktokShopError && (e.kind === "auth" || e.kind === "validation")) {
      await markAuthError(storeId, "TikTok a refusé le renouvellement de l'autorisation : reconnectez votre boutique TikTok Shop.");
    }
    throw e;
  }
  const done = await db.integration.updateMany({
    where: { id: current.row.id, storeId, updatedAt: current.row.updatedAt },
    data: {
      secretsEncrypted: sealTokens(fresh),
      config: { ...current.config, tokens: tokenMeta(fresh) } as unknown as Prisma.InputJsonValue,
      lastError: null,
    },
  });
  if (done.count === 1) return fresh.accessToken;
  // Un autre processus a écrit entre-temps : son jeton fait foi s'il est valide.
  const again = await loadIntegration(storeId);
  if (again && !needsRefresh(again.config.tokens.accessExpiresAt, now)) return openTokens(again.row.secretsEncrypted).accessToken;
  return fresh.accessToken;
}

export function tokenMeta(t: TokenSet): TtsConfig["tokens"] {
  return {
    accessExpiresAt: t.accessTokenExpiresAt,
    refreshExpiresAt: t.refreshTokenExpiresAt,
    openId: t.openId,
    sellerName: t.sellerName,
    sellerBaseRegion: t.sellerBaseRegion,
    scopes: t.grantedScopes.slice(0, 50),
  };
}

async function markAuthError(storeId: string, message: string) {
  await db.integration.updateMany({ where: { storeId, kind: TIKTOK_SHOP_KIND }, data: { status: "error", lastError: message } });
}

export function tokenProvider(storeId: string, auth?: TiktokShopAuth): TokenProvider {
  return {
    async get() {
      const current = await loadIntegration(storeId);
      if (!current) throw new TiktokShopError("TikTok Shop n'est pas connecté", "config");
      if (needsRefresh(current.config.tokens.accessExpiresAt)) return refreshTokens(storeId, auth);
      return openTokens(current.row.secretsEncrypted).accessToken;
    },
    refresh: () => refreshTokens(storeId, auth),
  };
}

/** Client API d'une boutique connectée (réel ou simulé). `requireShop` : une boutique TikTok doit être choisie. */
export async function apiFor(storeId: string, opts: { requireShop?: boolean } = { requireShop: true }): Promise<{ api: TiktokShopApi; config: TtsConfig; row: IntegrationRow }> {
  const current = await loadIntegration(storeId);
  if (!current || current.row.status === "inactive") throw new TiktokShopError("TikTok Shop n'est pas connecté à cette boutique", "config");
  if (opts.requireShop !== false && !current.config.shop) throw new TiktokShopError("Choisissez d'abord votre boutique TikTok Shop", "config");
  if (isFakeMode()) return { api: new FakeTiktokShopClient(), ...current, config: current.config };
  const platform = platformConfig();
  if (!platform) throw new TiktokShopError("TikTok Shop n'est pas configuré sur la plateforme (TIKTOK_SHOP_APP_KEY)", "config");
  const api = new TiktokShopClient({ platform }, tokenProvider(storeId), current.config.shop?.cipher ?? null);
  return { api, config: current.config, row: current.row };
}
