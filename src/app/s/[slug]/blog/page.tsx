import type { Metadata } from "next";
import type { SP } from "@/components/storefront/storefront-view";
import { BlogView, blogMetadata } from "./_components/blog-view";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return blogMetadata(slug, "list", "", sp);
}

/** Blog de la boutique : liste paginée, filtres par catégorie et par étiquette (?etiquette=). */
export default async function BlogPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <BlogView slug={slug} kind="list" keyParam="" searchParams={sp} />;
}
