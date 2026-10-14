import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets du connecteur IA — générés aléatoirement, stockés uniquement sous forme de hachage SHA-256.
 *
 *  axi_live_…  jeton API d'une boutique (créé dans l'espace marchand)
 *  axi_oat_…   jeton d'accès OAuth (1 h)
 *  axi_ort_…   jeton de rafraîchissement OAuth (30 jours, usage unique : rotation)
 *  axi_cli_…   identifiant de client OAuth (public)
 *  axi_cs_…    secret de client OAuth confidentiel (facultatif)
 *
 * Fonctions pures (hors aléa), testées dans tests/mcp-auth.test.ts.
 */
export const TOKEN_PREFIX = { api: "axi_live_", access: "axi_oat_", refresh: "axi_ort_", code: "axi_code_", client: "axi_cli_", clientSecret: "axi_cs_" } as const;

/** Nombre de caractères du préfixe visible d'un jeton API (« axi_live_ » + 8). */
export const VISIBLE_PREFIX_LENGTH = TOKEN_PREFIX.api.length + 8;

const TOKEN_RE = /^axi_(live|oat|ort|code|cs)_[A-Za-z0-9_-]{32,64}$/;

function randomPart(bytes = 30): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Comparaison en temps constant de deux hachages hexadécimaux. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Vérifie un secret présenté contre un hachage stocké (temps constant). */
export function verifyToken(presented: string, storedHash: string): boolean {
  return hashesEqual(hashToken(presented), storedHash);
}

export function looksLikeToken(v: string): boolean {
  return TOKEN_RE.test(v);
}

export function tokenKind(v: string): "api" | "access" | "refresh" | null {
  if (!looksLikeToken(v)) return null;
  if (v.startsWith(TOKEN_PREFIX.api)) return "api";
  if (v.startsWith(TOKEN_PREFIX.access)) return "access";
  if (v.startsWith(TOKEN_PREFIX.refresh)) return "refresh";
  return null;
}

/** Nouveau jeton API : secret complet (affiché une fois), préfixe visible et hachage à stocker. */
export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const token = `${TOKEN_PREFIX.api}${randomPart()}`;
  return { token, prefix: token.slice(0, VISIBLE_PREFIX_LENGTH), hash: hashToken(token) };
}

export function generateSecret(kind: "access" | "refresh" | "code" | "clientSecret"): { value: string; hash: string } {
  const value = `${TOKEN_PREFIX[kind]}${randomPart()}`;
  return { value, hash: hashToken(value) };
}

export function generateClientId(): string {
  return `${TOKEN_PREFIX.client}${randomBytes(18).toString("base64url")}`;
}

/** Préfixe visible d'un jeton présenté (pour la recherche en base). */
export function visiblePrefix(token: string): string {
  return token.slice(0, VISIBLE_PREFIX_LENGTH);
}

/* ───────────────────────── PKCE (RFC 7636, S256 uniquement) ───────────────────────── */

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === "string" && CHALLENGE_RE.test(challenge);
}

export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** BASE64URL(SHA256(code_verifier)) == code_challenge, en temps constant. */
export function verifyPkceS256(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !VERIFIER_RE.test(verifier) || !CHALLENGE_RE.test(challenge)) return false;
  return hashesEqual(pkceChallengeS256(verifier), challenge);
}

/* ───────────────────────── URI de redirection (OAuth 2.1 / RFC 8252) ───────────────────────── */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Schémas d'applications natives connus (Cursor, VS Code…) ; sinon un schéma en nom de domaine inversé (« com.exemple.app: »). */
const NATIVE_SCHEMES = new Set(["cursor:", "vscode:", "vscode-insiders:", "windsurf:", "claude:", "zed:"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "about:", "vbscript:", "ftp:", "ws:", "wss:"]);

export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000 || /[\s\u0000-\u001f]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return !!url.hostname && !url.username && !url.password;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return NATIVE_SCHEMES.has(url.protocol) || /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+:$/.test(url.protocol);
}

/**
 * L'URI demandée correspond-elle à une URI enregistrée ? Comparaison exacte, sauf pour les adresses de
 * bouclage locales où le port peut varier (RFC 8252 §7.3).
 */
export function matchRedirectUri(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== "http:" || !LOOPBACK.has(req.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return u.protocol === "http:" && u.hostname === req.hostname && u.pathname === req.pathname && u.search === req.search;
    } catch {
      return false;
    }
  });
}

/* ───────────────────────── Applications vérifiées et marques réservées ───────────────────────── */

/** Hôtes de retour des clients connus (connexion « vérifiée ») ; tout autre hôte est signalé « non vérifié ». */
export const VERIFIED_REDIRECT_HOSTS = ["claude.ai", "claude.com", "chatgpt.com", "chat.openai.com"] as const;
const VERIFIED_SCHEMES = new Set(["cursor:", "vscode:"]);

export function isVerifiedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return (VERIFIED_REDIRECT_HOSTS as readonly string[]).includes(url.hostname);
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return VERIFIED_SCHEMES.has(url.protocol);
}

/** Client vérifié : TOUTES ses URI de retour sont sur la liste. */
export function isVerifiedClient(redirectUris: readonly string[]): boolean {
  return redirectUris.length > 0 && redirectUris.every(isVerifiedRedirectUri);
}

export const RESERVED_BRANDS = ["claude", "anthropic", "chatgpt", "openai", "cursor", "axi"] as const;

/**
 * Le nom contient-il une marque réservée ? Insensible à la casse et aux accents ; les marques longues sont aussi
 * cherchées sans séparateurs (« C.l.a.u.d.e »), « axi » seulement en début de mot (pour ne pas viser « taxi »).
 */
export function hasReservedBrand(name: string): boolean {
  const norm = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = norm.split(/[^a-z0-9]+/).filter(Boolean);
  const squashed = words.join("");
  return RESERVED_BRANDS.some((b) => (b.length >= 5 && squashed.includes(b)) || words.some((w) => w.startsWith(b)));
}
