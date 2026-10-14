import type { Metadata } from "next";
import type { SP } from "@/components/storefront/storefront-view";
import { BlogView, blogMetadata } from "../../_components/blog-view";

type Props = { params: Promise<{ slug: string; category: string }>; searchParams: Promise<SP> };

const clean = (s: string) => {
  try {
    return decodeURIComponent(s).toLowerCase().slice(0, 60);
  } catch {
    return "";
  }
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug, category }, sp] = await Promise.all([params, searchParams]);
  return blogMetadata(slug, "list", clean(category), sp);
}

/** Articles d'une catégorie du blog. */
export default async function BlogCategoryPage({ params, searchParams }: Props) {
  const [{ slug, category }, sp] = await Promise.all([params, searchParams]);
  return <BlogView slug={slug} kind="list" keyParam={clean(category)} searchParams={sp} />;
}
