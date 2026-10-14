import { newRequestId } from "@/lib/api/handler";
import { ApiError, problemResponse } from "@/lib/api/problem";

export const dynamic = "force-dynamic";

/** Toute ressource inconnue sous /api/v1 : 404 problem+json (jamais la page HTML de Next). */
function notFound(req: Request) {
  return problemResponse(new ApiError(404, "not_found", "Unknown API resource. See /api/openapi-2026-10.json."), newRequestId(), new URL(req.url).pathname);
}

export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
