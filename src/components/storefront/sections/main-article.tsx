import Link from "next/link";
import { ChevronRight, Eye, MessageCircle, ThumbsUp } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import { blogData, formatPostDate } from "@/lib/blog/render-types";
import { ARTICLE_PROSE, renderBlogMarkdown } from "@/lib/blog/markdown";
import { blogPostingJsonLd, breadcrumbJsonLd, jsonLdString } from "@/lib/blog/seo";
import { CopyLinkButton } from "@/lib/blog/copy-link-button";
import type { BlockInstance } from "@/lib/theme-engine/types";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { SectionShell, headingClass } from "../ui";
import { PostCollection, ratioClass } from "./blog-posts";

/**
 * Article de blog (modèle `article`, section obligatoire). Blocs ordonnés par le commerçant :
 * titre, date et auteur, image de couverture, contenu (Markdown limité sûr), partage, articles liés.
 * Données structurées BlogPosting + BreadcrumbList. Bandeau d'aperçu pour un article non public (membres seulement).
 */

const PREVIEW_LABEL = { DRAFT: "brouillon", SCHEDULED: "programmé", ARCHIVED: "archivé" } as const;
const shareItem = "inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink ring-1 ring-inset ring-line transition-colors duration-200 hover:bg-[var(--store-primary-soft)]";

