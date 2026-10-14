import Link from "next/link";
import { BadgeCheck, MessageSquareQuote, PackageCheck, Star, X } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { ReviewBlock, ReviewItem, ReviewSummary } from "@/lib/storefront/render-types";
import { ProductImage } from "./product-image";
import { Stars } from "./stars";

const fmt = (n: number) => n.toFixed(1).replace(".", ",");

function reviewDate(iso: string) {
  return formatDate(iso, { timeZone: "UTC" });
}

/** Résumé : note moyenne, nombre d'avis, histogramme 5 → 1 étoiles (chaque barre filtre la liste si `filterHref`). */
export function ReviewSummaryCard({ summary, filterHref, active, compact }: { summary: ReviewSummary; filterHref?: (rating: number | null) => string; active?: number | null; compact?: boolean }) {
  const { average, count, histogram } = summary;
  return (
    <div className={cn("rounded-[var(--store-card-radius)] bg-surface ring-1 ring-line", compact ? "p-5" : "p-6")}>
      <div className="flex items-end gap-3">
        <span className="text-[44px] font-semibold leading-none tracking-[-0.04em] text-ink tabular" style={{ fontFamily: "var(--store-font)" }}>
          {fmt(average)}
        </span>
        <div className="pb-1">
          <Stars value={average} />
          <p className="mt-1 text-sm text-ink-muted">
            {count} avis vérifié{count > 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <ul className="mt-5 space-y-1" aria-label="Répartition des notes">
        {histogram.map((n, i) => {
          const rating = 5 - i;
          const pct = count ? Math.round((n / count) * 100) : 0;
          const isActive = active === rating;
          const row = (
            <>
              <span className="inline-flex w-9 shrink-0 items-center gap-1 text-sm tabular text-ink">
                {rating}
                <Star className="size-3.5 text-[#E8A317]" fill="currentColor" strokeWidth={0} aria-hidden />
              </span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className="absolute inset-y-0 left-0 rounded-full bg-[#E8A317]" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right text-xs tabular text-ink-muted">{n}</span>
              <span className="sr-only">
                {rating} étoile{rating > 1 ? "s" : ""} : {n} avis
              </span>
            </>
          );
          return (
            <li key={rating}>
              {filterHref && n > 0 ? (
                <Link
                  href={filterHref(isActive ? null : rating)}
                  scroll={false}
                  aria-current={isActive ? "true" : undefined}
                  className={cn("-mx-2 flex min-h-9 items-center gap-3 rounded-[10px] px-2 transition-colors hover:bg-surface-2", isActive && "bg-[var(--store-primary-soft)] ring-1 ring-inset ring-[var(--store-primary-ring)]")}
                >
                  {row}
                </Link>
              ) : (
                <div className="flex min-h-9 items-center gap-3">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex gap-2 text-xs leading-relaxed text-ink-muted">
        <PackageCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Chaque avis est déposé par un client après une commande livrée, puis publié par la boutique.
      </p>
    </div>
  );
}

export function ReviewCard({ review, storeName, base, showProduct, clamp }: { review: ReviewItem; storeName: string; base: string; showProduct?: boolean; clamp?: boolean }) {
  const initial = review.name.trim()[0]?.toUpperCase() ?? "C";
  return (
    <article className="flex h-full flex-col rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--store-primary-soft)] text-sm font-semibold text-[var(--store-primary)]" aria-hidden>
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{review.name}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
              <time dateTime={review.createdAt}>{reviewDate(review.createdAt)}</time>
              {review.verified && (
                <span className="inline-flex items-center gap-1 font-medium text-[#0f6b3f]">
                  <BadgeCheck className="size-3.5" aria-hidden /> Achat vérifié
                </span>
              )}
            </p>
          </div>
        </div>
        <Stars value={review.rating} size="sm" className="mt-1 shrink-0" />
      </div>
      <p className={cn("mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink", clamp && "line-clamp-6")}>{review.body}</p>
      {review.reply && (
        <div className="mt-4 rounded-[12px] bg-surface-2 px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <MessageSquareQuote className="size-4 text-[var(--store-primary)]" aria-hidden /> Réponse de {storeName}
          </p>
          <p className={cn("mt-1 whitespace-pre-line leading-relaxed text-ink-muted", clamp && "line-clamp-3")}>{review.reply}</p>
        </div>
      )}
      {showProduct && review.product && (
        <Link href={`${base}/p/${review.product.slug}`} className="mt-auto flex items-center gap-3 border-t border-line pt-4 text-sm text-ink-muted hover:text-ink [&:not(:first-child)]:mt-5">
          <ProductImage src={review.product.image} alt="" ratio="aspect-square" className="w-10 shrink-0 rounded-[8px]" sizes="40px" />
          <span className="min-w-0">
            <span className="block text-xs">A commandé</span>
            <span className="block truncate font-medium text-ink">{review.product.name}</span>
          </span>
        </Link>
      )}
    </article>
  );
}

export function ReviewsEmpty({ booking, productName }: { booking: boolean; productName?: string }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--store-card-radius)] bg-surface px-6 py-10 text-center ring-1 ring-line sm:py-12">
      <span className="mb-4 inline-flex items-center gap-0.5 text-[#E8A317]" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="size-6" fill="currentColor" strokeWidth={0} style={{ opacity: 0.35 + i * 0.13 }} />
        ))}
      </span>
      <p className="text-lg font-semibold tracking-[-0.02em] text-ink">{productName ? `Soyez le premier à donner votre avis sur ${productName}` : "Soyez le premier à donner votre avis"}</p>
      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-ink-muted">
        Les avis viennent uniquement de clients ayant reçu leur {booking ? "prestation" : "commande"} : après la livraison, vous recevez un lien pour noter votre achat. Aucun avis n'est inventé ni acheté.
      </p>
    </div>
  );
}

/** Liste paginée (fiche produit) : liens de pagination conservant le filtre de note. */
export function ReviewPager({ block, pageHref }: { block: ReviewBlock; pageHref: (page: number) => string }) {
  if (block.pages <= 1) return null;
  return (
    <nav aria-label="Pages d'avis" className="mt-6 flex flex-wrap items-center justify-center gap-2">
      {Array.from({ length: block.pages }, (_, i) => i + 1).map((p) => (
        <Link key={p} href={pageHref(p)} scroll={false} aria-current={p === block.page ? "page" : undefined} className={cn("inline-flex size-11 items-center justify-center rounded-full text-sm font-medium tabular transition-colors", p === block.page ? "bg-ink text-canvas" : "text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2")}>
          {p}
        </Link>
      ))}
    </nav>
  );
}

export function ActiveRatingChip({ rating, clearHref }: { rating: number; clearHref: string }) {
  return (
    <Link href={clearHref} scroll={false} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--store-primary-soft)] px-3 text-sm font-medium text-ink ring-1 ring-inset ring-[var(--store-primary-ring)]">
      Avis {rating} étoile{rating > 1 ? "s" : ""}
      <X className="size-3.5" aria-hidden />
      <span className="sr-only">: retirer le filtre</span>
    </Link>
  );
}
