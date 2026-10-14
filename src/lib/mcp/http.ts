import "server-only";
import { RPC_ERROR, rpcError, isSupportedProtocolVersion, DEFAULT_NEGOTIATED_VERSION, LATEST_PROTOCOL_VERSION, type JsonRpcResponse } from "./protocol";

/**
 * Transport « Streamable HTTP » de MCP en mode sans état : POST JSON-RPC → réponse `application/json`
 * (jamais de flux SSE ni de session `Mcp-Session-Id`). GET et DELETE → 405.
 *
 * CORS ouvert (`*`) sans cookie : l'authentification se fait uniquement par en-tête `Authorization`,
 * jamais par la session du navigateur — un site tiers ne peut donc rien faire au nom d'un marchand.
 */

export const MAX_BODY_BYTES = 1_000_000;

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version, Retry-After",
  "Access-Control-Max-Age": "86400",
};

const BASE_HEADERS: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS_HEADERS };

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...BASE_HEADERS, ...extra } });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export function methodNotAllowed(): Response {
  return jsonResponse(rpcError(null, RPC_ERROR.INVALID_REQUEST, "Method Not Allowed: this MCP server is stateless and only accepts POST (no SSE stream)."), 405, { Allow: "POST, OPTIONS" });
}

export function unavailable(message: string): Response {
  return jsonResponse(rpcError(null, RPC_ERROR.UNAVAILABLE, message), 503, { "Retry-After": "300" });
}

export function rateLimited(retryAfterSec: number, message = "Rate limit exceeded"): Response {
  const s = Math.max(1, Math.ceil(retryAfterSec));
  return jsonResponse(rpcError(null, RPC_ERROR.RATE_LIMITED, `${message}. Retry in ${s} s.`, { retryAfter: s }), 429, { "Retry-After": String(s) });
}

/** Lecture et contrôle du corps : Content-Type, version de protocole, taille, JSON valide. */
export async function readJsonRpcBody(req: Request): Promise<{ ok: true; payload: unknown; protocolVersion: string } | { ok: false; response: Response }> {
  const version = req.headers.get("mcp-protocol-version");
  if (version && !isSupportedProtocolVersion(version)) {
    return { ok: false, response: jsonResponse(rpcError(null, RPC_ERROR.INVALID_REQUEST, `Bad Request: unsupported MCP-Protocol-Version "${version.slice(0, 40)}"`), 400) };
  }
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("application/json")) {
    return { ok: false, response: jsonResponse(rpcError(null, RPC_ERROR.INVALID_REQUEST, "Content-Type must be application/json"), 415) };
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, response: jsonResponse(rpcError(null, RPC_ERROR.INVALID_REQUEST, "Request body too large"), 413) };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonResponse(rpcError(null, RPC_ERROR.PARSE_ERROR, "Parse error: unreadable body"), 400) };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, response: jsonResponse(rpcError(null, RPC_ERROR.INVALID_REQUEST, "Request body too large"), 413) };
  try {
    const payload: unknown = JSON.parse(text);
    // Sans en-tête : la version négociée par `initialize` si c'est la requête, sinon la valeur par défaut de la spécification.
    const initVersion =
      !Array.isArray(payload) && payload && typeof payload === "object" && (payload as { method?: unknown }).method === "initialize"
        ? LATEST_PROTOCOL_VERSION
        : DEFAULT_NEGOTIATED_VERSION;
    return { ok: true, payload, protocolVersion: version ?? initVersion };
  } catch {
    return { ok: false, response: jsonResponse(rpcError(null, RPC_ERROR.PARSE_ERROR, "Parse error: invalid JSON"), 400) };
  }
}

/** Réponse HTTP d'un traitement : 202 sans corps quand il n'y avait que des notifications. */
export function respond(result: JsonRpcResponse | JsonRpcResponse[] | null, protocolVersion: string): Response {
  if (result === null) return new Response(null, { status: 202, headers: BASE_HEADERS });
  const invalidBatch = !Array.isArray(result) && "error" in result && result.error.code === RPC_ERROR.INVALID_REQUEST && result.id === null;
  return jsonResponse(result, invalidBatch ? 400 : 200, { "MCP-Protocol-Version": protocolVersion });
}
