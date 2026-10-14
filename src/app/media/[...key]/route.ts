import { getStorage } from "@/lib/storage";
import { LocalDriver, IMMUTABLE_CACHE } from "@/lib/storage/drivers";
import { keyFromSegments, mimeForKey } from "@/lib/storage/keys";

export const dynamic = "force-dynamic";

/**
 * GET /media/stores/{storeId}/{yyyy}/{mm}/{sha256}.{ext} — médias du pilote local.
 * La clé est validée par une expression stricte (aucun `..`, `\`, `%`, ni segment libre) puis résolue
 * à l'intérieur du dossier de stockage : pas de traversée de chemin. Contenu immuable (hash) → cache 1 an.
 * Si le pilote actif est S3 (fichiers recopiés dans le bucket avec les mêmes clés), redirection 308.
 */
async function serve(req: Request, params: Promise<{ key: string[] }>, head: boolean) {
  const { key: segments } = await params;
  const key = keyFromSegments(segments);
  const mime = key ? mimeForKey(key) : null;
  if (!key || !mime) return new Response(null, { status: 404 });

  let driver;
  try {
    driver = getStorage();
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!(driver instanceof LocalDriver)) {
    return new Response(null, { status: 308, headers: { Location: driver.publicUrl(key), "Cache-Control": IMMUTABLE_CACHE } });
  }

  const etag = `"${key.slice(key.lastIndexOf("/") + 1, key.lastIndexOf("."))}"`;
  const common = {
    "Cache-Control": IMMUTABLE_CACHE,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    // Ouverte directement, l'image ne peut jamais exécuter de script (défense en profondeur : seuls des formats raster sont stockés).
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: common });

  const body = await driver.read(key);
  if (!body) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(head ? null : new Uint8Array(body), {
    status: 200,
    headers: { ...common, "Content-Type": mime, "Content-Length": String(body.byteLength) },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  return serve(req, params, false);
}

export async function HEAD(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  return serve(req, params, true);
}
