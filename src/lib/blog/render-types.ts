/**
 * Données du blog transmises aux sections de thème (`main-blog`, `main-article`, `blog-posts`).
 * Sérialisables (dates ISO), préparées côté serveur (render-data.ts) et relues telles quelles par l'aperçu client.
 * Ajout facultatif de `RenderData` (clé `blog`) : un rendu sans blog reste valide, les sections s'effacent.
 */
import type { RenderData, Img } from "@/lib/storefront/render-types";

export type BlogCategoryRef = { slug: string; name: string };

export type BlogCard = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover: Img | null;
  publishedAt: string;
  readingMinutes: number;
  category: BlogCategoryRef | null;
  tags: string[];
  authorName: string | null;
};

export type BlogArticle = BlogCard & {
  body: string;
  updatedAt: string;
  /** Visible par les membres seulement (brouillon, programmé, archivé) : bandeau « Aperçu ». */
  previewStatus: "DRAFT" | "SCHEDULED" | "ARCHIVED" | null;
  url: string;
};

export type BlogListing = {
  posts: BlogCard[];
  page: number;
  pages: number;
  total: number;
  category: (BlogCategoryRef & { description: string | null }) | null;
  tag: string | null;
};

export type BlogRenderData = {
  /** Blog inclus dans le plan de la boutique. */
  enabled: boolean;
  categories: (BlogCategoryRef & { count: number })[];
  /** Derniers articles par catégorie (clé "" = toutes), pour la section « Derniers articles ». */
  latest: Record<string, BlogCard[]>;
  listing?: BlogListing;
  article?: BlogArticle;
  related?: BlogCard[];
  /** URL absolue de la boutique (`https://…/s/{slug}`) : liens canoniques, partage, JSON-LD. */
  absBase: string;
  /** Données d'exemple de l'aperçu de l'éditeur (aucun article réel). */
  sample?: boolean;
};

export type RenderDataWithBlog = RenderData & { blog?: BlogRenderData };

export function blogData(data: RenderData): BlogRenderData | undefined {
  return (data as RenderDataWithBlog).blog;
}

/** Articles récents d'une catégorie (repli : filtrés dans la liste « toutes » si la clé n'a pas été préchargée). */
export function latestFor(blog: BlogRenderData | undefined, category: string, limit: number): BlogCard[] {
  if (!blog?.enabled) return [];
  const key = category.trim();
  const list = blog.latest[key] ?? (blog.latest[""] ?? []).filter((p) => !key || p.category?.slug === key);
  return list.slice(0, limit);
}

/** Date courte d'un article (fuseau UTC fixé : rendu identique serveur / client). */
export function formatPostDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC", ...opts }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Contenus d'exemple de l'aperçu (éditeur de thème sans article publié). Textes neutres, aucune donnée réelle. */
export function sampleBlog(now: string, absBase = ""): BlogRenderData {
  const cards: BlogCard[] = [
    { id: "sample-1", slug: "exemple-article", title: "Titre de votre premier article", excerpt: "Un extrait court qui donne envie de lire la suite : conseils, coulisses, nouveautés de la boutique.", cover: null, publishedAt: now, readingMinutes: 3, category: { slug: "conseils", name: "Conseils" }, tags: ["conseils"], authorName: null },
    { id: "sample-2", slug: "exemple-coulisses", title: "Dans les coulisses de l'atelier", excerpt: "Racontez comment vous préparez vos produits et ce qui rend votre boutique unique.", cover: null, publishedAt: now, readingMinutes: 4, category: { slug: "coulisses", name: "Coulisses" }, tags: [], authorName: null },
    { id: "sample-3", slug: "exemple-nouveautes", title: "Les nouveautés du mois", excerpt: "Présentez vos derniers arrivages et la façon de les utiliser au quotidien.", cover: null, publishedAt: now, readingMinutes: 2, category: null, tags: [], authorName: null },
  ];
  return {
    enabled: true,
    sample: true,
    absBase,
    categories: [
      { slug: "conseils", name: "Conseils", count: 1 },
      { slug: "coulisses", name: "Coulisses", count: 1 },
    ],
    latest: { "": cards },
    listing: { posts: cards, page: 1, pages: 1, total: cards.length, category: null, tag: null },
    article: {
      ...cards[0]!,
      body: "## Un intertitre\n\nLe corps de l'article s'affiche ici, avec une mise en forme simple : **gras**, *italique*, listes et images.\n\n- Premier point\n- Deuxième point\n\n> Une citation mise en valeur.\n\nTerminez par une invitation à découvrir vos produits.",
      updatedAt: now,
      previewStatus: null,
      url: "#",
    },
    related: cards.slice(1),
  };
}
