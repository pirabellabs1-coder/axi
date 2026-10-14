import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createFakeDb } from "./helpers/fake-db";

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));

process.env.NEXT_PUBLIC_APP_URL = "https://axi.test";

import { validateAuthorize, redirectWith, exchangeAuthorizationCode, refreshAccessToken, revokeToken, createAuthorizationCode, registerClient, OAuthError, type ValidAuthorizeRequest } from "@/lib/mcp/oauth";
import { authenticateMerchant } from "@/lib/mcp/auth";
import { hasReservedBrand, isVerifiedClient, isVerifiedRedirectUri } from "@/lib/mcp/tokens";

const FUTURE = new Date(Date.now() + 30 * 86_400_000);
const client = { id: "c1", clientId: "axi_cli_test", name: "Claude", redirectUris: ["https://claude.ai/cb"], clientUri: null, logoUri: null };
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

function seed() {
  state.fake = createFakeDb({
    user: [{ id: "u1", email: "o@x.test", name: "Owner" }],
    store: [
      { id: "s1", name: "Boutique A", slug: "boutique-a", status: "PUBLISHED", currency: "XOF", timezone: "Africa/Porto-Novo", country: "BJ", whatsappNumber: null },
      { id: "s2", name: "Boutique gratuite", slug: "gratuite", status: "PUBLISHED", currency: "XOF", timezone: "Africa/Porto-Novo", country: "BJ", whatsappNumber: null },
    ],
    subscription: [
      { id: "sub1", storeId: "s1", planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
      { id: "sub2", storeId: "s2", planId: "FREE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null },
    ],
    membership: [
      { id: "m1", userId: "u1", storeId: "s1", role: "OWNER", expiresAt: null },
      { id: "m2", userId: "u1", storeId: "s2", role: "OWNER", expiresAt: null },
    ],
    oAuthClient: [{ ...client, clientSecretHash: null, disabledAt: null }],
  });
}

const request: ValidAuthorizeRequest = { client, redirectUri: "https://claude.ai/cb", scopes: ["store:read", "catalog:read"], state: "st", codeChallenge: challenge, resource: "https://axi.test/api/mcp" };
const form = (o: Record<string, string>) => new URLSearchParams(o);
const creds = { clientId: "axi_cli_test", clientSecret: null };

async function newCode(storeId = "s1") {
  return createAuthorizationCode({ request, userId: "u1", storeId, scopes: request.scopes });
}

async function exchange(code: string, extra: Record<string, string> = {}) {
  return exchangeAuthorizationCode(form({ grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/cb", code_verifier: verifier, ...extra }), creds);
}

async function expectOAuthError(p: Promise<unknown>, error: string) {
  await expect(p).rejects.toBeInstanceOf(OAuthError);
  await p.catch((e: OAuthError) => expect(e.error).toBe(error));
}

beforeEach(seed);

describe("demande d'autorisation (validation)", () => {
  const base = { response_type: "code", client_id: "axi_cli_test", redirect_uri: "https://claude.ai/cb", code_challenge: challenge, code_challenge_method: "S256" };

  it("client inconnu ou désactivé, redirect_uri non enregistrée : erreur affichée, jamais de redirection", () => {
    expect(validateAuthorize(base, null)).toMatchObject({ ok: false, fatal: true, error: "invalid_client" });
    expect(validateAuthorize(base, client, true)).toMatchObject({ ok: false, fatal: true });
    expect(validateAuthorize({ ...base, redirect_uri: "https://evil.example/cb" }, client)).toMatchObject({ ok: false, fatal: true });
  });

  it("PKCE obligatoire en S256 ; response_type=code uniquement", () => {
    expect(validateAuthorize({ ...base, code_challenge: undefined }, client)).toMatchObject({ ok: false, fatal: false, error: "invalid_request" });
    expect(validateAuthorize({ ...base, code_challenge_method: "plain" }, client)).toMatchObject({ ok: false, error: "invalid_request" });
    expect(validateAuthorize({ ...base, code_challenge_method: undefined }, client)).toMatchObject({ ok: false, error: "invalid_request" });
    expect(validateAuthorize({ ...base, response_type: "token" }, client)).toMatchObject({ ok: false, error: "unsupported_response_type" });
  });

  it("paramètre resource (RFC 8707) : seule la ressource MCP d'Axi", () => {
    expect(validateAuthorize({ ...base, resource: "https://other.example/mcp" }, client)).toMatchObject({ ok: false, error: "invalid_target" });
    const ok = validateAuthorize({ ...base, resource: "https://axi.test/api/mcp/" }, client);
    expect(ok.ok && ok.request.resource).toBe("https://axi.test/api/mcp");
  });

  it("scopes : inconnus ignorés, tous inconnus refusés, absents = lecture seule (M2)", () => {
    const ok = validateAuthorize({ ...base, scope: "catalog:read evil:all" }, client);
    expect(ok.ok && ok.request.scopes).toEqual(["catalog:read"]);
    expect(validateAuthorize({ ...base, scope: "evil:all" }, client)).toMatchObject({ ok: false, error: "invalid_scope" });
    const def = validateAuthorize(base, client);
    expect(def.ok && def.request.scopes).toEqual(["store:read", "catalog:read", "orders:read", "customers:read", "analytics:read"]);
  });

  it("redirect_uri omise : acceptée seulement si une seule est enregistrée", () => {
    const ok = validateAuthorize({ ...base, redirect_uri: undefined }, client);
    expect(ok.ok && ok.request.redirectUri).toBe("https://claude.ai/cb");
    expect(validateAuthorize({ ...base, redirect_uri: undefined }, { ...client, redirectUris: ["https://a.example/cb", "https://b.example/cb"] })).toMatchObject({ ok: false, fatal: true });
  });

  it("réponse : code, state et iss (RFC 9207)", () => {
    const url = new URL(redirectWith("https://claude.ai/cb?x=1", { code: "abc", state: "st" }));
    expect(Object.fromEntries(url.searchParams)).toEqual({ x: "1", code: "abc", state: "st", iss: "https://axi.test" });
  });
});

describe("enregistrement dynamique (RFC 7591)", () => {
  it("client public par défaut, URI dangereuses refusées", async () => {
    const r = await registerClient({ client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-retrieval/oauth/callback"] });
    expect(r).toMatchObject({ client_name: "Cursor", token_endpoint_auth_method: "none", response_types: ["code"] });
    expect(r).not.toHaveProperty("client_secret");
    await expectOAuthError(registerClient({ redirect_uris: ["http://evil.example/cb"] }), "invalid_redirect_uri");
    await expectOAuthError(registerClient({ redirect_uris: [] }), "invalid_redirect_uri");
    await expectOAuthError(registerClient({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }), "invalid_client_metadata");
  });

  it("client confidentiel : secret renvoyé une fois, stocké haché", async () => {
    const r = (await registerClient({ client_name: "Agent", redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_post" })) as { client_id: string; client_secret: string };
    expect(r.client_secret).toMatch(/^axi_cs_/);
    const row = state.fake!.tables.oAuthClient.find((c) => c.clientId === r.client_id)!;
    expect(row.clientSecretHash).toBe(createHash("sha256").update(r.client_secret).digest("hex"));
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: "x" }), { clientId: r.client_id, clientSecret: "wrong" }), "invalid_client");
  });
});

describe("code d'autorisation : PKCE et usage unique", () => {
  it("échange réussi : jetons opaques, haché en base, scope effectif", async () => {
    const tokens = await exchange(await newCode());
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "store:read catalog:read" });
    expect(tokens.access_token).toMatch(/^axi_oat_/);
    expect(tokens.refresh_token).toMatch(/^axi_ort_/);
    const stored = state.fake!.tables.oAuthToken.map((t) => t.tokenHash);
    expect(stored).toContain(createHash("sha256").update(tokens.access_token).digest("hex"));
    expect(stored).not.toContain(tokens.access_token);
    const auth = await authenticateMerchant(`Bearer ${tokens.access_token}`, "1.2.3.4");
    expect(auth.ok && auth.ctx.store.id).toBe("s1");
    expect(auth.ok && auth.ctx.scopes).toEqual(["store:read", "catalog:read"]);
  });

  it("mauvais vérificateur PKCE : refus", async () => {
    await expectOAuthError(exchange(await newCode(), { code_verifier: "x".repeat(43) }), "invalid_grant");
  });

  it("le code ne sert qu'une fois ; sa réutilisation révoque l'accès qu'il a produit", async () => {
    const code = await newCode();
    const tokens = await exchange(code);
    await expectOAuthError(exchange(code), "invalid_grant");
    const auth = await authenticateMerchant(`Bearer ${tokens.access_token}`, "1.2.3.4");
    expect(auth.ok).toBe(false);
  });

  it("code expiré, redirect_uri différente, autre client : refus", async () => {
    const code = await newCode();
    state.fake!.tables.oAuthAuthorizationCode.at(-1)!.expiresAt = new Date(Date.now() - 1000);
    await expectOAuthError(exchange(code), "invalid_grant");
    await expectOAuthError(exchange(await newCode(), { redirect_uri: "https://claude.ai/other" }), "invalid_grant");
    state.fake!.tables.oAuthClient.push({ id: "c2", clientId: "axi_cli_other", name: "Other", redirectUris: ["https://claude.ai/cb"], clientSecretHash: null, disabledAt: null });
    const c = await newCode();
    await expectOAuthError(exchangeAuthorizationCode(form({ grant_type: "authorization_code", code: c, redirect_uri: "https://claude.ai/cb", code_verifier: verifier }), { clientId: "axi_cli_other", clientSecret: null }), "invalid_grant");
  });

  it("boutique sur un plan sans OAuth : refus à l'échange", async () => {
    await expectOAuthError(exchange(await newCode("s2")), "invalid_grant");
  });
});

describe("jeton de rafraîchissement : rotation et détection de réutilisation", () => {
  it("chaque rafraîchissement émet un nouveau couple ; l'ancien refresh ne sert plus", async () => {
    const t1 = await exchange(await newCode());
    const t2 = await refreshAccessToken(form({ grant_type: "refresh_token", refresh_token: t1.refresh_token }), creds);
    expect(t2.refresh_token).not.toBe(t1.refresh_token);
    expect(t2.access_token).not.toBe(t1.access_token);
    expect((await authenticateMerchant(`Bearer ${t2.access_token}`, "ip")).ok).toBe(true);
  });

  it("réutilisation d'un refresh consommé : toute l'autorisation est révoquée", async () => {
    const t1 = await exchange(await newCode());
    const t2 = await refreshAccessToken(form({ refresh_token: t1.refresh_token }), creds);
    await expectOAuthError(refreshAccessToken(form({ refresh_token: t1.refresh_token }), creds), "invalid_grant");
    expect((await authenticateMerchant(`Bearer ${t2.access_token}`, "ip")).ok).toBe(false);
    await expectOAuthError(refreshAccessToken(form({ refresh_token: t2.refresh_token }), creds), "invalid_grant");
  });

  it("scope demandé au-delà de l'autorisation : invalid_scope", async () => {
    const t1 = await exchange(await newCode());
    await expectOAuthError(refreshAccessToken(form({ refresh_token: t1.refresh_token, scope: "marketing:write" }), creds), "invalid_scope");
  });

  it("révocation RFC 7009 d'un refresh : l'accès cesse ; jeton inconnu : sans erreur", async () => {
    const t1 = await exchange(await newCode());
    await revokeToken(form({ token: t1.refresh_token }), creds);
    expect((await authenticateMerchant(`Bearer ${t1.access_token}`, "ip")).ok).toBe(false);
    await expect(revokeToken(form({ token: "axi_ort_inconnu" }), creds)).resolves.toBeUndefined();
  });

  it("membre retiré de la boutique : plus de rafraîchissement ni d'accès", async () => {
    const t1 = await exchange(await newCode());
    state.fake!.tables.membership = state.fake!.tables.membership.filter((m) => m.storeId !== "s1");
    expect((await authenticateMerchant(`Bearer ${t1.access_token}`, "ip")).ok).toBe(false);
    await expectOAuthError(refreshAccessToken(form({ refresh_token: t1.refresh_token }), creds), "invalid_grant");
  });
});

describe("applications vérifiées et marques réservées (M2)", () => {
  it("hôtes vérifiés : Claude, ChatGPT, bouclage local, Cursor et VS Code", () => {
    for (const ok of ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/cb", "https://chatgpt.com/connector_platform_oauth_redirect", "https://chat.openai.com/aip/cb", "http://localhost:6274/cb", "http://127.0.0.1:9999/cb", "cursor://anysphere.cursor-retrieval/oauth/callback", "vscode://x/cb"]) {
      expect(isVerifiedRedirectUri(ok), ok).toBe(true);
    }
    for (const no of ["https://claude.ai.evil.example/cb", "https://evil.example/claude.ai", "https://sub.claude.ai/cb", "com.example.app:/cb", "http://192.168.1.2/cb"]) {
      expect(isVerifiedRedirectUri(no), no).toBe(false);
    }
    expect(isVerifiedClient(["https://claude.ai/cb", "https://evil.example/cb"])).toBe(false);
  });

  it("détection des marques, sans viser des mots ordinaires", () => {
    for (const bad of ["Claude", "claude desktop", "C.l.a.u.d.e", "Anthropic Connector", "Chat GPT", "OpenAI agent", "Cursor IDE", "Axi Officiel", "Clàude"]) expect(hasReservedBrand(bad), bad).toBe(true);
    for (const ok of ["Taxi Manager", "Mon agent", "n8n", "Maxime Shop"]) expect(hasReservedBrand(ok), ok).toBe(false);
  });

  it("enregistrement : marque réservée refusée pour un client non vérifié, acceptée pour le vrai hôte", async () => {
    await expectOAuthError(registerClient({ client_name: "Claude", redirect_uris: ["https://evil.example/cb"] }), "invalid_client_metadata");
    await expect(registerClient({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })).resolves.toMatchObject({ client_name: "Claude" });
    await expect(registerClient({ client_name: "Mon agent", redirect_uris: ["https://evil.example/cb"] })).resolves.toMatchObject({ client_name: "Mon agent" });
  });

  it("consentement : un client existant non vérifié portant une marque est refusé (erreur affichée)", () => {
    const fake = { ...client, name: "ChatGPT", redirectUris: ["https://evil.example/cb"] };
    expect(validateAuthorize({ response_type: "code", client_id: "axi_cli_test", redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256" }, fake)).toMatchObject({ ok: false, fatal: true, error: "invalid_client" });
  });
});

describe("transaction du code et réduction de scope (n1, n2)", () => {
  it("le grantId est posé avec la consommation du code ; un échec PKCE consomme quand même le code", async () => {
    const code = await newCode();
    await exchange(code);
    const row = state.fake!.tables.oAuthAuthorizationCode.at(-1)!;
    expect(row.usedAt).toBeInstanceOf(Date);
    expect(row.grantId).toBeTruthy();
    const failed = await newCode();
    await expectOAuthError(exchange(failed, { code_verifier: "y".repeat(43) }), "invalid_grant");
    expect(state.fake!.tables.oAuthAuthorizationCode.at(-1)!.usedAt).toBeInstanceOf(Date);
    await expectOAuthError(exchange(failed), "invalid_grant");
  });

  it("refresh avec un scope réduit : seul ce scope est réémis, et l'autorisation reste restreinte", async () => {
    const t1 = await exchange(await newCode());
    const t2 = await refreshAccessToken(form({ refresh_token: t1.refresh_token, scope: "catalog:read" }), creds);
    expect(t2.scope).toBe("catalog:read");
    const auth = await authenticateMerchant(`Bearer ${t2.access_token}`, "ip");
    expect(auth.ok && auth.ctx.scopes).toEqual(["catalog:read"]);
    const t3 = await refreshAccessToken(form({ refresh_token: t2.refresh_token }), creds);
    expect(t3.scope).toBe("catalog:read");
  });
});
