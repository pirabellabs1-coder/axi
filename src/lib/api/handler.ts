import "server-only";
import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { normalizeIp } from "@/lib/rate-limit";
import { logApiRequest } from "@/lib/mcp/runtime";
import { ToolError } from "@/lib/mcp/protocol";
import type { McpTool } from "@/lib/mcp/protocol";
import type { Scope } from "@/lib/mcp/scopes";
import { WebhookError } from "@/lib/webhooks/service";
import { authenticateRest, type RestContext } from "./auth";
import { ApiError, jsonOk, negotiateVersion, problemResponse, API_VERSION } from "./problem";
import { scheduleIdempotencyPurge, validateIdempotencyKey, withIdempotency } from "./idempotency";

/**
 * Enveloppe commune des routes /api/v1 : identifiant de requête, version (`Axi-Api-Version`), authentification et
 * portée, lecture du corps JSON (1 Mo max), idempotence des POST, traduction des erreurs en problem+json (RFC 9457),
 * journal ApiRequestLog (`method = "REST GET /v1/orders"`). Les erreurs inattendues ne renvoient aucun détail interne.
 */

export const MAX_BODY_BYTES = 1_000_000;

export type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type RestResult = { status: number; body?: unknown; headers?: Record<string, string> };
export type RestCall<P> = { req: Request; ctx: RestContext; params: P; body: unknown; url: URL; requestId: string };

type RouteSpec = { method: RestMethod; route: string; scope: Scope };

export function newRequestId(): string {
  return `req_${randomBytes(12).toString("base64url")}`;
}

