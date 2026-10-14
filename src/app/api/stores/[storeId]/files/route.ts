import { sameOrigin } from "@/lib/storage/origin";
import { MAX_FILE_BYTES } from "@/lib/storage/file-keys";
import { UploadError } from "@/lib/storage/upload";
import { readFileBodyLimited, uploadStoreFile } from "@/lib/storage/file-upload";

export const dynamic = "force-dynamic";

/**
 * POST /api/stores/{storeId}/files?productId=…&variantId=…&assetId=…&name=…
 * Corps : octets bruts du fichier vendu (le format réel est vérifié par ses octets magiques).
 * `assetId` présent = REMPLACEMENT (nouvelle version du même fichier, les acheteurs voient la nouvelle).
 * 201 { asset, deduplicated, replaced:false } | 200 { …, replaced:true }
 * Erreurs : { error: { code, message } } — 400/401/403/413/415/429/503.
 *
 * Authentification par cookie de session, requête MÊME ORIGINE uniquement (Origin comparé à l'hôte de
 * NEXT_PUBLIC_APP_URL, `Sec-Fetch-Site`) ; la capacité `products.manage` est vérifiée par `uploadStoreFile`.
 * Le fichier n'obtient JAMAIS d'URL publique : il n'est servi que par /telechargement/{jeton}/fichier/{id}.
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

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) return error("too_large", "Fichier trop lourd (50 Mo maximum).", 413);

  const url = new URL(req.url);
  try {
    const result = await uploadStoreFile({
      storeId,
      productId: url.searchParams.get("productId"),
      variantId: url.searchParams.get("variantId"),
      assetId: url.searchParams.get("assetId"),
      name: url.searchParams.get("name"),
      readBody: () => readFileBodyLimited(req.body),
    });
    return json(result, result.replaced ? 200 : 201);
  } catch (e) {
    if (e instanceof UploadError) return error(e.code, e.message, e.status, e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {});
    console.error("[files] upload", e);
    return error("internal", "Une erreur est survenue. Réessayez.", 500);
  }
}
