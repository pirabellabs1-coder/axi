import "server-only";
import type { MembershipRole, OAuthClient } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { effectivePlanId } from "@/lib/billing/rules";
import { MCP_LIMITS } from "@/config/plans";
import { SITE } from "@/config/site";
import { audit } from "@/lib/audit";
import { effectiveScopes, formatScopes, parseScopes, READ_SCOPES, SCOPES, type Scope } from "./scopes";
import { generateClientId, generateSecret, hasReservedBrand, hashToken, isAllowedRedirectUri, isValidCodeChallenge, isVerifiedClient, matchRedirectUri, verifyPkceS256, verifyToken } from "./tokens";
import { appBaseUrl, canonicalResource, mcpResourceUrl } from "./runtime";

/**
 * Serveur d'autorisation OAuth 2.1 du connecteur IA (Claude.ai, ChatGPT, Cursor… « en un clic »).
 *  - RFC 8414 métadonnées, RFC 9728 ressource protégée, RFC 7591 enregistrement dynamique,
 *  - code d'autorisation + PKCE S256 obligatoire, code haché, 60 s, usage unique (réutilisation → révocation),
 *  - jetons d'accès 1 h, jetons de rafraîchissement 30 jours à usage unique (rotation ; réutilisation → révocation),
 *  - paramètre `resource` (RFC 8707) : seule la ressource MCP d'Axi est acceptée, liée à l'autorisation.
 */

export const ACCESS_TOKEN_TTL_SEC = 3600;
export const REFRESH_TOKEN_TTL_SEC = 30 * 86_400;
export const CODE_TTL_SEC = 60;
/** Cookie HttpOnly qui conserve une demande d'autorisation pendant la connexion (path /oauth, 15 min). */
export const OAUTH_RESUME_COOKIE = "axi_oauth_req";
/** Rôles autorisés à connecter une application à une boutique (capacité store.settings). */
export const OAUTH_ROLES: MembershipRole[] = ["OWNER", "MANAGER"];

export class OAuthError extends Error {
  constructor(public error: string, public description: string, public status = 400) {
    super(description);
  }
}

/* ───────────────────────── Métadonnées ───────────────────────── */

export function authorizationServerMetadata() {
  const base = appBaseUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...SCOPES],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/developpeurs`,
    ui_locales_supported: ["fr"],
  };
}

export function protectedResourceMetadata() {
  const base = appBaseUrl();
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [base],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: `${SITE.name} : serveur MCP marchand`,
    resource_documentation: `${base}/developpeurs`,
  };
}

/* ───────────────────────── Enregistrement dynamique (RFC 7591) ───────────────────────── */

const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];

function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function registerClient(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OAuthError("invalid_client_metadata", "The request body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (uris.length === 0 || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "Provide 1 to 10 redirect_uris.");
  const bad = uris.find((u) => !isAllowedRedirectUri(u));
  if (bad !== undefined) throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${String(bad).slice(0, 200)} (https, http://localhost or a native app scheme; no fragment).`);
  const grantTypes = Array.isArray(b.grant_types) ? b.grant_types.map(String) : ["authorization_code", "refresh_token"];
  if (!grantTypes.includes("authorization_code") || grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "grant_types must be authorization_code (and optionally refresh_token).");
  }
  const responseTypes = Array.isArray(b.response_types) ? b.response_types.map(String) : ["code"];
  if (responseTypes.some((r) => r !== "code")) throw new OAuthError("invalid_client_metadata", "Only the 'code' response type is supported.");
  // Méthode absente : client public (PKCE), indiqué dans la réponse (RFC 7591 §3.2.1 : le serveur peut la remplacer).
  const method: AuthMethod = (AUTH_METHODS as readonly string[]).includes(String(b.token_endpoint_auth_method)) ? (b.token_endpoint_auth_method as AuthMethod) : "none";
  const name = (typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim() : "Application MCP").replace(/[\u0000-\u001f<>]/g, "").slice(0, 100);
  if (hasReservedBrand(name) && !isVerifiedClient(uris as string[])) {
    throw new OAuthError("invalid_client_metadata", "client_name uses a reserved brand (Claude, Anthropic, ChatGPT, OpenAI, Cursor, Axi) but the redirect URIs do not belong to that application.");
  }

  const clientId = generateClientId();
  const secret = method === "none" ? null : generateSecret("clientSecret");
  const client = await db.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash: secret?.hash ?? null,
      name,
      redirectUris: uris as string[],
      clientUri: httpsUrl(b.client_uri),
      logoUri: httpsUrl(b.logo_uri),
      softwareId: typeof b.software_id === "string" ? b.software_id.slice(0, 100) : null,
    },
  });
  return {
    client_id: client.clientId,
    ...(secret ? { client_secret: secret.value, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: grantTypes.includes("refresh_token") ? ["authorization_code", "refresh_token"] : ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    ...(client.clientUri ? { client_uri: client.clientUri } : {}),
    ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
  };
}

/* ───────────────────────── Demande d'autorisation ───────────────────────── */

export type AuthorizeParams = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
};

