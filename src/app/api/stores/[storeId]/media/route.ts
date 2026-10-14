import { MAX_UPLOAD_BYTES } from "@/lib/storage/limits";
import { sameOrigin } from "@/lib/storage/origin";
import { readBodyLimited, UploadError, uploadStoreImage } from "@/lib/storage/upload";

export const dynamic = "force-dynamic";

/**
 * POST /api/stores/{storeId}/media?purpose=product|collection|theme
 * Corps : octets bruts de l'image (Content-Type image/* ; le format réel est vérifié par octets magiques).
 * 201 { url, key, bytes, deduplicated:false } | 200 { …, deduplicated:true }
 * Erreurs : { error: { code, message } } — 400/401/403/413/415/422 (dimensions)/429/503.
 *
 * Authentification par cookie de session : requête même origine uniquement. L'en-tête Origin est comparé à
 * l'hôte de NEXT_PUBLIC_APP_URL (espace marchand), jamais à l'en-tête Host fourni par le client ; Sec-Fetch-Site
 * doit valoir same-origin. Un Content-Type image/* force de toute façon un pré-vol CORS jamais accordé.
 */
function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

function error(code: string, message: string, status: number, extra: Record<string, string> = {}) {
  return json({ error: { code, message } }, status, extra);
}

export async function POST(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  if (!sameOrigin(req)) return error("forbidden", "Origine non autorisée.", 403);

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/") && type !== "application/octet-stream") return error("unsupported_type", "Envoyez le fichier image brut.", 415);
  if (type === "image/svg+xml") return error("unsupported_type", "Les images SVG ne sont pas acceptées.", 415);
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return error("too_large", "Image trop lourde (5 Mo maximum).", 413);

  const purpose = new URL(req.url).searchParams.get("purpose");
  try {
    const result = await uploadStoreImage({ storeId, purpose, readBody: () => readBodyLimited(req.body) });
    return json(result, result.deduplicated ? 200 : 201);
  } catch (e) {
    if (e instanceof UploadError) {
      return error(e.code, e.message, e.status, e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {});
    }
    console.error("[media] upload", e);
    return error("internal", "Une erreur est survenue. Réessayez.", 500);
  }
}
