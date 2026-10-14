import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Équipe INT (App Store v2) : installation OAuth réelle des apps externes, API pour les apps, jeton de session
 * d'app embarquée, webhooks de cycle de vie. Contrat : docs/apps-v2/int.md.
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: () => { throw new Error("hors requête"); } }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  normalizeIp: (v: string | null) => v ?? "unknown",
  rateLimit: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitAll: async () => ({ ok: true, retryAfter: 0 }),
}));

process.env.NEXT_PUBLIC_APP_URL = "https://axi.test";

import { appSigningSecret, buildInstallRedirect, canonicalInstallQuery, signInstallQuery, verifyInstallQuery } from "@/lib/apps/install-signing";
import { createSessionToken, verifySessionToken, SESSION_TOKEN_TTL_SEC } from "@/lib/apps/session-token";
import { installRedirectUri } from "@/lib/apps/install-flow";
import { deliverLifecycleWebhook } from "@/lib/apps/lifecycle-webhooks";
import { verifySignature } from "@/lib/webhooks/sign";
import { APP_INSTALL_CODE_CHALLENGE, createAppInstallCode, createAuthorizationCode, exchangeAuthorizationCode, refreshAccessToken, OAuthError, type ValidAuthorizeRequest } from "@/lib/mcp/oauth";
import { authenticateMerchant } from "@/lib/mcp/auth";
import { authenticateRest } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/problem";
import { POST as verifySessionRoute } from "@/app/api/apps/session/verify/route";

const APP_SECRET = "test-secret-vitest-0123456789abcdef0123456789abcdef";
const FUTURE = new Date(Date.now() + 30 * 86_400_000);
const CLIENT_SECRET = "axi_cs_" + randomBytes(30).toString("base64url");
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const REDIRECT = "https://app.example.com/axi/callback";

