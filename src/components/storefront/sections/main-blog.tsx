import Link from "next/link";
import { ChevronLeft, ChevronRight, Rss, X } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import { blogData } from "@/lib/blog/render-types";
import type { SectionProps } from "../render-context";
import { EmptyNote, ButtonLink, SectionShell, headingClass } from "../ui";
import { PostCard, PostCollection, type CardOptions } from "./blog-posts";

/**
 * Liste des articles du blog (modèle `blog`, section obligatoire) : en-tête éditorial, filtre par catégorie,
 * étiquette active, article à la une, grille ou liste, pagination par liens (fonctionne sans JavaScript).
 */

function listingHref(base: string, opts: { category?: string | null; tag?: string | null; page?: number }) {
  const path = opts.category ? `${base}/blog/categorie/${opts.category}` : `${base}/blog`;
  const q = new URLSearchParams();
  if (opts.tag) q.set("etiquette", opts.tag);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

const chip = "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-200";

export default function MainBlog({ section, ctx }: SectionProps) {
  const st = section.settings;
  const blog = blogData(ctx.data);
  const listing = blog?.listing;
  if (!blog || !listing) return null;
  const { category, tag, page, pages, posts } = listing;
  const base = ctx.base;

  const opts: CardOptions = {
    showImage: S.bool(st, "show_image", true),
    ratio: S.str(st, "image_ratio", "landscape"),
    showExcerpt: S.bool(st, "show_excerpt", true),
    showDate: true,
    showCategory: !category,
    showAuthor: S.bool(st, "show_author", false),
    showReading: S.bool(st, "show_reading_time", true),
  };
  const layout = S.str(st, "layout", "grid");
  const columns = S.str(st, "columns", "3");
  const filtered = !!category || !!tag;
  const featured = S.bool(st, "feature_first", true) && page === 1 && !filtered && posts.length > 2 && layout === "grid";
  const [first, ...rest] = posts;

  const title = category ? category.name : S.str(st, "heading", "Le blog") || "Le blog";
  const intro = category ? category.description : S.str(st, "description", "");
  const showCats = S.bool(st, "show_categories", true) && blog.categories.length > 0;

  return (
    <SectionShell section={section} ctx={ctx} className="pb-16">
      <header className="sf-rise max-w-3xl">
        {category && (
          <p className="mb-3 text-[13px] font-medium uppercase tracking-[0.14em] text-ink-muted">
            <Link href={`${base}/blog`} className="inline-flex min-h-11 items-center hover:text-ink">
              {S.str(st, "heading", "Le blog") || "Le blog"}
            </Link>
          </p>
        )}
        <h1 className={headingClass("xl")}>{title}</h1>
        {intro && <p className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-ink-muted">{intro}</p>}
      </header>

      {(showCats || tag) && (
        <nav aria-label="Catégories du blog" className="-mx-4 mt-8 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            {showCats && (
              <li>
                <Link href={listingHref(base, { tag })} aria-current={!category ? "page" : undefined} className={cn(chip, !category ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]" : "bg-surface text-ink ring-1 ring-line hover:ring-[var(--store-primary)]")}>
                  Tous les articles
                </Link>
              </li>
            )}
            {showCats &&
              blog.categories.map((c) => {
                const active = category?.slug === c.slug;
                return (
                  <li key={c.slug}>
                    <Link href={listingHref(base, { category: c.slug, tag })} aria-current={active ? "page" : undefined} className={cn(chip, active ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]" : "bg-surface text-ink ring-1 ring-line hover:ring-[var(--store-primary)]")}>
                      {c.name}
                    </Link>
                  </li>
                );
              })}
            {tag && (
              <li>
                <Link href={listingHref(base, { category: category?.slug })} className={cn(chip, "bg-[var(--store-primary-soft)] text-[var(--store-primary)]")} aria-label={`Retirer le filtre étiquette ${tag}`}>
                  #{tag}
                  <X className="size-4" aria-hidden />
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}

      <div className="mt-10 sm:mt-12">
        {posts.length === 0 ? (
          <EmptyNote
            title={filtered ? "Aucun article ici pour l'instant" : "Aucun article publié pour l'instant"}
            text={filtered ? "Essayez une autre catégorie ou revenez bientôt." : "Les premiers articles arrivent bientôt. En attendant, découvrez la boutique."}
            action={<ButtonLink href={filtered ? `${base}/blog` : base} label={filtered ? "Tous les articles" : "Voir la boutique"} style="outline" />}
          />
        ) : featured ? (
          <div className="space-y-14">
            <PostCard post={first!} base={base} opts={{ ...opts, showCategory: true }} variant="feature" headingLevel={2} priority={ctx.first} />
            <PostCollection posts={rest} base={base} opts={opts} layout="grid" columns={columns} headingLevel={2} />
          </div>
        ) : (
          <PostCollection posts={posts} base={base} opts={opts} layout={layout} columns={columns} headingLevel={2} priority={ctx.first} />
        )}
      </div>

      {pages > 1 && (
        <nav aria-label="Pagination des articles" className="mt-14 flex items-center justify-center gap-1">
          {page > 1 ? (
            <Link href={listingHref(base, { category: category?.slug, tag, page: page - 1 })} rel="prev" className={cn(chip, "px-3 text-ink hover:bg-surface")}>
              <ChevronLeft className="size-4" aria-hidden />
              <span>Précédent</span>
            </Link>
          ) : null}
          <ul className="flex items-center gap-1">
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1)
              .map((n, i, arr) => (
                <li key={n} className="flex items-center">
                  {i > 0 && n - arr[i - 1]! > 1 && (
                    <span aria-hidden className="px-1 text-ink-muted">
                      …
                    </span>
                  )}
                  <Link
                    href={listingHref(base, { category: category?.slug, tag, page: n })}
                    aria-current={n === page ? "page" : undefined}
                    aria-label={`Page ${n}`}
                    className={cn("inline-flex size-11 items-center justify-center rounded-full text-sm font-medium tabular-nums", n === page ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]" : "text-ink hover:bg-surface")}
                  >
                    {n}
                  </Link>
                </li>
              ))}
          </ul>
          {page < pages ? (
            <Link href={listingHref(base, { category: category?.slug, tag, page: page + 1 })} rel="next" className={cn(chip, "px-3 text-ink hover:bg-surface")}>
              <span>Suivant</span>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </nav>
      )}

      {!blog.sample && posts.length > 0 && (
        <p className="mt-12 flex justify-center">
          <a href={`${base}/blog/rss.xml`} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink-muted hover:text-ink">
            <Rss className="size-4" aria-hidden />
            S&apos;abonner au flux RSS
          </a>
        </p>
      )}
    </SectionShell>
  );
}
