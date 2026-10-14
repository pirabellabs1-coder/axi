import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { activeFilterCount } from "@/lib/storefront/catalog";
import { cn } from "@/lib/utils";
import type { BlockInstance } from "@/lib/theme-engine/types";
import type { SectionProps } from "../render-context";
import { ProductCard, gridClass, gridSizes } from "../product-card";
import { ProductImage } from "../product-image";
import { ButtonLink, EmptyNote, headingClass, SectionShell } from "../ui";
import { ActiveFilters, FiltersAside, hasUsefulFacets, ListingPagination, ListingSort, MobileFilters } from "./listing-parts";

/** Lot 4 §5 : blocs « Champ personnalisé » (libellé + valeur résolue avant le rendu ; valeur vide = ligne omise). */
function MetafieldLines({ blocks }: { blocks: BlockInstance[] }) {
  const lines = blocks.filter((b) => !b.disabled && b.type === "metafield" && S.str(b.settings, "value").trim());
  if (!lines.length) return null;
  return (
    <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
      {lines.map((b) => (
        <div key={b.id} className="flex gap-1.5">
          {S.str(b.settings, "label").trim() ? <dt className="font-semibold text-ink">{S.str(b.settings, "label").trim()} :</dt> : <dt className="sr-only">Détail</dt>}
          <dd className="whitespace-pre-line text-ink-muted">{S.str(b.settings, "value").trim()}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Collection ou catalogue complet : bandeau, filtres (prix, collection, disponibilité, tags, options), tri,
 * pagination. La recherche a son propre modèle et sa propre section (`main-search`), qui réutilise les mêmes
 * pièces de liste (`listing-parts.tsx`).
 */
export default function MainCollection({ section, ctx }: SectionProps) {
  const L = ctx.data.listing;
  if (!L) return null;
  const st = section.settings;
  const showSort = S.bool(st, "show_sort", true);
  const columns = S.str(st, "columns", "4");
  const p = L.params;
  const count = activeFilterCount(p);
  const products = L.productIds.map((id) => ctx.data.products[id]).filter(Boolean);
  const store = ctx.data.store;
  const filters = S.bool(st, "show_filters", true) && hasUsefulFacets(L);

  return (
    <SectionShell section={section} ctx={ctx} padded={false} className="pb-14 pt-4 sm:pt-8">
      {/* Bandeau */}
      {S.bool(st, "show_banner", true) && (
        <header className={cn("mb-8", L.image && L.kind === "collection" && "grid grid-cols-1 items-end gap-6 md:grid-cols-[1fr_minmax(0,420px)]")}>
          <div>
            {L.kind === "collection" && (
              <Link href={`${ctx.base}/catalogue`} className="-ml-1 mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-ink-muted hover:text-ink">
                <ChevronLeft className="size-4" aria-hidden /> {store.copy.catalogTitle}
              </Link>
            )}
            <h1 className={headingClass("lg")}>{L.title}</h1>
            {L.description && <p className="mt-3 max-w-[62ch] whitespace-pre-line text-[16px] leading-relaxed text-ink-muted">{L.description}</p>}
            <MetafieldLines blocks={section.blocks} />
          </div>
          {L.image && L.kind === "collection" && <ProductImage src={L.image.url} alt="" ratio="aspect-[16/10]" className="rounded-[var(--store-card-radius)]" sizes="(max-width: 768px) 100vw, 420px" priority={ctx.first} />}
        </header>
      )}

      <div className={cn("grid gap-8", filters && "lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-10")}>
        {filters && <FiltersAside L={L} ctx={ctx} />}
        <div className="min-w-0">
          {/* Barre d'outils */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted tabular" aria-live="polite">
              {L.total} {L.total > 1 ? "résultats" : "résultat"}
            </p>
            <div className="flex items-center gap-2">
              {filters && <MobileFilters L={L} ctx={ctx} />}
              {showSort && <ListingSort L={L} />}
            </div>
          </div>

          <ActiveFilters L={L} ctx={ctx} />

          {products.length === 0 ? (
            <EmptyNote
              title={count ? "Aucun produit ne correspond" : "Cette collection est vide pour le moment"}
              text={count ? "Retirez un filtre ou élargissez la fourchette de prix." : store.copy.emptyCatalog}
              action={<ButtonLink href={`${ctx.base}/catalogue`} label="Voir tout le catalogue" style="solid" />}
            />
          ) : (
            <div className={gridClass(filters ? Math.min(Number(columns) || 4, 3) : columns)}>
              {products.map((prod, i) => (
                <ProductCard key={prod.id} product={prod} ctx={ctx} priority={ctx.first && i < 2} sizes={gridSizes(filters ? 3 : columns)} />
              ))}
            </div>
          )}

          {L.pages > 1 && <ListingPagination L={L} />}
        </div>
      </div>
    </SectionShell>
  );
}
