import type { Metadata } from "next";
import { getStorefront, getStorePage } from "@/lib/storefront/data";
import { StorefrontView, type SP } from "@/components/storefront/storefront-view";

type Props = { params: Promise<{ slug: string; page: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, page } = await params;
  const store = (await getStorefront(slug))?.store;
  if (!store) return {};
  const p = await getStorePage(store.id, page);
  if (!p) return { title: "Page introuvable" };
  return { title: p.title, description: p.body.replace(/\s+/g, " ").slice(0, 160) };
}

/** Page personnalisée du commerçant (texte brut ou Markdown limité, jamais de HTML interprété). */
export default async function StoreCustomPage({ params, searchParams }: Props) {
  const [{ slug, page }, sp] = await Promise.all([params, searchParams]);
  return <StorefrontView slug={slug} template="page" pageSlug={page} searchParams={sp} />;
}
