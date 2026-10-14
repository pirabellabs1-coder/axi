import Link from "next/link";
import { Search } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { activeFilterCount, catalogQuery } from "@/lib/storefront/catalog";
import { cn } from "@/lib/utils";
import type { CardProduct, RenderData } from "@/lib/storefront/render-types";
import type { RenderCtx, SectionProps } from "../render-context";
import { ProductCard, gridClass, gridSizes } from "../product-card";
import { ButtonLink, EmptyNote, headingClass, SectionShell } from "../ui";
import { ActiveFilters, FiltersAside, hasUsefulFacets, ListingPagination, ListingSort, MobileFilters } from "./listing-parts";

/** Nombre de résultats sous lequel on propose aussi des suggestions de mots proches. */
const FEW_RESULTS = 3;
const MAX_SUGGESTIONS = 6;
const MAX_COLLECTIONS = 8;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Mots proches de la requête, pris dans le catalogue (noms de produits, marques, types, thèmes). Pur et testé :
 * aucune dépendance au serveur. Ordre : préfixe commun, puis fréquence, puis alphabétique.
 */
export function searchSuggestions(products: CardProduct[], query: string, limit = MAX_SUGGESTIONS): string[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const counts = new Map<string, { label: string; score: number }>();
  const add = (raw: string | null | undefined, weight: number) => {
    const label = (raw ?? "").trim();
    if (!label || label.length > 40) return;
    const key = norm(label);
    if (!key || key === q) return;
    // Proximité : la requête est contenue dans le terme, ou le terme commence comme la requête (faute de frappe,
    // pluriel, mot tronqué : « pagn » → « pagne »).
    const near = key.includes(q) || q.includes(key) || key.startsWith(q.slice(0, Math.max(3, q.length - 2)));
    if (!near) return;
    const cur = counts.get(key);
    if (cur) cur.score += weight;
    else counts.set(key, { label, score: weight });
  };
  for (const p of products) {
    for (const t of p.tags) add(t, 3);
    add(p.vendor, 2);
    add(p.productType, 2);
    for (const word of (p.name ?? "").split(/[\s,·/|–—-]+/)) if (word.length >= 3) add(word, 1);
  }
  return [...counts.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "fr"))
    .slice(0, limit)
    .map((x) => x.label);
}

/** Produits mis en avant pour la page vide : « mis en avant » du commerçant, puis l'ordre par défaut de la boutique. */
function featuredProducts(data: RenderData, limit: number): CardProduct[] {
  const all = data.allProductIds.map((id) => data.products[id]).filter(Boolean);
  const featured = all.filter((p) => p.isFeatured && !p.soldOut);
  const rest = all.filter((p) => !p.isFeatured && !p.soldOut);
  return [...featured, ...rest].slice(0, Math.max(0, limit));
}