function seed(opts: { planId?: string } = {}) {
  state.fake = createFakeDb({
    user: [{ id: "u1", email: "o@x.test", name: "Owner" }],
    store: [{ id: "s1", name: "Chez Test", slug: "chez-test", status: "PUBLISHED", currency: "XOF", timezone: "Africa/Porto-Novo", country: "BJ", whatsappNumber: null }],
    subscription: [{ id: "sub1", storeId: "s1", planId: opts.planId ?? "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE }],
    membership: [{ id: "m1", userId: "u1", storeId: "s1", role: "OWNER", expiresAt: null }],
    oAuthClient: [
      { id: "cApp", clientId: "axi_cli_app", clientSecretHash: sha(CLIENT_SECRET), name: "Mon App", redirectUris: [REDIRECT], clientUri: null, logoUri: null, disabledAt: null },
      { id: "cMcp", clientId: "axi_cli_mcp", clientSecretHash: null, name: "Assistant", redirectUris: ["https://assistant.example/cb"], clientUri: null, logoUri: null, disabledAt: null },
    ],
    app: [{ id: "app1", slug: "mon-app", name: "Mon App", status: "PUBLISHED", oauthClientId: "axi_cli_app", webhookUrl: "https://app.example.com/axi/webhooks", appUrl: "https://app.example.com/embed" }],
    // L'app demande lecture catalogue + commandes ; l'installation n'a accordé que catalog:read et store:read.
    oAuthGrant: [{ id: "g1", clientId: "cApp", userId: "u1", storeId: "s1", scopes: ["store:read", "catalog:read", "orders:read"], resource: "https://axi.test/api/mcp", revokedAt: null }],
    appInstallation: [{ id: "i1", appId: "app1", storeId: "s1", status: "ACTIVE", grantedScopes: ["store:read", "catalog:read"], oauthGrantId: "g1", installedAt: new Date("2026-10-13T10:00:00Z"), uninstalledAt: null }],
  });
}

const appCreds = { clientId: "axi_cli_app", clientSecret: CLIENT_SECRET };
const form = (o: Record<string, string>) => new URLSearchParams(o);

async function installCode() {
  return createAppInstallCode(state.fake!.db as never, { clientDbId: "cApp", userId: "u1", storeId: "s1", scopes: ["store:read", "catalog:read"], redirectUri: REDIRECT });
}

async function expectOAuthError(p: Promise<unknown>, error: string) {
  await expect(p).rejects.toBeInstanceOf(OAuthError);
  await p.catch((e: OAuthError) => expect(e.error).toBe(error));
}

function uninstall() {
  const t = state.fake!.tables;
  const inst = t.appInstallation.find((r) => r.id === "i1")!;
  Object.assign(inst, { status: "UNINSTALLED", oauthGrantId: null, uninstalledAt: new Date() });
  const now = new Date();
  for (const g of t.oAuthGrant) if (g.id === "g1") g.revokedAt = now;
  for (const tok of t.oAuthToken ?? []) if (tok.grantId === "g1") tok.revokedAt = now;
}

beforeEach(() => seed());

/* ───────────────────────── Signature de la redirection d'installation ───────────────────────── */

describe("hmac de la redirection d'installation", () => {
  const secret = appSigningSecret("app1", "hash1", APP_SECRET);

  it("secret de signature : dérivé par app, stable, format whsec_", () => {
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(appSigningSecret("app1", "hash1", APP_SECRET)).toBe(secret);
    expect(appSigningSecret("app2", "hash1", APP_SECRET)).not.toBe(secret);
  });

  it("M2 : le secret de signature tourne avec le client_secret (empreinte)", () => {
    expect(appSigningSecret("app1", "hash2", APP_SECRET)).not.toBe(secret);
    expect(appSigningSecret("app1", null, APP_SECRET)).not.toBe(secret);
  });

  it("chaîne canonique (F1) : tri par nom, paires réencodées, sans hmac", () => {
    expect(canonicalInstallQuery({ state: "s", code: "c", hmac: "x", shop: "a b" })).toBe("code=c&shop=a+b&state=s");
    expect(canonicalInstallQuery({ host: "https://axi.test" })).toBe("host=https%3A%2F%2Faxi.test");
  });

  it("F1 : une valeur contenant & ou = ne peut pas imiter d'autres paramètres", () => {
    const forged = { code: "c&shop=victime", state: "s" };
    const genuine = { code: "c", shop: "victime", state: "s" };
    expect(canonicalInstallQuery(forged)).not.toBe(canonicalInstallQuery(genuine));
    expect(signInstallQuery(forged, secret)).not.toBe(signInstallQuery(genuine, secret));
    // Aller-retour : la requête reçue par l'app (décodée) vérifie, même avec des caractères spéciaux.
    const now = 1_760_000_000;
    const url = new URL(buildInstallRedirect(`${REDIRECT}?ref=${encodeURIComponent("a&b=c d")}`, { code: "axi_code_x", shop: "chez-test", state: "s+t/=", host: "https://axi.test", timestamp: now }, secret));
    expect(url.searchParams.get("ref")).toBe("a&b=c d");
    expect(url.searchParams.get("state")).toBe("s+t/=");
    expect(verifyInstallQuery(Object.fromEntries(url.searchParams), secret, { nowSec: now })).toEqual({ ok: true });
  });

  it("URL produite : vérifiable par l'app ; toute altération ou un vieux timestamp est refusé", () => {
    const now = 1_760_000_000;
    const url = new URL(buildInstallRedirect(`${REDIRECT}?ref=axi`, { code: "axi_code_x", shop: "chez-test", state: "st", host: "https://axi.test", timestamp: now }, secret));
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({ code: "axi_code_x", shop: "chez-test", state: "st", host: "https://axi.test", timestamp: String(now), ref: "axi" });
    expect(params.hmac).toBe(signInstallQuery(params, secret));
    expect(verifyInstallQuery(params, secret, { nowSec: now + 10 })).toEqual({ ok: true });
    expect(verifyInstallQuery({ ...params, shop: "autre-boutique" }, secret, { nowSec: now })).toEqual({ ok: false, reason: "bad_hmac" });
    expect(verifyInstallQuery({ ...params, ref: "x" }, secret, { nowSec: now })).toEqual({ ok: false, reason: "bad_hmac" });
    expect(verifyInstallQuery(params, appSigningSecret("app2", "hash1", APP_SECRET), { nowSec: now })).toEqual({ ok: false, reason: "bad_hmac" });
    expect(verifyInstallQuery(params, appSigningSecret("app1", "hash-regenere", APP_SECRET), { nowSec: now })).toEqual({ ok: false, reason: "bad_hmac" });
    expect(verifyInstallQuery(params, secret, { nowSec: now + 301 })).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
    expect(verifyInstallQuery({ ...params, hmac: "" }, secret, { nowSec: now })).toEqual({ ok: false, reason: "missing_hmac" });
  });

  it("flux choisi : redirection seulement pour un client confidentiel avec URI web", () => {
    expect(installRedirectUri({ clientSecretHash: "h", redirectUris: ["myapp://cb", REDIRECT] })).toBe(REDIRECT);
    expect(installRedirectUri({ clientSecretHash: "h", redirectUris: ["http://localhost:4555/cb"] })).toBe("http://localhost:4555/cb");
    expect(installRedirectUri({ clientSecretHash: null, redirectUris: [REDIRECT] })).toBeNull();
    expect(installRedirectUri({ clientSecretHash: "h", redirectUris: ["http://evil.example/cb", "myapp://cb"] })).toBeNull();
  });
});

/* ───────────────────────── Jeton de session ───────────────────────── */

describe("jeton de session d'app embarquée", () => {
  const input = { iss: "https://axi.test", aud: "axi_cli_app", appId: "app1", shop: "chez-test", storeId: "s1", userId: "u1" };
  const now = 1_760_000_000;

  it("valide : revendications attendues, 5 minutes", () => {
    const { token } = createSessionToken(input, { nowSec: now, appSecret: APP_SECRET });
    expect(token).toMatch(/^axs1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const v = verifySessionToken(token, "app1", { nowSec: now + 60, appSecret: APP_SECRET });
    expect(v.ok && v.claims).toMatchObject({ sid: "s1", sub: "u1", app: "app1", shop: "chez-test", exp: now + SESSION_TOKEN_TTL_SEC });
  });

  it("expiré, falsifié, d'une autre app, malformé : refusé", () => {
    const { token } = createSessionToken(input, { nowSec: now, appSecret: APP_SECRET });
    expect(verifySessionToken(token, "app1", { nowSec: now + 300, appSecret: APP_SECRET })).toEqual({ ok: false, reason: "expired" });
    const [p, payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sid: "autre" })).toString("base64url");
    expect(verifySessionToken(`${p}.${forged}.${sig}`, "app1", { nowSec: now, appSecret: APP_SECRET })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySessionToken(token, "app2", { nowSec: now, appSecret: APP_SECRET })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySessionToken(token, "app1", { nowSec: now, appSecret: "autre-secret-plateforme-0123456789abcdef" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySessionToken("abc", "app1", { appSecret: APP_SECRET })).toEqual({ ok: false, reason: "malformed" });
  });

  it("POST /api/apps/session/verify : bon secret → contexte ; mauvais secret → 401 ; app désinstallée → 401", async () => {
    const { token } = createSessionToken(input);
    const call = (body: Record<string, string>) =>
      verifySessionRoute(new Request("https://axi.test/api/apps/session/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const ok = await call({ client_id: "axi_cli_app", client_secret: CLIENT_SECRET, token });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ active: true, shop: "chez-test", storeId: "s1", userId: "u1", appId: "app1", scopes: ["store:read", "catalog:read"] });
    const bad = await call({ client_id: "axi_cli_app", client_secret: "axi_cs_faux", token });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toBe("invalid_client");
    const forged = await call({ client_id: "axi_cli_app", client_secret: CLIENT_SECRET, token: token.slice(0, -2) + "AA" });
    expect(forged.status).toBe(401);
    uninstall();
    const gone = await call({ client_id: "axi_cli_app", client_secret: CLIENT_SECRET, token });
    expect(gone.status).toBe(401);
    expect((await gone.json()).error).toBe("invalid_token");
  });
});

/* ───────────────────────── Échange du code d'installation ───────────────────────── */

describe("échange du code d'installation (client confidentiel, sans PKCE)", () => {
  it("marqueur jamais confondu avec un défi PKCE", () => {
    expect(APP_INSTALL_CODE_CHALLENGE).not.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("bon secret : jetons liés au grant de l'installation ; portée = grant ∩ installation ∩ plan", async () => {
    const tokens = await exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: await installCode() }), appCreds);
    expect(tokens.access_token).toMatch(/^axi_oat_/);
    expect(state.fake!.tables.oAuthToken.every((t) => t.grantId === "g1")).toBe(true);
    const auth = await authenticateMerchant(`Bearer ${tokens.access_token}`, "1.2.3.4");
    expect(auth.ok && auth.ctx.scopes).toEqual(["store:read", "catalog:read"]);
    expect(auth.ok && auth.ctx.actor.appId).toBe("app1");
  });

  it("mauvais secret ou secret absent : invalid_client (le code n'est pas consommé)", async () => {
    const code = await installCode();
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code }), { clientId: "axi_cli_app", clientSecret: "axi_cs_mauvais" }), "invalid_client");
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code }), { clientId: "axi_cli_app", clientSecret: null }), "invalid_client");
    // Toujours utilisable avec le bon secret.
    await expect(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code }), appCreds)).resolves.toMatchObject({ token_type: "Bearer" });
  });

  it("redirect_uri fournie et différente : refus ; autre client : refus ; app désinstallée avant l'échange : refus", async () => {
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: await installCode(), redirect_uri: "https://evil.example/cb" }), appCreds), "invalid_grant");
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: await installCode() }), { clientId: "axi_cli_mcp", clientSecret: null }), "invalid_grant");
    const code = await installCode();
    uninstall();
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code }), appCreds), "invalid_grant");
  });
});

