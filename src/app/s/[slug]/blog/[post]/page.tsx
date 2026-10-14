import type { Metadata } from "next";
import type { SP } from "@/components/storefront/storefront-view";
import { BlogView, blogMetadata } from "../_components/blog-view";

type Props = { params: Promise<{ slug: string; post: string }>; searchParams: Promise<SP> };

const clean = (s: string) => {
  try {
    return decodeURIComponent(s).toLowerCase().slice(0, 100);
  } catch {
    return "";
  }
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug, post }, sp] = await Promise.all([params, searchParams]);
  return blogMetadata(slug, "article", clean(post), sp);
}

/** Article du blog (modèle `article`). Brouillons et articles programmés : aperçu réservé aux membres. */
export default async function BlogPostPage({ params, searchParams }: Props) {
  const [{ slug, post }, sp] = await Promise.all([params, searchParams]);
  return <BlogView slug={slug} kind="article" keyParam={clean(post)} searchParams={sp} />;
}
