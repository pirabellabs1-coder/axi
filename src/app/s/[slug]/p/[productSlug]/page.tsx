import type { Metadata } from "next";
import { getStorefront, getPublicProduct, productImages } from "@/lib/storefront/data";
import { effectivePrice } from "@/lib/commerce/pricing";
import { shareableImageUrl } from "@/lib/storage/public-url";
import { StorefrontView, type SP } from "@/components/storefront/storefront-view";

type Props = { params: Promise<{ slug: string; productSlug: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const store = (await getStorefront(slug))?.store;
  if (!store) return {};
  const product = await getPublicProduct(store.id, productSlug);
  if (!product) return { title: "Produit introuvable" };
  const img = productImages(product.images)
    .map((i) => ({ ...i, url: shareableImageUrl(i.url) }))
    .find((i): i is typeof i & { url: string } => !!i.url);
  const description = (product.seoDescription ?? product.description ?? "").replace(/\s+/g, " ").slice(0, 160) || undefined;
  const title = product.seoTitle ?? product.name;
  const price = effectivePrice(product).price;
  return {
    title,
    description,
    alternates: { canonical: `/s/${store.slug}/p/${product.slug}` },
    openGraph: { title: `${title} · ${store.name}`, description, type: "website", siteName: store.name, images: img ? [{ url: img.url, alt: img.alt || product.name }] : undefined },
    twitter: { card: img ? "summary_large_image" : "summary" },
    other: { "product:price:amount": String(price), "product:price:currency": store.currency },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const [{ slug, productSlug }, sp] = await Promise.all([params, searchParams]);
  return <StorefrontView slug={slug} template="product" productSlug={productSlug} searchParams={sp} />;
}
