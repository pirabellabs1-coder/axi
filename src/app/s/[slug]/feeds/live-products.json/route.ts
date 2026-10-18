import { serveLiveProducts } from "@/lib/social/live-products";

export const dynamic = "force-dynamic";

/** Produits du direct pour l'ajout au panier depuis la section « Direct », voir src/lib/social/live-products.ts. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return serveLiveProducts(slug, new URL(req.url).searchParams.get("ids"));
}
