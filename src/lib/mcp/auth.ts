import "server-only";
import type { MembershipRole, Store, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { effectivePlanId } from "@/lib/billing/rules";
import { MCP_LIMITS, type PlanId } from "@/config/plans";
import { effectiveScopes, type Scope } from "./scopes";
import { hashToken, hashesEqual, tokenKind, verifyToken, visiblePrefix } from "./tokens";
import { mcpResourceUrl, touchApiToken, touchOAuthGrant } from "./runtime";

/**
 * Authentification du serveur MCP marchand : `Authorization: Bearer <jeton API axi_live_…>` ou jeton
 * d'accès OAuth (`axi_oat_…`). La boutique est TOUJOURS déduite du jeton, jamais d'un paramètre client.
 *
 * À chaque requête : jeton non révoqué / non expiré, membre toujours actif dans la boutique, boutique non
 * archivée, plan effectif relu (scopes et quotas), rôle du membre (scopes délégables).
 */

export type McpStore = Pick<Store, "id" | "name" | "slug" | "currency" | "timezone" | "status" | "country" | "whatsappNumber">;

export type MerchantContext = {
  store: McpStore;
  planId: PlanId;
  role: MembershipRole;
  /** Scopes effectifs (jeton ∩ plan ∩ rôle). */
  scopes: Scope[];
  /** Scopes demandés par le jeton mais retirés par le plan ou le rôle (pour des messages clairs). */
  droppedScopes: Scope[];
  actor: { kind: "token" | "oauth"; userId: string; label: string; tokenId: string | null; grantId: string | null; clientName: string | null; appId?: string | null };
  ip: string;
};

export type AuthFailure = { ok: false; status: 401 | 403; error: "invalid_token" | "insufficient_scope" | "invalid_request" | null; description: string };
export type AuthSuccess = { ok: true; ctx: MerchantContext };

const STORE_SELECT = { id: true, name: true, slug: true, currency: true, timezone: true, status: true, country: true, whatsappNumber: true, subscription: true } as const;

type StoreWithSub = McpStore & { subscription: Subscription | null };

function unauthorized(description: string, error: AuthFailure["error"] = "invalid_token"): AuthFailure {
  return { ok: false, status: 401, error, description };
}

export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

async function activeRole(userId: string | null, storeId: string): Promise<MembershipRole | null> {
  if (!userId) return null;
  const m = await db.membership.findUnique({ where: { userId_storeId: { userId, storeId } }, select: { role: true, expiresAt: true } });
  if (!m || (m.expiresAt && m.expiresAt <= new Date())) return null;
  return m.role;
}

function storeOf(s: StoreWithSub): McpStore {
  return { id: s.id, name: s.name, slug: s.slug, currency: s.currency, timezone: s.timezone, status: s.status, country: s.country, whatsappNumber: s.whatsappNumber };
}

export async function authenticateMerchant(authorization: string | null, ip: string): Promise<AuthSuccess | AuthFailure> {
  const token = bearerFrom(authorization);
  if (!token) return unauthorized("Missing bearer token", null);
  const kind = tokenKind(token);
  if (kind === "api") return authenticateApiToken(token, ip);
  if (kind === "access") return authenticateAccessToken(token, ip);
  return unauthorized("Invalid or unsupported token");
}

async function authenticateApiToken(token: string, ip: string): Promise<AuthSuccess | AuthFailure> {
  const candidates = await db.apiToken.findMany({
    where: { prefix: visiblePrefix(token) },
    include: { store: { select: STORE_SELECT } },
    take: 5,
  });
  // Comparaison en temps constant du hachage pour chaque candidat (préfixe = simple index de recherche).
  const row = candidates.find((c) => verifyToken(token, c.secretHash));
  if (!row) return unauthorized("Invalid token");
  if (row.revokedAt) return unauthorized("This token has been revoked");
  if (row.expiresAt && row.expiresAt <= new Date()) return unauthorized("This token has expired");
  if (row.store.status === "ARCHIVED") return unauthorized("This store is archived");

  const role = await activeRole(row.createdById, row.storeId);
  if (!role) return unauthorized("The member who created this token no longer has access to the store");

  const planId = effectivePlanId(row.store.subscription);
  const scopes = effectiveScopes(row.scopes, planId, role);
  touchApiToken(row.id, ip);
  return {
    ok: true,
    ctx: {
      store: storeOf(row.store),
      planId,
      role,
      scopes,
      droppedScopes: row.scopes.filter((s) => !scopes.includes(s as Scope)) as Scope[],
      actor: { kind: "token", userId: row.createdById!, label: `api:${row.name}`, tokenId: row.id, grantId: null, clientName: null },
      ip,
    },
  };
}

async function authenticateAccessToken(token: string, ip: string): Promise<AuthSuccess | AuthFailure> {
  const hash = hashToken(token);
  const row = await db.oAuthToken.findUnique({
    where: { tokenHash: hash },
    include: { grant: { include: { client: { select: { id: true, clientId: true, name: true, disabledAt: true } }, store: { select: STORE_SELECT } } } },
  });
  if (!row || row.kind !== "access" || !hashesEqual(hash, row.tokenHash)) return unauthorized("Invalid token");
  if (row.revokedAt || row.grant.revokedAt) return unauthorized("This access has been revoked");
  if (row.expiresAt <= new Date()) return unauthorized("The access token has expired");
  if (row.grant.client.disabledAt) return unauthorized("This application has been disabled by Axi");
  // Audience (RFC 8707) : un jeton émis pour une autre ressource n'est pas accepté ici.
  if (row.grant.resource && row.grant.resource !== mcpResourceUrl()) return unauthorized("Token audience mismatch");
  const store = row.grant.store;
  if (store.status === "ARCHIVED") return unauthorized("This store is archived");

  const role = await activeRole(row.grant.userId, store.id);
  if (!role) return unauthorized("The member who authorized this application no longer has access to the store");

  const planId = effectivePlanId(store.subscription);
  if (!MCP_LIMITS[planId].oauth) {
    return { ok: false, status: 403, error: "insufficient_scope", description: "One-click connections (OAuth) require the Business plan or higher. Use an API token instead, or upgrade the store plan." };
  }
  // Application de l'App Store : le jeton n'est valable que sur le grant de l'installation ACTIVE (désinstallée,
  // suspendue ou autre grant du même client ⇒ refus). Portée = scopes du grant ∩ installation ∩ plan ∩ rôle.
  let grantScopes = row.grant.scopes;
  let appId: string | null = null;
  const app = await db.app.findUnique({ where: { oauthClientId: row.grant.client.clientId }, select: { id: true, status: true } });
  if (app) {
    if (app.status === "SUSPENDED") return unauthorized("This app has been suspended by Axi");
    const inst = await db.appInstallation.findUnique({ where: { appId_storeId: { appId: app.id, storeId: store.id } }, select: { status: true, oauthGrantId: true, grantedScopes: true } });
    if (!inst || inst.status !== "ACTIVE" || inst.oauthGrantId !== row.grant.id) return unauthorized("This app is not installed on the store anymore");
    grantScopes = row.grant.scopes.filter((s) => inst.grantedScopes.includes(s));
    appId = app.id;
  }
  const scopes = effectiveScopes(grantScopes, planId, role);
  touchOAuthGrant(row.grant.id, row.grant.client.id);
  return {
    ok: true,
    ctx: {
      store: storeOf(store),
      planId,
      role,
      scopes,
      droppedScopes: grantScopes.filter((s) => !scopes.includes(s as Scope)) as Scope[],
      actor: { kind: "oauth", userId: row.grant.userId, label: `oauth:${row.grant.client.name}`, tokenId: null, grantId: row.grant.id, clientName: row.grant.client.name, appId },
      ip,
    },
  };
}
