/**
 * Référencement du blog (fonctions pures) : JSON-LD `BlogPosting` + `BreadcrumbList`, flux RSS 2.0, entrées de sitemap.
 * Toutes les URL reçues sont absolues ; les images passent par `shareableImageUrl` (jamais de data-URL).
 */
import { shareableImageUrl } from "@/lib/storage/public-url";
import type { BlogArticle, BlogCard } from "./render-types";

export function articleUrl(absBase: string, slug: string) {
  return `${absBase}/blog/${slug}`;
}

export function blogPostingJsonLd(a: BlogArticle, store: { name: string; logoUrl: string | null }, absBase: string) {
  const image = a.cover ? shareableImageUrl(a.cover.url) : undefined;
  const logo = shareableImageUrl(store.logoUrl);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: a.title.slice(0, 110),
    description: a.excerpt || undefined,
    url: articleUrl(absBase, a.slug),
    mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl(absBase, a.slug) },
    datePublished: a.publishedAt,
    dateModified: a.updatedAt,
    ...(image ? { image: [image] } : {}),
    author: a.authorName ? { "@type": "Person", name: a.authorName } : { "@type": "Organization", name: store.name },
    publisher: { "@type": "Organization", name: store.name, ...(logo ? { logo: { "@type": "ImageObject", url: logo } } : {}) },
    ...(a.category ? { articleSection: a.category.name } : {}),
    ...(a.tags.length ? { keywords: a.tags.join(", ") } : {}),
    timeRequired: `PT${Math.max(1, a.readingMinutes)}M`,
    inLanguage: "fr",
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

/** Sérialisation sûre dans une balise <script type="application/ld+json"> (aucune fermeture de balise possible). */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/* ───────────── RSS ───────────── */

export function xmlEscape(s: string): string {
  // Caractères interdits en XML 1.0 retirés, puis échappement des entités.
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildRss(input: { storeName: string; description: string | null; absBase: string; posts: BlogCard[]; now?: Date }): string {
  const blogUrl = `${input.absBase}/blog`;
  const items = input.posts
    .map((p) => {
      const url = articleUrl(input.absBase, p.slug);
      const image = p.cover ? shareableImageUrl(p.cover.url) : undefined;
      return [
        "    <item>",
        `      <title>${xmlEscape(p.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
        `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        p.excerpt ? `      <description>${xmlEscape(p.excerpt)}</description>` : "",
        p.category ? `      <category>${xmlEscape(p.category.name)}</category>` : "",
        ...p.tags.map((t) => `      <category>${xmlEscape(t)}</category>`),
        p.authorName ? `      <dc:creator>${xmlEscape(p.authorName)}</dc:creator>` : "",
        image ? `      <enclosure url="${xmlEscape(image)}" type="${/\.png$/i.test(image) ? "image/png" : /\.webp$/i.test(image) ? "image/webp" : "image/jpeg"}" length="0" />` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  const last = input.posts[0]?.publishedAt ? new Date(input.posts[0].publishedAt) : (input.now ?? new Date());
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xmlEscape(`${input.storeName} : le blog`)}</title>
    <link>${xmlEscape(blogUrl)}</link>
    <description>${xmlEscape(input.description || `Les articles de ${input.storeName}`)}</description>
    <language>fr</language>
    <lastBuildDate>${last.toUTCString()}</lastBuildDate>
    <atom:link href="${xmlEscape(`${blogUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

/* ───────────── Sitemap de la boutique ───────────── */

export type SitemapEntry = { url: string; lastModified?: Date | string | null; changeFrequency?: "daily" | "weekly" | "monthly" | "yearly"; priority?: number };

export function buildSitemap(entries: SitemapEntry[]): string {
  const rows = entries
    .map((e) =>
      [
        "  <url>",
        `    <loc>${xmlEscape(e.url)}</loc>`,
        e.lastModified ? `    <lastmod>${new Date(e.lastModified).toISOString()}</lastmod>` : "",
        e.changeFrequency ? `    <changefreq>${e.changeFrequency}</changefreq>` : "",
        e.priority != null ? `    <priority>${e.priority.toFixed(1)}</priority>` : "",
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows}
</urlset>
`;
}