export type ValidAuthorizeRequest = {
  client: Pick<OAuthClient, "id" | "clientId" | "name" | "redirectUris" | "clientUri" | "logoUri">;
  redirectUri: string;
  scopes: Scope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
};

/** Erreur « fatale » (client ou URI de redirection invalide) : affichée, jamais redirigée. Sinon redirection avec `error`. */
export type AuthorizeValidation =
  | { ok: true; request: ValidAuthorizeRequest }
  | { ok: false; fatal: true; error: string; description: string }
  | { ok: false; fatal: false; redirectUri: string; error: string; description: string; state: string | null };

export const AUTHORIZE_KEYS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"] as const;

export function pickAuthorizeParams(raw: Record<string, unknown>): AuthorizeParams {
  const out: AuthorizeParams = {};
  for (const k of AUTHORIZE_KEYS) {
    const v = raw[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.length <= 2000) out[k] = s;
  }
  return out;
}

/**
 * Validation pure d'une demande (client déjà chargé). Testée dans tests/mcp-oauth.test.ts.
 */
export function validateAuthorize(p: AuthorizeParams, client: ValidAuthorizeRequest["client"] | null, disabled = false): AuthorizeValidation {
  if (!p.client_id || !client) return { ok: false, fatal: true, error: "invalid_client", description: "Application inconnue : relancez la connexion depuis votre assistant IA." };
  if (disabled) return { ok: false, fatal: true, error: "invalid_client", description: "Cette application a été désactivée par Axi." };
  if (hasReservedBrand(client.name) && !isVerifiedClient(client.redirectUris)) {
    return { ok: false, fatal: true, error: "invalid_client", description: "Cette application utilise le nom d'un service connu sans en être une version vérifiée. Par sécurité, la connexion est refusée." };
  }
  let redirectUri = p.redirect_uri;
  if (!redirectUri) {
    if (client.redirectUris.length !== 1) return { ok: false, fatal: true, error: "invalid_request", description: "Adresse de retour (redirect_uri) manquante." };
    redirectUri = client.redirectUris[0];
  }
  if (!matchRedirectUri(client.redirectUris, redirectUri)) return { ok: false, fatal: true, error: "invalid_request", description: "Adresse de retour (redirect_uri) non enregistrée pour cette application." };
  const state = p.state ? p.state.slice(0, 500) : null;
  const fail = (error: string, description: string): AuthorizeValidation => ({ ok: false, fatal: false, redirectUri: redirectUri!, error, description, state });

  if (p.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (!p.code_challenge) return fail("invalid_request", "PKCE is required: code_challenge is missing.");
  if ((p.code_challenge_method ?? "plain") !== "S256") return fail("invalid_request", "Only code_challenge_method=S256 is supported.");
  if (!isValidCodeChallenge(p.code_challenge)) return fail("invalid_request", "Malformed code_challenge.");
  let resource = mcpResourceUrl();
  if (p.resource) {
    const c = canonicalResource(p.resource);
    if (!c) return fail("invalid_target", `Unknown resource. Use ${mcpResourceUrl()}.`);
    resource = c;
  }
  // Scope absent : lecture seule (toute écriture doit être demandée explicitement).
  const requested = p.scope ? parseScopes(p.scope) : [...READ_SCOPES];
  if (p.scope && requested.length === 0) return fail("invalid_scope", "None of the requested scopes is supported.");
  return { ok: true, request: { client, redirectUri, scopes: requested, state, codeChallenge: p.code_challenge, resource } };
}

export async function loadAndValidateAuthorize(p: AuthorizeParams): Promise<AuthorizeValidation> {
  const client = p.client_id ? await db.oAuthClient.findUnique({ where: { clientId: p.client_id } }) : null;
  return validateAuthorize(p, client, !!client?.disabledAt);
}

export function redirectWith(uri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  url.searchParams.set("iss", appBaseUrl());
  return url.toString();
}

/** Boutiques que l'utilisateur peut connecter, avec la portée effective et la disponibilité OAuth du plan. */
export async function connectableStores(userId: string, requested: Scope[]) {
  const memberships = await db.membership.findMany({
    where: { userId, role: { in: OAUTH_ROLES }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], store: { status: { notIn: ["ARCHIVED"] } } },
    include: { store: { select: { id: true, name: true, slug: true, status: true, logoUrl: true, subscription: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => {
    const planId = effectivePlanId(m.store.subscription);
    const scopes = effectiveScopes(requested, planId, m.role);
    return { id: m.store.id, name: m.store.name, slug: m.store.slug, status: m.store.status, logoUrl: m.store.logoUrl, role: m.role, planId, oauth: MCP_LIMITS[planId].oauth, scopes, dropped: requested.filter((s) => !scopes.includes(s)) };
  });
}

export async function createAuthorizationCode(params: { request: ValidAuthorizeRequest; userId: string; storeId: string; scopes: Scope[] }): Promise<string> {
  const code = generateSecret("code");
  await db.oAuthAuthorizationCode.create({
    data: {
      codeHash: code.hash,
      clientId: params.request.client.id,
      userId: params.userId,
      storeId: params.storeId,
      scopes: params.scopes,
      redirectUri: params.request.redirectUri,
      codeChallenge: params.request.codeChallenge,
      resource: params.request.resource,
      expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
    },
  });
  return code.value;
}

/* ───────────────────────── Installation d'une application externe (App Store) ───────────────────────── */

/**
 * Marqueur stocké dans `codeChallenge` pour un code émis par l'installation d'une app depuis l'admin Axi (le flux
 * est lancé par Axi, pas par l'app : pas de PKCE possible). Jamais un défi PKCE valide (43 caractères base64url) :
 * aucune collision avec les codes du flux MCP, dont la vérification PKCE reste inchangée.
 * À l'échange : client CONFIDENTIEL obligatoire (client_secret vérifié), et le jeton est lié au grant de
 * l'installation ACTIVE (AppInstallation.oauthGrantId). Contrat : docs/apps-v2/int.md.
 */
export const APP_INSTALL_CODE_CHALLENGE = "app-install";

export async function createAppInstallCode(
  tx: Tx | typeof db,
  p: { clientDbId: string; userId: string; storeId: string; scopes: string[]; redirectUri: string },
): Promise<string> {
  const code = generateSecret("code");
  await tx.oAuthAuthorizationCode.create({
    data: {
      codeHash: code.hash,
      clientId: p.clientDbId,
      userId: p.userId,
      storeId: p.storeId,
      scopes: p.scopes,
      redirectUri: p.redirectUri,
      codeChallenge: APP_INSTALL_CODE_CHALLENGE,
      resource: mcpResourceUrl(),
      expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
    },
  });
  return code.value;
}

/**
 * Lien client OAuth → installation : null si le client n'est pas celui d'une app de l'App Store ; sinon
 * `grantId` = grant de l'installation ACTIVE sur cette boutique (null si non installée ou installation inactive).
 */
export async function appInstallationGrant(tx: Tx | typeof db, publicClientId: string, storeId: string): Promise<{ appId: string; grantId: string | null } | null> {
  const app = await tx.app.findUnique({ where: { oauthClientId: publicClientId }, select: { id: true } });
  if (!app) return null;
  const inst = await tx.appInstallation.findUnique({ where: { appId_storeId: { appId: app.id, storeId } }, select: { status: true, oauthGrantId: true } });
  return { appId: app.id, grantId: inst && inst.status === "ACTIVE" ? inst.oauthGrantId : null };
}

/** Grants rattachés à une installation (tout statut) de l'app de ce client sur la boutique : réservés à l'installation. */
async function appInstallationGrantIds(tx: Tx | typeof db, publicClientId: string, storeId: string): Promise<string[]> {
  const app = await tx.app.findUnique({ where: { oauthClientId: publicClientId }, select: { id: true } });
  if (!app) return [];
  const rows = await tx.appInstallation.findMany({ where: { appId: app.id, storeId, oauthGrantId: { not: null } }, select: { oauthGrantId: true } });
  return rows.map((r) => r.oauthGrantId).filter((id): id is string => !!id);
}

/* ───────────────────────── Point de jeton ───────────────────────── */

export type ClientCredentials = { clientId: string | null; clientSecret: string | null };

/** client_id / client_secret depuis le corps ou l'en-tête Basic. */
export function clientCredentials(form: URLSearchParams, authorization: string | null): ClientCredentials {
  let clientId = form.get("client_id");
  let clientSecret = form.get("client_secret");
  const m = authorization ? /^Basic\s+(.+)$/i.exec(authorization) : null;
  if (m) {
    try {
      const [id, secret] = Buffer.from(m[1], "base64").toString("utf8").split(":");
      clientId = decodeURIComponent(id ?? "") || clientId;
      clientSecret = decodeURIComponent(secret ?? "") || clientSecret;
    } catch {
      // en-tête invalide : ignoré
    }
  }
  return { clientId, clientSecret };
}

async function authenticateClient(creds: ClientCredentials): Promise<OAuthClient> {
  if (!creds.clientId) throw new OAuthError("invalid_client", "client_id is required.", 401);
  const client = await db.oAuthClient.findUnique({ where: { clientId: creds.clientId } });
  if (!client || client.disabledAt) throw new OAuthError("invalid_client", "Unknown or disabled client.", 401);
  if (client.clientSecretHash && (!creds.clientSecret || !verifyToken(creds.clientSecret, client.clientSecretHash))) {
    throw new OAuthError("invalid_client", "Client authentication failed.", 401);
  }
  return client;
}

async function assertGrantAllowed(userId: string, storeId: string): Promise<{ role: MembershipRole; planId: ReturnType<typeof effectivePlanId> }> {
  const [m, store] = await Promise.all([
    db.membership.findUnique({ where: { userId_storeId: { userId, storeId } }, select: { role: true, expiresAt: true } }),
    db.store.findUnique({ where: { id: storeId }, select: { status: true, subscription: true } }),
  ]);
  if (!m || (m.expiresAt && m.expiresAt <= new Date()) || !OAUTH_ROLES.includes(m.role)) throw new OAuthError("invalid_grant", "The user no longer has access to this store.");
  if (!store || store.status === "ARCHIVED") throw new OAuthError("invalid_grant", "This store is not available.");
  const planId = effectivePlanId(store.subscription);
  if (!MCP_LIMITS[planId].oauth) throw new OAuthError("invalid_grant", "One-click connections require the Business plan or higher for this store.");
  return { role: m.role, planId };
}

async function issueTokens(grantId: string, scopes: string[], tx: Tx | typeof db = db) {
  const access = generateSecret("access");
  const refresh = generateSecret("refresh");
  const now = Date.now();
  await tx.oAuthToken.createMany({
    data: [
      { grantId, kind: "access", tokenHash: access.hash, expiresAt: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000) },
      { grantId, kind: "refresh", tokenHash: refresh.hash, expiresAt: new Date(now + REFRESH_TOKEN_TTL_SEC * 1000) },
    ],
  });
  return { access_token: access.value, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SEC, refresh_token: refresh.value, scope: formatScopes(scopes) };
}

async function revokeGrant(grantId: string, reason: string) {
  const now = new Date();
  await db.$transaction([
    db.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now } }),
    db.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  const g = await db.oAuthGrant.findUnique({ where: { id: grantId }, select: { storeId: true, userId: true } });
  if (g) await audit({ storeId: g.storeId, actorId: null, action: "api.oauth.revoked", target: grantId, metadata: { reason } }).catch(() => {});
}

export async function exchangeAuthorizationCode(form: URLSearchParams, creds: ClientCredentials) {
  const client = await authenticateClient(creds);
  const code = form.get("code");
  if (!code) throw new OAuthError("invalid_request", "code is required.");
  const found = await db.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashToken(code) }, select: { id: true, clientId: true, userId: true, storeId: true } });
  if (!found || found.clientId !== client.id) throw new OAuthError("invalid_grant", "Invalid authorization code.");
  // Droits relus hors verrou (lecture seule) ; un refus consomme quand même le code.
  const allowed = await assertGrantAllowed(found.userId, found.storeId).catch((e: unknown) => (e instanceof OAuthError ? e : Promise.reject(e)));

  // Une seule transaction, ligne verrouillée : consommation du code, autorisation, `grantId` et jetons sont
  // écrits ensemble. Une seconde présentation voit donc toujours `grantId` et peut révoquer l'accès produit.
  type Outcome = { tokens: Awaited<ReturnType<typeof issueTokens>> } | { reuse: string | null } | { error: OAuthError };
  const outcome: Outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OAuthAuthorizationCode" WHERE id = ${found.id} FOR UPDATE`;
    const row = await tx.oAuthAuthorizationCode.findUnique({ where: { id: found.id } });
    if (!row) return { error: new OAuthError("invalid_grant", "Invalid authorization code.") };
    if (row.usedAt) return { reuse: row.grantId };
    const now = new Date();
    const fail = async (e: OAuthError): Promise<Outcome> => {
      await tx.oAuthAuthorizationCode.update({ where: { id: row.id }, data: { usedAt: now } });
      return { error: e };
    };
    if (row.expiresAt <= now) return fail(new OAuthError("invalid_grant", "Authorization code expired."));
    if (row.codeChallenge === APP_INSTALL_CODE_CHALLENGE) {
      // Code d'installation d'app : client confidentiel (secret déjà vérifié par authenticateClient), sans PKCE ;
      // redirect_uri facultative mais, si fournie, identique ; jetons émis sur le grant de l'installation active.
      if (!client.clientSecretHash) return fail(new OAuthError("invalid_client", "This authorization code requires a confidential client (client_secret)."));
      const sentRedirect = form.get("redirect_uri");
      if (sentRedirect && sentRedirect !== row.redirectUri) return fail(new OAuthError("invalid_grant", "redirect_uri does not match the installation redirect."));
      if (allowed instanceof OAuthError) return fail(allowed);
      const link = await appInstallationGrant(tx, client.clientId, row.storeId);
      const grant = link?.grantId ? await tx.oAuthGrant.findUnique({ where: { id: link.grantId } }) : null;
      if (!grant || grant.revokedAt || grant.clientId !== client.id || grant.storeId !== row.storeId) {
        return fail(new OAuthError("invalid_grant", "The app is no longer installed on this store."));
      }
      await tx.oAuthAuthorizationCode.update({ where: { id: row.id }, data: { usedAt: now, grantId: grant.id } });
      await tx.oAuthClient.update({ where: { id: client.id }, data: { lastUsedAt: now } });
      return { tokens: await issueTokens(grant.id, effectiveScopes(grant.scopes, allowed.planId, allowed.role), tx) };
    }
    if (form.get("redirect_uri") !== row.redirectUri) return fail(new OAuthError("invalid_grant", "redirect_uri does not match the authorization request."));
    if (!verifyPkceS256(form.get("code_verifier"), row.codeChallenge)) return fail(new OAuthError("invalid_grant", "PKCE verification failed."));
    const resource = form.get("resource");
    if (resource && canonicalResource(resource) !== row.resource) return fail(new OAuthError("invalid_target", "resource does not match the authorization request."));
    if (allowed instanceof OAuthError) return fail(allowed);

    const scopes = effectiveScopes(row.scopes, allowed.planId, allowed.role);
    // Un grant référencé par une AppInstallation appartient à l'installation (portée, cycle de vie, révocation à la
    // désinstallation) : le flux /oauth/authorize ne le réutilise ni ne l'écrase jamais — il obtient son propre grant.
    const installGrantIds = await appInstallationGrantIds(tx, client.clientId, row.storeId);
    const existing = await tx.oAuthGrant.findFirst({
      where: { clientId: client.id, userId: row.userId, storeId: row.storeId, revokedAt: null, ...(installGrantIds.length ? { id: { notIn: installGrantIds } } : {}) },
      select: { id: true },
    });
    const grant = existing
      ? await tx.oAuthGrant.update({ where: { id: existing.id }, data: { scopes: row.scopes, resource: row.resource } })
      : await tx.oAuthGrant.create({ data: { clientId: client.id, userId: row.userId, storeId: row.storeId, scopes: row.scopes, resource: row.resource } });
    await tx.oAuthAuthorizationCode.update({ where: { id: row.id }, data: { usedAt: now, grantId: grant.id } });
    await tx.oAuthClient.update({ where: { id: client.id }, data: { lastUsedAt: now } });
    return { tokens: await issueTokens(grant.id, scopes, tx) };
  });

  if ("reuse" in outcome) {
    if (outcome.reuse) await revokeGrant(outcome.reuse, "authorization_code_reuse");
    throw new OAuthError("invalid_grant", "Authorization code already used.");
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.tokens;
}