/* ───────────────────────── Jeton refusé après désinstallation ───────────────────────── */

describe("API pour les apps : installation active obligatoire", () => {
  async function tokens() {
    return exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: await installCode() }), appCreds);
  }
  const restReq = (token: string) => new Request("https://axi.test/api/v1/products", { headers: { authorization: `Bearer ${token}` } });

  it("REST /api/v1 accepte le jeton d'app (scope accordé) et refuse un scope non accordé", async () => {
    const t = await tokens();
    const ctx = await authenticateRest(restReq(t.access_token), "1.2.3.4", { method: "GET", scope: "catalog:read" });
    expect(ctx.store.id).toBe("s1");
    await expect(authenticateRest(restReq(t.access_token), "1.2.3.4", { method: "GET", scope: "orders:read" })).rejects.toMatchObject({ status: 403 });
  });

  it("après désinstallation : jeton d'accès refusé (MCP et REST), rafraîchissement refusé", async () => {
    const t = await tokens();
    uninstall();
    const auth = await authenticateMerchant(`Bearer ${t.access_token}`, "1.2.3.4");
    expect(auth.ok).toBe(false);
    await expect(authenticateRest(restReq(t.access_token), "1.2.3.4", { method: "GET", scope: "catalog:read" })).rejects.toBeInstanceOf(ApiError);
    await expectOAuthError(refreshAccessToken(form({ grant_type: "refresh_token", refresh_token: t.refresh_token }), appCreds), "invalid_grant");
  });

  it("installation inactive mais grant non révoqué (défense en profondeur) : refus ; app suspendue : refus", async () => {
    const t = await tokens();
    state.fake!.tables.appInstallation[0].status = "SUSPENDED";
    expect((await authenticateMerchant(`Bearer ${t.access_token}`, "1.2.3.4")).ok).toBe(false);
    state.fake!.tables.appInstallation[0].status = "ACTIVE";
    expect((await authenticateMerchant(`Bearer ${t.access_token}`, "1.2.3.4")).ok).toBe(true);
    state.fake!.tables.app[0].status = "SUSPENDED";
    expect((await authenticateMerchant(`Bearer ${t.access_token}`, "1.2.3.4")).ok).toBe(false);
  });
});

