import type { Metadata } from "next";
import { getStorefront } from "@/lib/storefront/data";
import { storefrontPreset } from "@/lib/storefront/theme";
import { StorefrontView, type SP } from "@/components/storefront/storefront-view";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const store = (await getStorefront(slug))?.store;
  if (!store) return {};
  return { title: storefrontPreset(store.sector, store.themeId).copy.catalogTitle, alternates: { canonical: `/s/${store.slug}/catalogue` } };
}

/** Catalogue complet : filtres prix / collection / disponibilité / tags / options, tri, pagination. */
export default async function CataloguePage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <StorefrontView slug={slug} template="catalog" searchParams={sp} />;
}
