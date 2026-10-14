import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Jeton de session des applications embarquées (iframe de l'admin marchand). Module PUR.
 * Contrat publié : docs/apps-v2/int.md.
 *
 * Format : `axs1.<charge base64url>.<signature base64url>`
 *   charge     = JSON { iss, aud, app, shop, sid, sub, iat, exp, jti }
 *   signature  = HMAC-SHA256(clé, "axs1." + charge base64url)
 *   clé        = HMAC-SHA256(APP_SECRET, "axi-app-session:v1:" + app.id)   (jamais divulguée)
 * Durée de vie : 5 minutes. Le développeur le valide via POST /api/apps/session/verify (client_id + client_secret).
 */

export const SESSION_TOKEN_PREFIX = "axs1";
export const SESSION_TOKEN_TTL_SEC = 300;
/** Petite tolérance d'horloge sur `iat` (jeton « du futur ») ; l'expiration, elle, est stricte. */
const CLOCK_SKEW_SEC = 30;
const SESSION_DOMAIN = "axi-app-session:v1:";

export type SessionClaims = {
  /** Base publique d'Axi (émetteur). */
  iss: string;
  /** client_id OAuth de l'app (audience) ou, à défaut, son identifiant interne. */
  aud: string;
  /** Identifiant interne de l'app. */
  app: string;
  /** Slug de la boutique. */
  shop: string;
  /** storeId. */
  sid: string;
  /** userId du membre qui ouvre l'app. */
  sub: string;
  iat: number;
  exp: number;
  jti: string;
};

function sessionKey(appId: string, appSecret?: string): Buffer {
  const s = appSecret ?? process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET manquant ou trop court (32 caractères minimum).");
  return createHmac("sha256", s).update(`${SESSION_DOMAIN}${appId}`, "utf8").digest();
}

function sign(appId: string, signingInput: string, appSecret?: string): string {
  return createHmac("sha256", sessionKey(appId, appSecret)).update(signingInput, "utf8").digest("base64url");
}

export function createSessionToken(
  input: { iss: string; aud: string; appId: string; shop: string; storeId: string; userId: string },
  opts: { nowSec?: number; ttlSec?: number; appSecret?: string } = {},
): { token: string; claims: SessionClaims } {
  const iat = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    iss: input.iss,
    aud: input.aud,
    app: input.appId,
    shop: input.shop,
    sid: input.storeId,
    sub: input.userId,
    iat,
    exp: iat + (opts.ttlSec ?? SESSION_TOKEN_TTL_SEC),
    jti: randomBytes(12).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const input64 = `${SESSION_TOKEN_PREFIX}.${payload}`;
  return { token: `${input64}.${sign(input.appId, input64, opts.appSecret)}`, claims };
}

export type SessionVerify =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "wrong_app" | "expired" | "not_yet_valid" };

/** Vérifie un jeton POUR une app donnée (la clé dépend de l'app : un jeton d'une autre app est rejeté). */
export function verifySessionToken(token: unknown, appId: string, opts: { nowSec?: number; appSecret?: string } = {}): SessionVerify {
  if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
    return { ok: false, reason: "malformed" };
  }
  const expected = Buffer.from(sign(appId, `${parts[0]}.${parts[1]}`, opts.appSecret), "base64url");
  const got = Buffer.from(parts[2], "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "bad_signature" };
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims !== "object" || typeof claims.exp !== "number" || typeof claims.iat !== "number" || typeof claims.sid !== "string" || typeof claims.sub !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (claims.app !== appId) return { ok: false, reason: "wrong_app" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims.exp <= now) return { ok: false, reason: "expired" };
  if (claims.iat > now + CLOCK_SKEW_SEC) return { ok: false, reason: "not_yet_valid" };
  return { ok: true, claims };
}