/* ───────────────────────── Non-régression du flux MCP (PKCE) ───────────────────────── */

describe("non-régression OAuth MCP (client public, PKCE S256)", () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const client = { id: "cMcp", clientId: "axi_cli_mcp", name: "Assistant", redirectUris: ["https://assistant.example/cb"], clientUri: null, logoUri: null };
  const request: ValidAuthorizeRequest = { client, redirectUri: "https://assistant.example/cb", scopes: ["store:read", "catalog:read"], state: "st", codeChallenge: challenge, resource: "https://axi.test/api/mcp" };
  const mcpCreds = { clientId: "axi_cli_mcp", clientSecret: null };

  it("PKCE toujours exigé ; succès avec le bon vérificateur ; jeton MCP refusé par l'API REST", async () => {
    const c1 = await createAuthorizationCode({ request, userId: "u1", storeId: "s1", scopes: request.scopes });
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: c1, redirect_uri: request.redirectUri }), mcpCreds), "invalid_grant");
    const c2 = await createAuthorizationCode({ request, userId: "u1", storeId: "s1", scopes: request.scopes });
    const t = await exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: c2, redirect_uri: request.redirectUri, code_verifier: verifier }), mcpCreds);
    const auth = await authenticateMerchant(`Bearer ${t.access_token}`, "1.2.3.4");
    expect(auth.ok && auth.ctx.scopes).toEqual(["store:read", "catalog:read"]);
    expect(auth.ok && auth.ctx.actor.appId).toBeNull();
    await expect(
      authenticateRest(new Request("https://axi.test/api/v1/products", { headers: { authorization: `Bearer ${t.access_token}` } }), "1.2.3.4", { method: "GET", scope: "catalog:read" }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("N2 : rafraîchissement refusé pour une app suspendue ou une installation non ACTIVE", () => {
  async function tokens() {
    return exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: await installCode() }), appCreds);
  }
  it("app SUSPENDED : invalid_grant", async () => {
    const t = await tokens();
    state.fake!.tables.app[0].status = "SUSPENDED";
    await expectOAuthError(refreshAccessToken(form({ grant_type: "refresh_token", refresh_token: t.refresh_token }), appCreds), "invalid_grant");
  });
  it("installation SUSPENDED (grant non révoqué) : invalid_grant ; ACTIVE et app publiée : OK", async () => {
    const t = await tokens();
    state.fake!.tables.appInstallation[0].status = "SUSPENDED";
    await expectOAuthError(refreshAccessToken(form({ grant_type: "refresh_token", refresh_token: t.refresh_token }), appCreds), "invalid_grant");
    state.fake!.tables.appInstallation[0].status = "ACTIVE";
    const t2 = await tokens();
    await expect(refreshAccessToken(form({ grant_type: "refresh_token", refresh_token: t2.refresh_token }), appCreds)).resolves.toMatchObject({ token_type: "Bearer" });
  });
});