export default function MainArticle({ section, ctx }: SectionProps) {
  const blog = blogData(ctx.data);
  const a = blog?.article;
  if (!blog || !a) return null;
  const st = section.settings;
  const base = ctx.base;
  const narrow = S.str(st, "width", "narrow") === "narrow";
  const center = S.str(st, "header_align", "left") === "center";
  const col = cn("mx-auto w-full", narrow ? "max-w-[68ch]" : "max-w-[84ch]");
  const blocks = section.blocks.filter((b) => !b.disabled);
  const imageFirst = blocks.findIndex((b) => b.type === "image") === 0;

  const crumbs = [
    { name: ctx.data.store.name, url: blog.absBase, href: base },
    { name: "Blog", url: `${blog.absBase}/blog`, href: `${base}/blog` },
    ...(a.category ? [{ name: a.category.name, url: `${blog.absBase}/blog/categorie/${a.category.slug}`, href: `${base}/blog/categorie/${a.category.slug}` }] : []),
  ];

  const render = (b: BlockInstance) => {
    const bs = b.settings;
    switch (b.type) {
      case "title":
        return (
          <header key={b.id} className={cn(col, "sf-rise", center && "text-center")}>
            {S.bool(bs, "show_category", true) && a.category && (
              <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-ink">
                <Link href={`${base}/blog/categorie/${a.category.slug}`} className="inline-flex min-h-11 items-center underline decoration-[var(--store-primary)] decoration-2 underline-offset-[6px] hover:opacity-80">
                  {a.category.name}
                </Link>
              </p>
            )}
            <h1 className={headingClass(S.str(bs, "size", "lg") === "xl" ? "xl" : S.str(bs, "size", "lg") === "md" ? "md" : "lg")}>{a.title}</h1>
            {a.excerpt && <p className="mt-5 text-[19px] leading-relaxed text-ink-muted">{a.excerpt}</p>}
          </header>
        );
      case "meta": {
        const parts: React.ReactNode[] = [];
        if (S.bool(bs, "show_author", true) && a.authorName) parts.push(<span key="a" className="font-medium text-ink">Par {a.authorName}</span>);
        if (S.bool(bs, "show_date", true))
          parts.push(
            <time key="d" dateTime={a.publishedAt}>
              {formatPostDate(a.publishedAt)}
            </time>,
          );
        if (S.bool(bs, "show_reading_time", true)) parts.push(<span key="r">{a.readingMinutes} min de lecture</span>);
        if (!parts.length) return null;
        return (
          <div key={b.id} className={cn(col, "mt-6 border-t border-line pt-5")}>
            <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted", center && "justify-center")}>
              {parts.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-3">
                  {i > 0 && <span aria-hidden>·</span>}
                  {p}
                </span>
              ))}
            </p>
          </div>
        );
      }
      case "image": {
        if (!a.cover) return null;
        const wide = S.str(bs, "size", "wide") === "wide";
        const ratio = S.str(bs, "ratio", "landscape");
        return (
          <figure key={b.id} className={cn("mt-10", wide ? "mx-auto w-full max-w-[1100px]" : col)}>
            <ProductImage src={a.cover.url} alt={a.cover.alt ?? ""} ratio={ratio === "wide" ? "aspect-[21/9]" : ratioClass(ratio)} className="rounded-[var(--store-card-radius)]" priority={ctx.first} sizes={wide ? "(max-width: 1100px) 100vw, 1100px" : "(max-width: 768px) 100vw, 720px"} />
          </figure>
        );
      }
      case "body":
        return (
          <div key={b.id} className={cn(col, "mt-10")}>
            <div className={ARTICLE_PROSE}>{renderBlogMarkdown(a.body, { base, priorityFirstImage: imageFirst && !a.cover })}</div>
            {S.bool(bs, "show_tags", true) && a.tags.length > 0 && (
              <ul className="mt-10 flex flex-wrap gap-2" aria-label="Étiquettes">
                {a.tags.map((t) => (
                  <li key={t}>
                    <Link href={`${base}/blog?etiquette=${encodeURIComponent(t)}`} className="inline-flex min-h-11 items-center rounded-full bg-surface px-4 text-sm text-ink ring-1 ring-line hover:ring-[var(--store-primary)]">
                      #{t}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case "share": {
        const url = a.url;
        const label = S.str(bs, "label", "Partager cet article");
        return (
          <div key={b.id} className={cn(col, "mt-10 flex flex-wrap items-center gap-2 border-t border-line pt-6")}>
            {label && <span className="mr-2 text-sm font-medium text-ink">{label}</span>}
            <a className={shareItem} href={`https://wa.me/?text=${encodeURIComponent(`${a.title} ${url}`)}`} target="_blank" rel="noopener noreferrer" aria-label="Partager sur WhatsApp">
              <MessageCircle className="size-[18px]" aria-hidden />
            </a>
            <a className={shareItem} href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Partager sur Facebook">
              <ThumbsUp className="size-[18px]" aria-hidden />
            </a>
            <CopyLinkButton url={url} className={shareItem} />
          </div>
        );
      }
      case "related": {
        const limit = Math.max(2, Math.min(6, S.num(bs, "limit", 3)));
        const posts = (blog.related ?? []).slice(0, limit);
        if (!posts.length) return null;
        const heading = S.str(bs, "heading", "À lire aussi");
        return (
          <section key={b.id} aria-labelledby={`${b.id}-h`} className="mt-20 border-t border-line pt-12">
            <h2 id={`${b.id}-h`} className={cn(headingClass("md"), "mb-8")}>
              {heading || "À lire aussi"}
            </h2>
            <PostCollection posts={posts} base={base} opts={{ showImage: true, ratio: "landscape", showExcerpt: false, showDate: true, showCategory: true }} layout="grid" columns={posts.length >= 3 ? "3" : "2"} />
          </section>
        );
      }
      default:
        return null;
    }
  };

  return (
    <SectionShell section={section} ctx={ctx} padded={false} className="pb-16 pt-4 sm:pb-24 sm:pt-8">
      {a.previewStatus && (
        <p role="status" className="mx-auto mb-6 flex max-w-[68ch] items-start gap-2 rounded-[var(--store-card-radius)] bg-[var(--store-primary-soft)] px-4 py-3 text-sm text-ink ring-1 ring-[var(--store-primary-ring)]">
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Aperçu : article {PREVIEW_LABEL[a.previewStatus]}
            {a.previewStatus === "SCHEDULED" ? `, publication prévue le ${formatPostDate(a.publishedAt, { hour: "2-digit", minute: "2-digit" })} (UTC)` : ""}. Vos clients ne le voient pas encore.
          </span>
        </p>
      )}
      {S.bool(st, "show_breadcrumbs", true) && (
        <nav aria-label="Fil d'Ariane" className={cn(col, "mb-6 text-sm", center && "flex justify-center")}>
          <ol className="flex flex-wrap items-center gap-1 text-ink-muted">
            {crumbs.map((c, i) => (
              <li key={c.href} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                <Link href={c.href} className="inline-flex min-h-11 items-center hover:text-ink">
                  {c.name}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <article>{blocks.map(render)}</article>
      {!blog.sample && !a.previewStatus && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(blogPostingJsonLd(a, ctx.data.store, blog.absBase)) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd([...crumbs.map((c) => ({ name: c.name, url: c.url })), { name: a.title, url: a.url }])) }} />
        </>
      )}
    </SectionShell>
  );
}
