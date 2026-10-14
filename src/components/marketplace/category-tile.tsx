import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MEDIA, unsplash } from "@/config/media";
import type { MarketplaceCategory } from "@/lib/marketplace/categories";
import { cn } from "@/lib/utils";

/** Tuile catégorie : vraie photo plein cadre, voile forêt en bas, libellé et nombre de boutiques. */
export function CategoryTile({
  category,
  count,
  size = "sm",
  className,
  sizes = "(max-width: 768px) 50vw, 25vw",
}: {
  category: MarketplaceCategory;
  count?: number;
  size?: "sm" | "lg";
  className?: string;
  sizes?: string;
}) {
  const media = MEDIA[category.media];
  return (
    <Link
      href={`/marketplace/categorie/${category.slug}`}
      className={cn(
        "group relative isolate flex min-h-40 overflow-hidden rounded-[var(--radius-lg)] bg-forest ring-1 ring-line focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
    >
      <Image
        src={unsplash(media.id, size === "lg" ? 1100 : 700, size === "lg" ? 1100 : 760)}
        alt=""
        fill
        sizes={sizes}
        className="-z-10 object-cover transition-transform duration-[900ms] ease-spring group-hover:scale-[1.06]"
      />
      <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-forest-deep/90 via-forest-deep/30 to-transparent" />
      <div className="mt-auto flex w-full items-end justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className={cn("font-semibold leading-tight tracking-[-0.02em] text-white", size === "lg" ? "text-2xl sm:text-3xl" : "text-base sm:text-lg")}>{size === "lg" ? category.label : category.short}</p>
          {size === "lg" && <p className="mt-1.5 hidden max-w-sm text-sm text-white/80 sm:block">{category.description}</p>}
          {count != null && count > 0 && (
            <p className="mt-1 text-[13px] text-white/75 tabular">
              {count} {count > 1 ? "boutiques" : "boutique"}
            </p>
          )}
        </div>
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 transition-transform duration-500 ease-spring group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:bg-lime group-hover:text-forest">
          <ArrowUpRight className="size-4" />
        </span>
      </div>
    </Link>
  );
}
