import Link from "next/link";
import { Search } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import type { CardProduct } from "@/lib/storefront/render-types";
import type { SectionProps } from "../render-context";
import { ProductCard, gridClass, gridSizes } from "../product-card";
import { ButtonLink, EmptyNote, SectionHeading, SectionShell } from "../ui";

/** Tous les produits (accueil) : liste/menu ou grille ; lien vers le catalogue complet filtrable. */
export default function ProductGrid({ section, ctx }: SectionProps) {
  const st = section.settings;
  const perPage = Math.max(8, Math.min(60, S.num(st, "per_page", 24)));
  const all = ctx.data.allProductIds.map((id) => ctx.data.products[id]).filter((p): p is CardProduct => !!p);
  const products = all.slice(0, perPage);
  const layout = S.str(st, "layout", "grid") === "list" ? "list" : "grid";
  const columns = S.str(st, "columns", "4");
  const store = ctx.data.store;
  const count = (
    <span className="text-sm text-ink-muted tabular">
      {all.length} {store.copy.itemNoun}
      {all.length > 1 ? "s" : ""}
    </span>
  );
  return (
    <SectionShell section={section} ctx={ctx}>
      <div id="produits" className="scroll-mt-24" />
      <SectionHeading section={section} ctx={ctx} fallback={store.copy.catalogTitle} aside={count} />
      {(S.bool(st, "show_search", false) || S.bool(st, "show_filters", false)) && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          {S.bool(st, "show_search", false) && (
            <form action={`${ctx.base}/recherche`} method="get" role="search" className="relative sm:w-80">
              <label htmlFor={`q-${section.id}`} className="sr-only">
                {store.copy.searchPlaceholder}
              </label>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
              <input id={`q-${section.id}`} name="q" type="search" placeholder={`${store.copy.searchPlaceholder}…`} className="sf-input pl-10" maxLength={80} />
            </form>
          )}
          {S.bool(st, "show_filters", false) && ctx.data.collections.length > 0 && (
            <ul className="relative scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Catégories">
              {ctx.data.collections
                .filter((c) => c.productIds.length)
                .map((c) => (
                  <li key={c.id}>
                    <Link href={`${ctx.base}/collections/${c.handle}`} className="inline-flex h-11 shrink-0 items-center rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line hover:ring-line-strong">
                      {c.name}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {products.length === 0 ? (
        <EmptyNote title="Bientôt disponible" text={store.copy.emptyCatalog} />
      ) : layout === "list" ? (
        <ListByCollection products={products} ctx={ctx} />
      ) : (
        <div className={gridClass(columns)}>
          {products.map((p, i) => (
            <ProductCard key={p.id} product={p} ctx={ctx} priority={ctx.first && i < 2} sizes={gridSizes(columns)} />
          ))}
        </div>
      )}
      {all.length > products.length && (
        <div className="mt-10 flex justify-center">
          <ButtonLink href={`${ctx.base}/catalogue`} label={`Voir les ${all.length} ${store.copy.itemNoun}s`} style="outline" arrow />
        </div>
      )}
    </SectionShell>
  );
}

/** Mode « menu » : regroupé par collection (restaurants, salons), comme une carte. */
function ListByCollection({ products, ctx }: { products: CardProduct[]; ctx: SectionProps["ctx"] }) {
  const groups = ctx.data.collections
    .map((c) => ({ c, items: products.filter((p) => p.categoryId === c.id) }))
    .filter((g) => g.items.length);
  const rest = products.filter((p) => !groups.some((g) => g.items.includes(p)));
  if (groups.length < 2) {
    return (
      <div className={gridClass(2, "list")}>
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} ctx={ctx} layout="list" priority={ctx.first && i < 2} />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-10">
      {[...groups, ...(rest.length ? [{ c: { id: "autres", name: "Autres", handle: "" }, items: rest }] : [])].map((g) => (
        <section key={g.c.id} aria-labelledby={`grp-${g.c.id}`}>
          <h3 id={`grp-${g.c.id}`} className="mb-4 flex items-baseline gap-3 border-b border-line pb-3 text-lg font-semibold text-ink">
            {g.c.name}
            <span className="text-sm font-normal text-ink-muted tabular">{g.items.length}</span>
          </h3>
          <div className={gridClass(2, "list")}>
            {g.items.map((p) => (
              <ProductCard key={p.id} product={p} ctx={ctx} layout="list" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
