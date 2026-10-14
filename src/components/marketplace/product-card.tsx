import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ProductCardData } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";
import { MkImage } from "./mk-image";

function discountPct(p: ProductCardData) {
  if (p.compareAt == null || p.compareAt <= p.price) return null;
  const pct = Math.round(((p.compareAt - p.price) / p.compareAt) * 100);
  return pct >= 1 ? pct : null;
}

/** Carte produit 4/5 : photo, boutique, nom, prix (promo barrée). Lien vers la fiche produit de la boutique. */
export function ProductCard({
  product,
  priority = false,
  className,
  sizes = "(max-width: 640px) 48vw, (max-width: 1024px) 31vw, 22vw",
}: {
  product: ProductCardData;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  const pct = discountPct(product);
  const href = `/s/${product.store.slug}/p/${product.slug}`;
  return (
    <article className={cn("group relative flex h-full flex-col", className)}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-lg)] bg-surface-2 ring-1 ring-line">
        <MkImage
          image={product.image}
          sizes={sizes}
          priority={priority}
          className={cn("transition-transform duration-700 ease-spring group-hover:scale-[1.05]", product.soldOut && "opacity-60 grayscale-[35%]")}
        />
        {product.soldOut && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-ink/80 px-2.5 py-1 text-xs font-semibold text-canvas shadow-sm">Épuisé</span>
        )}
        {pct != null && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent tabular shadow-sm">
            -{pct}&nbsp;%
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col px-0.5 pt-3">
        <Link href={`/s/${product.store.slug}`} className="relative z-10 w-fit max-w-full truncate rounded text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink">
          {product.store.name}
        </Link>
        <h3 className="mt-0.5 line-clamp-2 text-[15px] font-medium leading-snug text-ink">
          <Link href={href} className="after:absolute after:inset-0 after:rounded-[var(--radius-lg)] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-offset-4 focus-visible:after:ring-offset-canvas">
            {product.name}
          </Link>
        </h3>
        <p className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-1.5">
          <span className={cn("text-[15px] font-semibold tabular", product.compareAt != null ? "text-primary" : "text-ink")}>
            {product.compareAt != null && <span className="sr-only">Prix promotionnel : </span>}
            {formatMoney(product.price, product.currency)}
          </span>
          {product.compareAt != null && (
            <s className="text-[13px] text-ink-faint tabular">
              <span className="sr-only">Prix normal : </span>
              {formatMoney(product.compareAt, product.currency)}
            </s>
          )}
        </p>
      </div>
    </article>
  );
}
