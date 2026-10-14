import "server-only";
import { REST_API_ACCESS, PLANS } from "@/config/plans";
import { rateLimit } from "@/lib/rate-limit";
import { authenticateMerchant, bearerFrom, type MerchantContext } from "@/lib/mcp/auth";
import { tokenKind } from "@/lib/mcp/tokens";
import { planForScope, type Scope } from "@/lib/mcp/scopes";
import { checkDailyQuota, checkMinuteQuota } from "@/lib/mcp/runtime";
import { ApiError } from "./problem";

/**
 * Authentification de l'API REST /api/v1 — réutilise celle du MCP (src/lib/mcp/auth.ts) :
 *  - `Authorization: Bearer axi_live_…` (jeton API d'une boutique ; la boutique est déduite du jeton) ;
 *    les jetons OAuth (`axi_oat_…`) des connecteurs IA ont pour audience le serveur MCP et sont refusés ici, SAUF ceux
 *    d'une application de l'App Store liés à une installation ACTIVE (portée = grant ∩ installation ∩ plan ∩ rôle,
 *    voir src/lib/mcp/auth.ts ; contrat docs/apps-v2/int.md) ;
 *  - portée effective = scopes du jeton ∩ plan ∩ rôle du créateur, recalculée à chaque requête ;
 *  - niveau d'API du plan (REST_API_ACCESS) : aucun (Gratuit, Starter), lecture seule (Business), complet (Scale+) ;
 *  - quotas MCP_LIMITS partagés avec le MCP (par minute : boutique + jeton ; par jour : boutique).
 */

export type RestContext = MerchantContext;

export async function authenticateRest(req: Request, ip: string, opts: { method: string; scope: Scope }): Promise<RestContext> {
  const header = req.headers.get("authorization");
  const token = bearerFrom(header);
  if (!token) throw new ApiError(401, "unauthorized", "Missing bearer token. Send Authorization: Bearer axi_live_…", {}, { "WWW-Authenticate": 'Bearer realm="axi-api"' });
  const kind = tokenKind(token);
  if (kind !== "api" && kind !== "access") {
    await throttleFailures(ip);
    throw new ApiError(401, "unauthorized", "Invalid token. The REST API accepts store API tokens (axi_live_…) and installed app access tokens (axi_oat_…).", {}, { "WWW-Authenticate": 'Bearer realm="axi-api", error="invalid_token"' });
  }
  const auth = await authenticateMerchant(header, ip);
  if (!auth.ok) {
    if (auth.error === "invalid_token") await throttleFailures(ip);
    throw new ApiError(auth.status, auth.status === 401 ? "unauthorized" : "forbidden", auth.description, {}, auth.status === 401 ? { "WWW-Authenticate": 'Bearer realm="axi-api", error="invalid_token"' } : {});
  }
  const ctx = auth.ctx;
  if (kind === "access" && !ctx.actor.appId) {
    await throttleFailures(ip);
    throw new ApiError(401, "unauthorized", "This OAuth token is for the MCP server. The REST API accepts store API tokens (axi_live_…) and installed app access tokens only.", {}, { "WWW-Authenticate": 'Bearer realm="axi-api", error="invalid_token"' });
  }

  const access = REST_API_ACCESS[ctx.planId];
  if (access === "none") throw new ApiError(403, "plan_required", `The REST API is included from the Business plan (read-only) and the Scale plan (read and write). Current plan: ${PLANS[ctx.planId].name}.`);
  if (access === "read" && opts.method !== "GET") throw new ApiError(403, "plan_required", `The ${PLANS[ctx.planId].name} plan includes read-only REST API access. Write operations require the Scale plan or higher.`);

  if (!ctx.scopes.includes(opts.scope)) {
    const droppedByPlanOrRole = ctx.droppedScopes.includes(opts.scope);
    throw new ApiError(
      403,
      "insufficient_scope",
      droppedByPlanOrRole
        ? `This operation requires the ${opts.scope} scope, which the store plan or the token creator's role does not allow (needs at least the ${PLANS[planForScope(opts.scope)].name} plan).`
        : `This operation requires the ${opts.scope} scope. Create a token with this scope in Axi (Intégrations › Connecteurs IA).`,
      { required_scope: opts.scope },
      { "WWW-Authenticate": `Bearer realm="axi-api", error="insufficient_scope", scope="${opts.scope}"` },
    );
  }

  const minute = await checkMinuteQuota(ctx.planId, ctx.store.id, ctx.actor.tokenId ? `token:${ctx.actor.tokenId}` : `grant:${ctx.actor.grantId}`);
  if (!minute.ok) throw rateLimited(minute.retryAfter, "Per-minute call quota of the store plan exceeded.");
  const day = await checkDailyQuota(ctx.planId, ctx.store.id);
  if (!day.ok) throw rateLimited(day.retryAfter, "Daily call quota of the store plan exceeded.");

  // Boutique suspendue : lecture et suppression (retirer un accès sortant) seulement.
  if ((opts.method === "POST" || opts.method === "PATCH") && ctx.store.status === "SUSPENDED") {
    throw new ApiError(403, "store_suspended", "This store is suspended: write operations are disabled.");
  }
  return ctx;
}

function rateLimited(retryAfter: number, detail: string): ApiError {
  const s = Math.max(1, Math.ceil(retryAfter));
  return new ApiError(429, "rate_limited", `${detail} Retry in ${s} s.`, { retry_after: s }, { "Retry-After": String(s) });
}

/** Échecs répétés depuis une même IP : 30 / min puis 429 (protège la base ; 240 bits d'entropie par jeton). */
async function throttleFailures(ip: string) {
  const rl = await rateLimit(`api:authfail:ip:${ip}`, 30, 60);
  if (!rl.ok) throw rateLimited(rl.retryAfter, "Too many invalid tokens.");
}