export async function refreshAccessToken(form: URLSearchParams, creds: ClientCredentials) {
  const client = await authenticateClient(creds);
  const token = form.get("refresh_token");
  if (!token) throw new OAuthError("invalid_request", "refresh_token is required.");
  const row = await db.oAuthToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { grant: true } });
  if (!row || row.kind !== "refresh" || row.grant.clientId !== client.id) throw new OAuthError("invalid_grant", "Invalid refresh token.");
  if (row.grant.revokedAt || row.revokedAt) throw new OAuthError("invalid_grant", "This access has been revoked.");
  if (row.expiresAt <= new Date()) throw new OAuthError("invalid_grant", "Refresh token expired.");
  // Rotation : un jeton de rafraîchissement ne sert qu'une fois ; une réutilisation (vol probable) révoque tout l'accès.
  const consumed = await db.oAuthToken.updateMany({ where: { id: row.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } });
  if (consumed.count === 0) {
    await revokeGrant(row.grantId, "refresh_token_reuse");
    throw new OAuthError("invalid_grant", "Refresh token already used: access revoked for safety. Reconnect the application.");
  }
  // Scope réduit demandé : l'autorisation est DÉFINITIVEMENT restreinte à ce sous-ensemble (sans colonne de scope
  // par jeton, c'est la seule façon de n'émettre que le scope demandé ; plus restrictif = plus sûr).
  let grantScopes = row.grant.scopes;
  const scope = form.get("scope");
  if (scope) {
    const requested = parseScopes(scope);
    if (!requested.length || requested.some((s) => !row.grant.scopes.includes(s))) throw new OAuthError("invalid_scope", "The requested scope exceeds the authorization.");
    if (requested.length < row.grant.scopes.length) {
      await db.oAuthGrant.update({ where: { id: row.grantId }, data: { scopes: requested } });
      grantScopes = requested;
    }
  }
  const resource = form.get("resource");
  if (resource && canonicalResource(resource) !== (row.grant.resource ?? mcpResourceUrl())) throw new OAuthError("invalid_target", "resource does not match the authorization.");
  const { role, planId } = await assertGrantAllowed(row.grant.userId, row.grant.storeId);
  // Client d'une app de l'App Store : le grant doit être celui d'une installation encore ACTIVE, et l'app ne doit pas
  // être suspendue par la plateforme (sinon on émettrait des jetons aussitôt refusés par l'API).
  const link = await appInstallationGrant(db, client.clientId, row.grant.storeId);
  if (link) {
    if (link.grantId !== row.grantId) throw new OAuthError("invalid_grant", "The app is no longer installed on this store.");
    const linked = await db.app.findUnique({ where: { id: link.appId }, select: { status: true } });
    if (!linked || linked.status === "SUSPENDED") throw new OAuthError("invalid_grant", "The app is suspended.");
  }
  await db.oAuthClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
  return issueTokens(row.grantId, effectiveScopes(grantScopes, planId, role));
}

/** RFC 7009 : réponse identique que le jeton existe ou non. Un refresh révoqué révoque toute l'autorisation. */
export async function revokeToken(form: URLSearchParams, creds: ClientCredentials): Promise<void> {
  const token = form.get("token");
  if (!token) throw new OAuthError("invalid_request", "token is required.");
  const client = creds.clientId ? await db.oAuthClient.findUnique({ where: { clientId: creds.clientId } }) : null;
  if (client?.clientSecretHash && (!creds.clientSecret || !verifyToken(creds.clientSecret, client.clientSecretHash))) throw new OAuthError("invalid_client", "Client authentication failed.", 401);
  const row = await db.oAuthToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { grant: { select: { clientId: true } } } });
  if (!row || (client && row.grant.clientId !== client.id)) return;
  if (row.kind === "refresh") await revokeGrant(row.grantId, "client_revocation");
  else await db.oAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export const ALL_SCOPES = SCOPES;
