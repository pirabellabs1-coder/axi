import { normalizeIp, rateLimit } from "@/lib/rate-limit";
import { authenticateMerchant, type AuthFailure } from "@/lib/mcp/auth";
import { merchantServer } from "@/lib/mcp/merchant/server";
import { handleMcpPayload, messageCount } from "@/lib/mcp/protocol";
import { jsonResponse, methodNotAllowed, preflight, rateLimited, readJsonRpcBody, respond, unavailable } from "@/lib/mcp/http";
import { checkMinuteQuota, getMcpKillSwitch, logApiRequest, protectedResourceMetadataUrl } from "@/lib/mcp/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serveur MCP marchand — Streamable HTTP sans état (spécification MCP 2025-06-18).
 * Auth : `Authorization: Bearer <jeton API axi_live_… | jeton OAuth axi_oat_…>`. Référence : docs/API-MCP.md.
 */

function authChallenge(f: AuthFailure): Response {
  const parts = [`Bearer resource_metadata="${protectedResourceMetadataUrl()}"`];
  if (f.error) parts.push(`error="${f.error}"`, `error_description="${f.description.replace(/"/g, "'")}"`);
  return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32001, message: f.status === 401 ? `Unauthorized: ${f.description}` : `Forbidden: ${f.description}` } }, f.status, { "WWW-Authenticate": parts.join(", ") });
}

export async function POST(req: Request) {
  const kill = await getMcpKillSwitch();
  if (kill.enabled) return unavailable(kill.message || "The Axi MCP server is temporarily unavailable. Please try again later.");

  const ip = normalizeIp(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"));
  const auth = await authenticateMerchant(req.headers.get("authorization"), ip);
  if (!auth.ok) {
    // Échecs répétés depuis une même IP : ralentis (protège la base, pas la force brute : 240 bits d'entropie).
    if (auth.error === "invalid_token") {
      const rl = await rateLimit(`mcp:authfail:ip:${ip}`, 30, 60);
      if (!rl.ok) return rateLimited(rl.retryAfter, "Too many invalid tokens");
    }
    return authChallenge(auth);
  }
  const ctx = auth.ctx;

  const body = await readJsonRpcBody(req);
  if (!body.ok) return body.response;

  // Quota par minute compté PAR MESSAGE (un lot ancienne version de N messages consomme N unités).
  const principal = ctx.actor.tokenId ? `token:${ctx.actor.tokenId}` : `grant:${ctx.actor.grantId}`;
  const minute = await checkMinuteQuota(ctx.planId, ctx.store.id, principal, messageCount(body.payload));
  if (!minute.ok) {
    logApiRequest({ storeId: ctx.store.id, tokenId: ctx.actor.tokenId, grantId: ctx.actor.grantId, actorLabel: ctx.actor.label, method: "http", status: "rate_limited", durationMs: 0, ip });
    return rateLimited(minute.retryAfter, "Per-minute call quota of the store's plan exceeded");
  }

  const result = await handleMcpPayload(merchantServer, ctx, body.payload, body.protocolVersion);
  return respond(result, body.protocolVersion);
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return preflight();
}
