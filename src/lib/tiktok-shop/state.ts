import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * `state` OAuth anti-CSRF de la connexion TikTok Shop (fonctions PURES, clé passée par l'appelant).
 *
 * state = base64url({ s: storeId, u: userId, n: nonce, e: expiration }) + "." + HMAC-SHA256.
 * Le nonce est AUSSI posé dans un cookie httpOnly (SameSite=Lax) : le callback exige que les deux concordent
 * et que l'utilisateur connecté soit celui qui a lancé l'autorisation. Durée de vie : 10 minutes.
 */
export const STATE_TTL_MS = 10 * 60_000;
export const STATE_COOKIE = "axi_tts_state";

export type OAuthState = { storeId: string; userId: string; nonce: string; exp: number };

const mac = (key: string, payload: string) => createHmac("sha256", `tiktok-shop-state:${key}`).update(payload).digest("base64url");

export function createState(key: string, p: { storeId: string; userId: string; now?: number; nonce?: string }): { state: string; nonce: string } {
  const nonce = p.nonce ?? randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ s: p.storeId, u: p.userId, n: nonce, e: (p.now ?? Date.now()) + STATE_TTL_MS })).toString("base64url");
  return { state: `${payload}.${mac(key, payload)}`, nonce };
}

export type StateCheck = { ok: true; state: OAuthState } | { ok: false; reason: "malformed" | "signature" | "expired" | "nonce" | "user" };

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function verifyState(key: string, raw: string | null | undefined, p: { cookieNonce: string | null | undefined; userId: string | null | undefined; now?: number }): StateCheck {
  const value = String(raw ?? "");
  if (value.length > 1024) return { ok: false, reason: "malformed" };
  const [payload, sig, extra] = value.split(".");
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  if (!same(sig, mac(key, payload))) return { ok: false, reason: "signature" };
  let parsed: { s?: unknown; u?: unknown; n?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed.s !== "string" || typeof parsed.u !== "string" || typeof parsed.n !== "string" || typeof parsed.e !== "number") return { ok: false, reason: "malformed" };
  if ((p.now ?? Date.now()) > parsed.e) return { ok: false, reason: "expired" };
  if (!p.cookieNonce || !same(p.cookieNonce, parsed.n)) return { ok: false, reason: "nonce" };
  if (!p.userId || p.userId !== parsed.u) return { ok: false, reason: "user" };
  return { ok: true, state: { storeId: parsed.s, userId: parsed.u, nonce: parsed.n, exp: parsed.e } };
}
