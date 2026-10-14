/**
 * Composants de rendu des sections du blog, ajoutés au registre `SECTION_RENDERERS` (src/lib/theme-engine/render-registry.tsx)
 * par une seule entrée : `...BLOG_SECTION_RENDERERS`.
 */
import type { ComponentType } from "react";
import type { SectionProps } from "@/components/storefront/render-context";
import BlogPosts from "@/components/storefront/sections/blog-posts";
import MainBlog from "@/components/storefront/sections/main-blog";
import MainArticle from "@/components/storefront/sections/main-article";

export const BLOG_SECTION_RENDERERS: Record<"blog-posts" | "main-blog" | "main-article", ComponentType<SectionProps>> = {
  "blog-posts": BlogPosts,
  "main-blog": MainBlog,
  "main-article": MainArticle,
};