describe("F3 : le flux /oauth/authorize (PKCE) n'utilise jamais le grant d'une installation", () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const client = { id: "cApp", clientId: "axi_cli_app", name: "Mon App", redirectUris: [REDIRECT], clientUri: null, logoUri: null };
  const request: ValidAuthorizeRequest = { client, redirectUri: REDIRECT, scopes: ["store:read", "customers:read"], state: "st", codeChallenge: challenge, resource: "https://axi.test/api/mcp" };
  const pkce = (code: string) => form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier });

  it("grant séparé créé ; grant de l'installation ni réutilisé ni écrasé", async () => {
    const code = await createAuthorizationCode({ request, userId: "u1", storeId: "s1", scopes: request.scopes });
    await exchangeAuthorizationCode(pkce(code), appCreds);
    const g1 = state.fake!.tables.oAuthGrant.find((g) => g.id === "g1")!;
    expect(g1.scopes).toEqual(["store:read", "catalog:read", "orders:read"]);
    expect(g1.revokedAt).toBeNull();
    const others = state.fake!.tables.oAuthGrant.filter((g) => g.id !== "g1");
    expect(others).toHaveLength(1);
    expect(others[0]).toMatchObject({ clientId: "cApp", storeId: "s1", scopes: ["store:read", "customers:read"] });
    expect(state.fake!.tables.oAuthToken.every((t) => t.grantId === others[0].id)).toBe(true);
    expect(state.fake!.tables.appInstallation[0].oauthGrantId).toBe("g1");
  });

  it("non-régression : un second authorize met à jour le grant PKCE, jamais celui de l'installation", async () => {
    await exchangeAuthorizationCode(pkce(await createAuthorizationCode({ request, userId: "u1", storeId: "s1", scopes: request.scopes })), appCreds);
    await exchangeAuthorizationCode(pkce(await createAuthorizationCode({ request, userId: "u1", storeId: "s1", scopes: ["store:read"] })), appCreds);
    const others = state.fake!.tables.oAuthGrant.filter((g) => g.id !== "g1");
    expect(others).toHaveLength(1);
    expect(others[0].scopes).toEqual(["store:read"]);
    expect(state.fake!.tables.oAuthGrant.find((g) => g.id === "g1")!.scopes).toEqual(["store:read", "catalog:read", "orders:read"]);
  });
});

