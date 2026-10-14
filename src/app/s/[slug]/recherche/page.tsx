import type { Metadata } from "next";
import { StorefrontView, type SP } from "@/components/storefront/storefront-view";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 80) : "";
  return { title: query ? `Recherche : ${query}` : "Recherche", robots: { index: false, follow: true } };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <StorefrontView slug={slug} template="search" searchParams={sp} />;
}