/** Traduit une erreur métier (outil MCP, service webhooks, zod) en ApiError ; null = erreur inattendue. */
export function toApiError(e: unknown): ApiError | null {
  if (e instanceof ApiError) return e;
  if (e instanceof ZodError) {
    return new ApiError(400, "validation_failed", "The request body or parameters are invalid.", {
      errors: e.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (e instanceof WebhookError) {
    const status = e.code === "not_found" ? 404 : e.code === "plan_required" || e.code === "plan_limit" || e.code === "forbidden" ? 403 : 422;
    return new ApiError(status, e.code === "invalid" ? "unprocessable" : e.code, e.message);
  }
  if (e instanceof ToolError) {
    if (e.code === "confirmation_required") return new ApiError(409, "confirmation_required", `${e.message.replace(/call the tool again with confirm: true/i, "repeat the request with ?confirm=true and a new Idempotency-Key")}`);
    if (e.code === "plan_limit") return new ApiError(403, "plan_limit", e.message);
    if (e.code === "plan_required") return new ApiError(403, "plan_required", e.message);
    if (e.code === "store_suspended") return new ApiError(403, "store_suspended", e.message);
    if (/not found/i.test(e.message)) return new ApiError(404, "not_found", e.message);
    return new ApiError(422, "unprocessable", e.message);
  }
  return null;
}

async function readBody(req: Request, method: RestMethod): Promise<unknown> {
  if (method === "GET" || method === "DELETE") return null;
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Request body larger than 1 MB.");
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Request body larger than 1 MB.");
  if (!text.trim()) return {};
  if (!type.includes("application/json")) throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json.");
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new ApiError(400, "invalid_request", "The request body must be a JSON object.");
  }
}

/** Préfixe non secret d'un jeton présenté (12 caractères : famille et début, jamais de quoi le rejouer). */
export function tokenHint(header: string | null): string | null {
  const raw = header?.replace(/^Bearer\s+/i, "").trim();
  if (!raw) return null;
  return `${raw.slice(0, 12)}…`;
}

function logUnauthenticated(req: Request, ip: string, logMethod: string, api: ApiError, requestId: string): void {
  console.warn(`[api] denied ${logMethod}`, { requestId, ip, status: api.status, code: api.code, token: tokenHint(req.headers.get("authorization")) });
}

export function restRoute<P extends Record<string, string> = Record<string, never>>(spec: RouteSpec, fn: (c: RestCall<P>) => Promise<RestResult>) {
  return async (req: Request, routeCtx?: { params?: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const requestId = newRequestId();
    const url = new URL(req.url);
    const instance = url.pathname;
    const ip = normalizeIp(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"));
    const logMethod = `REST ${spec.method} ${spec.route}`;
    let ctx: RestContext | null = null;
    const version = negotiateVersion(req.headers.get("axi-api-version"));
    const log = (status: "ok" | "error" | "denied" | "rate_limited", httpStatus: number) => {
      if (!ctx) return;
      logApiRequest({ storeId: ctx.store.id, tokenId: ctx.actor.tokenId, grantId: null, actorLabel: ctx.actor.label, method: logMethod, tool: null, status, errorCode: httpStatus, durationMs: Date.now() - started, ip });
    };
    try {
      if (!version) throw new ApiError(400, "unsupported_api_version", `Unsupported Axi-Api-Version. Supported: ${API_VERSION}.`);
      ctx = await authenticateRest(req, ip, { method: spec.method, scope: spec.scope });
      const params = ((await routeCtx?.params) ?? {}) as P;
      const body = await readBody(req, spec.method);
      const run = () => fn({ req, ctx: ctx!, params, body, url, requestId });

      let result: RestResult;
      let replayed = false;
      if (spec.method === "POST") {
        const key = validateIdempotencyKey(req.headers.get("idempotency-key"));
        // La clé est propre au JETON : deux intégrations d'une même boutique qui choisissent la même clé
        // (« order-42 ») ne se rejouent pas la réponse l'une de l'autre.
        const scopedKey = `${ctx.actor.tokenId ?? "store"}:${key}`;
        const r = await withIdempotency({ storeId: ctx.store.id, key: scopedKey, method: "POST", path: `${url.pathname}${url.search}`, body }, async () => {
          try {
            const out = await run();
            return { status: out.status, body: out.body ?? null };
          } catch (e) {
            const api = toApiError(e);
            if (!api) throw e;
            // Les erreurs métier (4xx) sont mémorisées comme une réponse : un rejeu renvoie la même erreur.
            return { status: api.status, body: { __problem: true, code: api.code, detail: api.message, extra: api.extra } };
          }
        });
        replayed = r.replayed;
        void scheduleIdempotencyPurge().catch(() => {});
        const stored = r.body as { __problem?: boolean; code?: ApiError["code"]; detail?: string; extra?: Record<string, unknown> } | null;
        if (stored && stored.__problem) {
          const err = new ApiError(r.status, stored.code ?? "unprocessable", stored.detail, stored.extra ?? {}, replayed ? { "Idempotent-Replayed": "true" } : {});
          log(r.status === 429 ? "rate_limited" : r.status === 403 ? "denied" : "error", r.status);
          return problemResponse(err, requestId, instance, version);
        }
        result = { status: r.status, body: r.body };
      } else {
        result = await run();
      }
      log("ok", result.status);
      return jsonOk(result.body ?? null, result.status, requestId, { ...(result.headers ?? {}), ...(replayed ? { "Idempotent-Replayed": "true" } : {}) }, version);
    } catch (e) {
      const api = toApiError(e);
      if (api) {
        // m6 : un refus ANTÉRIEUR à l'authentification n'a pas de boutique (ApiRequestLog.storeId est requis) :
        // il ne laissait aucune trace. Enregistrement minimal dans les journaux de la plateforme : IP, méthode,
        // code et préfixe TRONQUÉ du jeton présenté (jamais le jeton complet), de quoi repérer un balayage.
        if (!ctx && (api.status === 401 || api.status === 403)) logUnauthenticated(req, ip, logMethod, api, requestId);
        log(api.status === 429 ? "rate_limited" : api.status === 403 || api.status === 401 ? "denied" : "error", api.status);
        return problemResponse(api, requestId, instance, version ?? API_VERSION);
      }
      console.error(`[api] ${logMethod} ${requestId}`, e);
      log("error", 500);
      return problemResponse(new ApiError(500, "internal_error", "An internal error occurred. Nothing may have been changed; retry later with the same Idempotency-Key."), requestId, instance, version ?? API_VERSION);
    }
  };
}

/** Exécute un outil du serveur MCP marchand (mêmes règles métier, mêmes contrôles) depuis l'API REST. */
export async function runTool<T extends Record<string, unknown>>(tool: McpTool<RestContext>, ctx: RestContext, args: T): Promise<Record<string, unknown>> {
  // Champ inconnu : 400 explicite (le schéma de l'outil l'ignorerait silencieusement).
  const known = new Set(Object.keys(tool.input.shape));
  const unknown = Object.keys(args).filter((k) => args[k] !== undefined && !known.has(k));
  if (unknown.length) {
    throw new ApiError(400, "validation_failed", `Unknown field(s): ${unknown.slice(0, 10).join(", ")}.`, { errors: unknown.slice(0, 10).map((k) => ({ path: k, message: "Unknown field" })) });
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) throw parsed.error;
  // `via: "api"` : les outils émettent leurs événements de webhook dans leur transaction avec `source: "api"`.
  const out = await tool.handler({ ...ctx, via: "api" } as RestContext, parsed.data);
  return out.data ?? {};
}

export function methodNotAllowed(allow: string): Response {
  return problemResponse(new ApiError(405, "method_not_allowed", `Allowed methods: ${allow}.`, {}, { Allow: allow }), newRequestId());
}