/* ───────────────────────── Webhooks de cycle de vie ───────────────────────── */

describe("webhooks de cycle de vie (app.webhookUrl)", () => {
  it("envoi signé avec le secret de l'app, en-têtes axi-webhook-*, via sendSignedRequest", async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200, error: null, snippet: null, durationMs: 3 }));
    const now = new Date();
    const out = await deliverLifecycleWebhook({ event: "app.installed", appId: "app1", storeId: "s1", installationId: "i1" }, { send, now: () => now });
    expect(out.outcome).toBe("sent");
    const [url, body, headers] = send.mock.calls[0] as unknown as [string, string, Record<string, string>];
    expect(url).toBe("https://app.example.com/axi/webhooks");
    expect(headers["Axi-Webhook-Topic"]).toBe("app.installed");
    expect(headers["Axi-Webhook-Shop"]).toBe("chez-test");
    expect(headers["Axi-Webhook-Id"]).toMatch(/^evt_app_installed_i1_\d+$/);
    expect(verifySignature(headers["Axi-Webhook-Signature"], body, [appSigningSecret("app1", sha(CLIENT_SECRET))])).toEqual({ ok: true });
    expect(verifySignature(headers["Axi-Webhook-Signature"], body, [appSigningSecret("app2", sha(CLIENT_SECRET))]).ok).toBe(false);
    // M2 : signé avec l'empreinte ACTUELLE du client_secret ; après régénération, l'ancien secret ne vérifie plus.
    state.fake!.tables.oAuthClient[0].clientSecretHash = sha("axi_cs_nouveau");
    const again = await deliverLifecycleWebhook({ event: "app.installed", appId: "app1", storeId: "s1", installationId: "i1" }, { send, now: () => now });
    expect(again.outcome).toBe("sent");
    const [, body2, headers2] = send.mock.calls[1] as unknown as [string, string, Record<string, string>];
    expect(verifySignature(headers2["Axi-Webhook-Signature"], body2, [appSigningSecret("app1", sha(CLIENT_SECRET))]).ok).toBe(false);
    expect(verifySignature(headers2["Axi-Webhook-Signature"], body2, [appSigningSecret("app1", sha("axi_cs_nouveau"))])).toEqual({ ok: true });
    expect(JSON.parse(body)).toMatchObject({ type: "app.installed", shop: "chez-test", store_id: "s1", installation_id: "i1", data: { scopes: ["store:read", "catalog:read"] } });
  });

  it("anti-SSRF réutilisé : une URL interne est bloquée avant tout envoi ; sans webhookUrl : rien", async () => {
    state.fake!.tables.app[0].webhookUrl = "https://169.254.169.254/latest";
    const out = await deliverLifecycleWebhook({ event: "app.uninstalled", appId: "app1", storeId: "s1", installationId: "i1" });
    expect(out.outcome === "failed" && out.result.blocked).toBe(true);
    state.fake!.tables.app[0].webhookUrl = null;
    expect((await deliverLifecycleWebhook({ event: "app.uninstalled", appId: "app1", storeId: "s1", installationId: "i1" })).outcome).toBe("skipped");
  });
});