function SuggestionChips({ terms, basePath, params }: { terms: string[]; basePath: string; params: Parameters<typeof catalogQuery>[0] }) {
  if (!terms.length) return null;
  return (
    <section aria-labelledby="search-suggestions" className="mb-8">
      <h2 id="search-suggestions" className="mb-3 text-sm font-semibold text-ink">
        Essayez aussi
      </h2>
      <ul className="flex flex-wrap gap-2">
        {terms.map((t) => (
          <li key={t}>
            <Link
              href={`${basePath}${catalogQuery({ ...params, q: t, page: 1 })}`}
              className="inline-flex min-h-11 items-center rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--store-primary)]"
            >
              {t}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CollectionChips({ ctx }: { ctx: RenderCtx }) {
  const cols = ctx.data.collections.filter((c) => c.productIds.length).slice(0, MAX_COLLECTIONS);
  if (!cols.length) return null;
  return (
    <section aria-labelledby="search-browse">
      <h2 id="search-browse" className="mb-3 text-sm font-semibold text-ink">
        Parcourir
      </h2>
      <ul className="flex flex-wrap gap-2">
        {cols.map((c) => (
          <li key={c.id}>
            <Link
              href={`${ctx.base}/collections/${c.handle}`}
              className="inline-flex min-h-11 items-center rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--store-primary)]"
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Contenu d'accueil et de secours : collections à parcourir et produits mis en avant (réglage `empty_content`). */
function EmptyContent({ ctx, mode, heading, limit }: { ctx: RenderCtx; mode: string; heading: string; limit: number }) {
  const showCollections = mode === "both" || mode === "collections";
  const showProducts = mode === "both" || mode === "products";
  const products = showProducts ? featuredProducts(ctx.data, limit) : [];
  if (!showCollections && products.length === 0) return null;
  return (
    <div className="space-y-10">
      {showCollections && <CollectionChips ctx={ctx} />}
      {products.length > 0 && (
        <section aria-labelledby="search-featured">
          <h2 id="search-featured" className="mb-4 text-sm font-semibold text-ink">
            {heading}
          </h2>
          <div className={gridClass(String(Math.min(4, Math.max(2, products.length))))}>
            {products.map((p) => (
              <ProductCard key={p.id} product={p} ctx={ctx} sizes={gridSizes(4)} />
            ))}
          </div>
        </section>
      )}
      <ButtonLink href={`${ctx.base}/catalogue`} label="Voir tout le catalogue" style="outline" arrow />
    </div>
  );
}

/**
 * Modèle « Recherche » (vague 2) : champ de recherche, en-tête de résultats (« 12 résultats pour “wax” »),
 * filtres et tri identiques au catalogue (`listing-parts.tsx`), suggestions de mots proches quand il y a peu ou
 * pas de résultats, contenu d'accueil avant toute recherche. Mobile d'abord, sans débordement horizontal.
 */
export default function MainSearch({ section, ctx }: SectionProps) {
  const L = ctx.data.listing;
  if (!L) return null;
  const st = section.settings;
  const store = ctx.data.store;
  const p = L.params;
  const query = p.q;
  const heading = S.str(st, "heading", "Rechercher");
  const placeholder = S.str(st, "placeholder").trim() || store.copy.searchPlaceholder;
  const columns = S.str(st, "columns", "4");
  const filters = S.bool(st, "show_filters", true) && hasUsefulFacets(L);
  const products = L.productIds.map((id) => ctx.data.products[id]).filter(Boolean);
  const filterCount = activeFilterCount(p);
  const suggestions = S.bool(st, "show_suggestions", true) && query && L.total <= FEW_RESULTS ? searchSuggestions(Object.values(ctx.data.products), query) : [];
  const emptyMode = S.str(st, "empty_content", "both");
  const featuredHeading = S.str(st, "featured_heading", "Les plus demandés") || "Les plus demandés";
  const featuredLimit = Math.max(2, Math.min(8, S.num(st, "featured_limit", 4)));

  return (
    <SectionShell section={section} ctx={ctx} padded={false} className="pb-14 pt-4 sm:pt-8">
      <div className="max-w-[62ch]">
        {heading && <h1 className={headingClass(S.str(st, "heading_size", "lg"))}>{heading}</h1>}
        <form action={L.basePath} method="get" role="search" className={cn("relative", heading ? "mt-5" : "")}>
          <label htmlFor="search-page-q" className="sr-only">
            {placeholder}
          </label>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input
            id="search-page-q"
            name="q"
            type="search"
            enterKeyHint="search"
            defaultValue={query}
            autoFocus={!query}
            placeholder={`${placeholder}…`}
            maxLength={80}
            className="sf-input h-14 w-full pl-12 pr-[7.5rem] text-[16px]"
          />
          {/* Les filtres déjà posés sont conservés d'une recherche à l'autre. */}
          {p.sort && <input type="hidden" name="tri" value={p.sort} />}
          <button type="submit" className="sf-btn sf-btn-solid absolute right-1.5 top-1.5 h-11 px-4 text-sm">
            Rechercher
          </button>
        </form>
      </div>

      {!query ? (
        <div className="mt-10">
          <EmptyContent ctx={ctx} mode={emptyMode} heading={featuredHeading} limit={featuredLimit} />
        </div>
      ) : (
        <div className={cn("mt-8 grid gap-8", filters && "lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-10")}>
          {filters && <FiltersAside L={L} ctx={ctx} />}
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-ink" aria-live="polite">
                {L.total === 0 ? "Aucun résultat" : `${L.total} ${L.total > 1 ? "résultats" : "résultat"}`} pour «&nbsp;<span className="break-words">{query}</span>&nbsp;»
              </h2>
              {/* Sans résultat, seul le retrait des filtres a du sens : le tri est masqué. */}
              <div className="flex items-center gap-2">
                {filters && products.length > 0 && <MobileFilters L={L} ctx={ctx} />}
                {S.bool(st, "show_sort", true) && products.length > 0 && <ListingSort L={L} defaultSort={S.str(st, "default_sort", "pertinence")} />}
              </div>
            </div>

            <ActiveFilters L={L} ctx={ctx} />
            <SuggestionChips terms={suggestions} basePath={L.basePath} params={p} />

            {products.length === 0 ? (
              <>
                <EmptyNote
                  title={`Aucun résultat pour « ${query} »`}
                  text={filterCount ? "Retirez un filtre ou élargissez la fourchette de prix." : "Vérifiez l'orthographe ou essayez un mot plus court."}
                  action={filterCount ? <ButtonLink href={`${L.basePath}${catalogQuery({ ...p, min: null, max: null, available: false, collection: null, tags: [], options: {} })}`} label="Retirer les filtres" style="solid" /> : undefined}
                />
                <div className="mt-10">
                  <EmptyContent ctx={ctx} mode={emptyMode} heading={featuredHeading} limit={featuredLimit} />
                </div>
              </>
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
      )}
    </SectionShell>
  );
}
