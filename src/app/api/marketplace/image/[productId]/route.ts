import { db } from "@/lib/db";
import { productImages } from "@/lib/storefront/data";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"]);
const MAX_BYTES = 1_500_000;

/**
 * Sert la première image d'un produit stockée en data-URL (évite d'embarquer des centaines de Ko
 * dans le HTML des pages marketplace). Uniquement pour les produits ACTIVE de boutiques listées.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(productId)) return new Response(null, { status: 404 });

  const product = await db.product
    .findFirst({ where: { id: productId, status: "ACTIVE", store: { status: "PUBLISHED", listedInMarketplace: true } }, select: { images: true } })
    .catch(() => null);
  const url = product ? productImages(product.images)[0]?.url : undefined;
  const match = url?.match(/^data:([a-z0-9.+/-]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return new Response(null, { status: 404 });

  const mime = match[1].toLowerCase();
  if (!ALLOWED.has(mime)) return new Response(null, { status: 415 });
  let body: Buffer;
  try {
    body = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
  } catch {
    return new Response(null, { status: 422 });
  }
  if (body.byteLength > MAX_BYTES) return new Response(null, { status: 413 });

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      // Une image SVG ouverte directement ne doit jamais exécuter de script.
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
