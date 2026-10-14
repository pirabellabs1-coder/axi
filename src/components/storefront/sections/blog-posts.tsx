import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import { blogData, formatPostDate, latestFor, type BlogCard } from "@/lib/blog/render-types";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { ButtonLink, SectionHeading, SectionShell } from "../ui";

/**
 * « Derniers articles » (lot 2 D) : articles publiés du blog, en grille, à la une ou en liste.
 * Composant pur (données préparées dans `data.blog`) ; masqué s'il n'y a aucun article (hors aperçu de l'éditeur).
 * Les éléments partagés (carte, méta) sont réutilisés par `main-blog` et `main-article`.
 */

export type CardOptions = { showImage: boolean; ratio: string; showExcerpt: boolean; showDate: boolean; showCategory: boolean; showAuthor?: boolean; showReading?: boolean };

const RATIOS: Record<string, string> = { landscape: "aspect-[3/2]", square: "aspect-square", portrait: "aspect-[4/5]", wide: "aspect-[16/9]" };
export const ratioClass = (r: string) => RATIOS[r] ?? RATIOS.landscape!;

export function postHref(base: string, slug: string) {
  return `${base}/blog/${slug}`;
}

/** Ligne « Catégorie · date · lecture » (texte seul : la carte entière est déjà un lien). */
export function PostMeta({ post, opts, className }: { post: BlogCard; opts: Pick<CardOptions, "showDate" | "showCategory" | "showAuthor" | "showReading">; className?: string }) {
  const parts: React.ReactNode[] = [];
  if (opts.showCategory && post.category) parts.push(<span key="c" className="font-semibold text-ink">{post.category.name}</span>);
  if (opts.showDate) parts.push(<time key="d" dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>);
  if (opts.showAuthor && post.authorName) parts.push(<span key="a">{post.authorName}</span>);
  if ((opts.showReading ?? opts.showDate) && post.readingMinutes) parts.push(<span key="r">{post.readingMinutes} min de lecture</span>);
  if (!parts.length) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted", className)}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && (
            <span aria-hidden className="text-ink-muted/60">
              ·
            </span>
          )}
          {p}
        </span>
      ))}
    </p>
  );
}

/** Carte d'article : lien étiré sur toute la carte (une seule cible au clavier), image à ratio fixe (aucun décalage). */
export function PostCard({ post, base, opts, variant = "grid", headingLevel = 3, priority = false, sizes }: { post: BlogCard; base: string; opts: CardOptions; variant?: "grid" | "feature" | "list"; headingLevel?: 2 | 3; priority?: boolean; sizes?: string }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const href = postHref(base, post.slug);
  const image = opts.showImage ? (
    <div className={cn("overflow-hidden rounded-[var(--store-card-radius)]", variant === "list" && "w-28 shrink-0 sm:w-44")}>
      <ProductImage
        src={post.cover?.url}
        alt={post.cover?.alt ?? ""}
        ratio={variant === "list" ? "aspect-square sm:aspect-[4/3]" : variant === "feature" ? "aspect-[4/3] md:aspect-[16/11]" : ratioClass(opts.ratio)}
        priority={priority}
        sizes={sizes ?? (variant === "feature" ? "(max-width: 768px) 100vw, 58vw" : variant === "list" ? "176px" : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw")}
        imgClassName="transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
      />
    </div>
  ) : null;

  const text = (
    <div className={cn("flex min-w-0 flex-col", variant === "feature" ? "justify-center md:py-6" : "")}>
      <PostMeta post={post} opts={opts} className={cn(variant === "grid" && opts.showImage && "mt-4", variant === "feature" && "mt-5 md:mt-0")} />
      <H className={cn("sf-heading text-ink", variant === "feature" ? "mt-3 text-[calc(clamp(1.6rem,3.2vw,2.5rem)*var(--store-scale,1))]" : variant === "list" ? "mt-1.5 text-[calc(1.1rem*var(--store-scale,1))] sm:text-[calc(1.3rem*var(--store-scale,1))]" : "mt-2 text-[calc(1.25rem*var(--store-scale,1))]")}>
        <Link href={href} className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--store-primary)] group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
          {post.title}
        </Link>
      </H>
      {opts.showExcerpt && post.excerpt && <p className={cn("text-ink-muted", variant === "feature" ? "mt-4 line-clamp-4 max-w-[52ch] text-[16px] leading-relaxed" : variant === "list" ? "mt-1.5 line-clamp-2 hidden text-[15px] leading-relaxed sm:block" : "mt-2 line-clamp-3 text-[15px] leading-relaxed")}>{post.excerpt}</p>}
      {variant === "feature" && (
        <span aria-hidden className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink underline decoration-[var(--store-primary)] decoration-2 underline-offset-[6px]">
          Lire l&apos;article
          <ArrowRight className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5" />
        </span>
      )}
    </div>
  );

  return (
    <article className={cn("group relative", variant === "feature" ? "grid gap-0 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-10" : variant === "list" ? "flex items-start gap-4 sm:items-center sm:gap-6" : "flex flex-col")}>
      {image}
      {text}
    </article>
  );
}

