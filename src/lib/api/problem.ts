/**
 * Réponses de l'API REST /api/v1 : JSON et erreurs `application/problem+json` (RFC 9457), en-têtes communs.
 * Aucune trace interne dans les erreurs : seulement un code stable, un message et l'identifiant de requête.
 * CORS fermé : aucun en-tête Access-Control-* (l'API est destinée aux serveurs, pas aux navigateurs).
 */

export const API_VERSION = "2026-10";
export const SUPPORTED_API_VERSIONS = [API_VERSION] as const;
export const PROBLEM_BASE = "https://axi.africa/docs/api/errors";

export type ProblemCode =
  | "unauthorized"
  | "forbidden"
  | "insufficient_scope"
  | "plan_required"
  | "plan_limit"
  | "store_suspended"
  | "not_found"
  | "method_not_allowed"
  | "invalid_request"
  | "validation_failed"
  | "unsupported_media_type"
  | "payload_too_large"
  | "unsupported_api_version"
  | "idempotency_key_required"
  | "idempotency_key_reused"
  | "idempotency_in_progress"
  | "confirmation_required"
  | "conflict"
  | "unprocessable"
  | "rate_limited"
  | "internal_error";

const TITLES: Record<ProblemCode, string> = {
  unauthorized: "Authentication required",
  forbidden: "Forbidden",
  insufficient_scope: "Insufficient scope",
  plan_required: "Not included in the store plan",
  plan_limit: "Plan limit reached",
  store_suspended: "Store suspended",
  not_found: "Not found",
  method_not_allowed: "Method not allowed",
  invalid_request: "Invalid request",
  validation_failed: "Validation failed",
  unsupported_media_type: "Unsupported media type",
  payload_too_large: "Payload too large",
  unsupported_api_version: "Unsupported API version",
  idempotency_key_required: "Idempotency-Key header required",
  idempotency_key_reused: "Idempotency-Key reused with a different request",
  idempotency_in_progress: "A request with this Idempotency-Key is in progress",
  confirmation_required: "Confirmation required",
  conflict: "Conflict",
  unprocessable: "Unprocessable request",
  rate_limited: "Too many requests",
  internal_error: "Internal error",
};

export type ProblemBody = { type: string; title: string; status: number; detail?: string; instance?: string; code: ProblemCode; request_id: string } & Record<string, unknown>;

export class ApiError extends Error {
  constructor(public status: number, public code: ProblemCode, detail?: string, public extra: Record<string, unknown> = {}, public headers: Record<string, string> = {}) {
    super(detail ?? TITLES[code]);
    this.name = "ApiError";
  }
}

export function problemBody(status: number, code: ProblemCode, requestId: string, detail?: string, extra: Record<string, unknown> = {}, instance?: string): ProblemBody {
  return { type: `${PROBLEM_BASE}/${code}`, title: TITLES[code], status, ...(detail ? { detail } : {}), ...(instance ? { instance } : {}), code, request_id: requestId, ...extra };
}

export function baseHeaders(requestId: string, apiVersion = API_VERSION): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Axi-Api-Version": apiVersion, "X-Request-Id": requestId };
}

export function problemResponse(err: ApiError, requestId: string, instance?: string, apiVersion?: string): Response {
  return new Response(JSON.stringify(problemBody(err.status, err.code, requestId, err.message, err.extra, instance)), {
    status: err.status,
    headers: { "Content-Type": "application/problem+json; charset=utf-8", ...baseHeaders(requestId, apiVersion), ...err.headers },
  });
}

export function jsonOk(body: unknown, status: number, requestId: string, extra: Record<string, string> = {}, apiVersion?: string): Response {
  if (status === 204) return new Response(null, { status, headers: { ...baseHeaders(requestId, apiVersion), ...extra } });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...baseHeaders(requestId, apiVersion), ...extra } });
}

/** Version demandée (`Axi-Api-Version`, défaut 2026-10) ; inconnue : null. */
export function negotiateVersion(header: string | null): string | null {
  if (!header) return API_VERSION;
  const v = header.trim();
  return (SUPPORTED_API_VERSIONS as readonly string[]).includes(v) ? v : null;
}
