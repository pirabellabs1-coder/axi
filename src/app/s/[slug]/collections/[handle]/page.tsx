import type { Metadata } from "next";
import { getStorefront } from "@/lib/storefront/data";
import { shareableImageUrl } from "@/lib/storage/public-url";
import { StorefrontView, type SP } from "@/components/storefront/storefront-view";

type Props = { params: Promise<{ slug: string; handle: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, handle } = await params;
  const store = (await getStorefront(slug))?.store;
  const c = store?.categories.find((x) => x.slug === handle && x.published);
  if (!store || !c) return { title: "Collection introuvable" };
  const image = shareableImageUrl(c.imageUrl);
  const description = (c.seoDescription ?? c.description ?? "").slice(0, 160) || undefined;
  return { title: c.seoTitle ?? c.name, description, alternates: { canonical: `/s/${store.slug}/collections/${c.slug}` }, openGraph: { title: `${c.seoTitle ?? c.name} · ${store.name}`, description, images: image ? [{ url: image }] : undefined } };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const [{ slug, handle }, sp] = await Promise.all([params, searchParams]);
  return <StorefrontView slug={slug} template="collection" collectionHandle={handle} searchParams={sp} />;
}