export function postGridClass(columns: string) {
  const n = Number(columns) || 3;
  return cn("grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2", n === 3 && "lg:grid-cols-3", n >= 4 && "lg:grid-cols-4");
}

/** Liste d'articles selon la disposition choisie (grille, à la une, liste). */
export function PostCollection({ posts, base, opts, layout, columns, headingLevel = 3, priority = false }: { posts: BlogCard[]; base: string; opts: CardOptions; layout: string; columns: string; headingLevel?: 2 | 3; priority?: boolean }) {
  if (layout === "list") {
    return (
      <ul className="divide-y divide-line border-y border-line">
        {posts.map((p, i) => (
          <li key={p.id} className="py-5 sm:py-6">
            <PostCard post={p} base={base} opts={opts} variant="list" headingLevel={headingLevel} priority={priority && i === 0} />
          </li>
        ))}
      </ul>
    );
  }
  if (layout === "featured" && posts.length > 1) {
    const [first, ...rest] = posts;
    return (
      <div className="space-y-12">
        <PostCard post={first!} base={base} opts={opts} variant="feature" headingLevel={headingLevel} priority={priority} />
        <ul className={postGridClass(rest.length >= 3 ? columns : String(Math.max(2, rest.length)))}>
          {rest.map((p) => (
            <li key={p.id}>
              <PostCard post={p} base={base} opts={opts} headingLevel={headingLevel} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <ul className={postGridClass(columns)}>
      {posts.map((p, i) => (
        <li key={p.id}>
          <PostCard post={p} base={base} opts={opts} headingLevel={headingLevel} priority={priority && i < 2} />
        </li>
      ))}
    </ul>
  );
}

export default function BlogPosts({ section, ctx }: SectionProps) {
  const st = section.settings;
  const blog = blogData(ctx.data);
  const limit = Math.max(2, Math.min(12, S.num(st, "limit", 3)));
  const category = S.str(st, "category", "").trim().toLowerCase();
  const posts = latestFor(blog, category, limit);
  if (!posts.length) {
    if (!ctx.preview) return null;
    return (
      <SectionShell section={section} ctx={ctx}>
        <SectionHeading section={section} ctx={ctx} fallback="Derniers articles" />
        <p className="rounded-[var(--store-card-radius)] bg-surface px-6 py-10 text-center text-sm text-ink-muted ring-1 ring-line">
          {blog?.enabled === false ? "Le blog est inclus à partir du plan Starter. Cette section reste masquée pour vos clients." : "Aucun article publié pour l'instant. Cette section apparaîtra dès votre premier article."}
        </p>
      </SectionShell>
    );
  }
  const opts: CardOptions = {
    showImage: S.bool(st, "show_image", true),
    ratio: S.str(st, "image_ratio", "landscape"),
    showExcerpt: S.bool(st, "show_excerpt", true),
    showDate: S.bool(st, "show_date", true),
    showCategory: S.bool(st, "show_category", true),
  };
  const cat = category ? blog?.categories.find((c) => c.slug === category) : null;
  const viewAll = S.bool(st, "show_view_all", true) ? <ButtonLink href={cat ? `${ctx.base}/blog/categorie/${cat.slug}` : `${ctx.base}/blog`} label="Tous les articles" style="link" arrow /> : null;
  const headingId = `h-${section.id}`;
  return (
    <SectionShell section={section} ctx={ctx} label={S.str(st, "heading", "") ? undefined : "Derniers articles"}>
      <SectionHeading section={section} ctx={ctx} aside={viewAll} id={headingId} />
      <PostCollection posts={posts} base={ctx.base} opts={opts} layout={S.str(st, "layout", "grid")} columns={S.str(st, "columns", "3")} priority={ctx.first} />
    </SectionShell>
  );
}
