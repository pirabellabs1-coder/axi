import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { Carousel } from "../carousel";
import { ActiveRatingChip, ReviewCard, ReviewPager, ReviewSummaryCard, ReviewsEmpty } from "../reviews";
import { headingClass, SectionShell } from "../ui";

/**
 * Avis vérifiés. Sur la fiche produit : avis du produit, histogramme cliquable (filtre ?note=), pagination (?avis=).
 * Ailleurs : derniers avis de la boutique en carrousel, grille ou liste.
 */
export default function Reviews({ section, ctx }: SectionProps) {
  const st = section.settings;
  const block = ctx.data.reviews;
  const store = ctx.data.store;
  const product = ctx.template === "product" ? ctx.data.product : undefined;
  const heading = S.str(st, "heading", "Avis clients");
  const showSummary = S.bool(st, "show_summary", true);
  const showProduct = S.bool(st, "show_product", true) && !product;
  const layout = S.str(st, "layout", "carousel");
  const titleId = `reviews-${section.id}`;

  const title = (
    <h2 id={titleId} className={headingClass(S.str(st, "heading_size", "md"))}>
      {heading}
    </h2>
  );

  if (block.summary.count === 0) {
    return (
      <SectionShell section={section} ctx={ctx} label={heading}>
        <div id="avis" className="scroll-mt-28" />
        <div className="mb-6">{title}</div>
        <ReviewsEmpty booking={store.booking} productName={product?.name} />
      </SectionShell>
    );
  }

  if (product) {
    const url = (params: { note?: number | null; avis?: number }) => {
      const sp = new URLSearchParams();
      if (params.note) sp.set("note", String(params.note));
      if (params.avis && params.avis > 1) sp.set("avis", String(params.avis));
      const q = sp.toString();
      return `${product.url}${q ? `?${q}` : ""}#avis`;
    };
    return (
      <SectionShell section={section} ctx={ctx} label={heading}>
        <div id="avis" className="scroll-mt-28" />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[340px_1fr] lg:gap-12">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="mb-5">{title}</div>
            {showSummary && <ReviewSummaryCard summary={block.summary} filterHref={(r) => url({ note: r })} active={block.rating} />}
          </div>
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted" aria-live="polite">
                {block.rating ? `Avis ${block.rating} étoile${block.rating > 1 ? "s" : ""}` : "Avis les plus récents"}
                {block.pages > 1 && ` · page ${block.page} sur ${block.pages}`}
              </p>
              {block.rating && <ActiveRatingChip rating={block.rating} clearHref={url({})} />}
            </div>
            {block.items.length === 0 ? (
              <p className="rounded-[var(--store-card-radius)] bg-surface px-5 py-8 text-center text-sm text-ink-muted ring-1 ring-line">Aucun avis avec cette note pour le moment.</p>
            ) : (
              <ul className="grid gap-3">
                {block.items.map((r) => (
                  <li key={r.id}>
                    <ReviewCard review={r} storeName={store.name} base={ctx.base} />
                  </li>
                ))}
              </ul>
            )}
            <ReviewPager block={block} pageHref={(p) => url({ note: block.rating, avis: p })} />
          </div>
        </div>
      </SectionShell>
    );
  }

  const cards = block.items.map((r) => <ReviewCard key={r.id} review={r} storeName={store.name} base={ctx.base} showProduct={showProduct} clamp={layout !== "list"} />);
  return (
    <SectionShell section={section} ctx={ctx} label={heading}>
      <div id="avis" className="scroll-mt-28" />
      <div className={cn("grid grid-cols-1 gap-8", showSummary && "lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-10")}>
        <div className={cn(showSummary && "lg:self-start")}>
          <div className="mb-5">{title}</div>
          {showSummary && <ReviewSummaryCard summary={block.summary} compact />}
        </div>
        <div className={cn(showSummary && "lg:pt-[calc(var(--store-scale)*3.2rem)]")}>
          {layout === "carousel" ? (
            <Carousel label={heading} itemClassName={showSummary ? "w-[86%] sm:w-[48%] xl:w-[calc((100%-20px)/2)]" : "w-[86%] sm:w-[48%] lg:w-[calc((100%-2*20px)/3)]"} dots>
              {cards}
            </Carousel>
          ) : layout === "grid" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{cards}</div>
          ) : (
            <div className="grid gap-3">{cards}</div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
