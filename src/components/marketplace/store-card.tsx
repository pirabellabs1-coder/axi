import Link from "next/link";
import { BadgeCheck, MapPin, Star } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { categoryBySlug } from "@/lib/marketplace/categories";
import type { StoreCardData } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";
import { MkImage } from "./mk-image";

const ratingFmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function StoreRating({ rating, className }: { rating: StoreCardData["rating"]; className?: string }) {
  if (!rating) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 tabular", className)}>
      <Star className="size-3.5 fill-sun text-sun" aria-hidden />
      <span aria-hidden className="font-medium text-ink">{ratingFmt.format(rating.average)}</span>
      <span aria-hidden className="text-ink-faint">({rating.count})</span>
      <span className="sr-only">
        Note moyenne {ratingFmt.format(rating.average)} sur 5, {rating.count} avis
      </span>
    </span>
  );
}

export function OpenNowBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-surface/95 px-2.5 py-1 text-xs font-semibold text-primary-deep shadow-sm ring-1 ring-line", className)}>
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-whatsapp opacity-60 motion-safe:animate-ping" />
        <span className="relative size-2 rounded-full bg-whatsapp" />
      </span>
      Ouvert maintenant
    </span>
  );
}

/** Carte boutique : couverture photo, logo, ville, note moyenne, badge d'ouverture. */
export function StoreCard({ store, priority = false, className, sizes = "(max-width: 640px) 85vw, (max-width: 1024px) 45vw, 30vw" }: { store: StoreCardData; priority?: boolean; className?: string; sizes?: string }) {
  const place = store.city ?? store.countryName;
  const fallback = categoryBySlug(store.categorySlug)?.media ?? "shopCounter";
  return (
    <article className={cn("group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-500 ease-spring hover:-translate-y-1 hover:shadow-[var(--shadow-md)] focus-within:ring-2 focus-within:ring-primary", className)}>
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
        <MkImage image={store.cover} fallbackMedia={fallback} sizes={sizes} priority={priority} className="transition-transform duration-700 ease-spring group-hover:scale-[1.04]" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/35 to-transparent" />
        {store.openNow && <OpenNowBadge className="absolute right-3 top-3" />}
      </div>

      <div className="relative flex flex-1 flex-col px-4 pb-4">
        <div className="-mt-7 flex items-end justify-between gap-2">
          <Avatar name={store.name} src={store.logoUrl} size={56} className="ring-4 ring-surface shadow-sm" />
          {store.isFeatured && (
            <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-[#3d5a12] dark:text-lime">
              <BadgeCheck className="size-3.5" aria-hidden />
              En vedette
            </span>
          )}
        </div>
        <h3 className="mt-2.5 text-[17px] font-semibold leading-snug tracking-[-0.02em] text-ink">
          <Link href={`/s/${store.slug}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {store.name}
          </Link>
        </h3>
        <p className="mt-0.5 line-clamp-1 text-sm text-ink-muted">{store.tagline ?? `${store.categoryLabel}, ${place}`}</p>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[13px] text-ink-muted">
          {store.rating ? <StoreRating rating={store.rating} /> : <span className="text-ink-faint">Pas encore d&apos;avis</span>}
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {place}
          </span>
          <span className="tabular">
            {store.productCount} {store.productCount > 1 ? "produits" : "produit"}
          </span>
        </div>
      </div>
    </article>
  );
}

/** Ligne boutique compacte (listes latérales). */
export function StoreRow({ store }: { store: StoreCardData }) {
  return (
    <article className="group relative flex items-center gap-3 rounded-[var(--radius-md)] p-2.5 transition-colors duration-300 ease-spring hover:bg-surface-2 focus-within:ring-2 focus-within:ring-primary">
      <Avatar name={store.name} src={store.logoUrl} size={48} className="ring-1 ring-line" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-semibold text-ink">
          <Link href={`/s/${store.slug}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {store.name}
          </Link>
        </h3>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[13px] text-ink-muted">
          <span>{store.categoryLabel}</span>
          {store.city && <span>{store.city}</span>}
          <StoreRating rating={store.rating} />
        </p>
      </div>
      {store.openNow && (
        <span className="hidden shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-deep sm:inline">Ouvert</span>
      )}
    </article>
  );
}
