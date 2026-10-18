import { serveFeedImage } from "@/lib/social/feed-image";

export const dynamic = "force-dynamic";
// sharp (binaire natif) : exécution Node uniquement.
export const runtime = "nodejs";

/** Photo produit convertie en JPEG pour les catalogues Meta et TikTok, voir src/lib/social/feed-image.ts. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; key: string[] }> }) {
  const { slug, key } = await params;
  return serveFeedImage(slug, key);
}

export async function HEAD(_req: Request, { params }: { params: Promise<{ slug: string; key: string[] }> }) {
  const { slug, key } = await params;
  return serveFeedImage(slug, key, true);
}
