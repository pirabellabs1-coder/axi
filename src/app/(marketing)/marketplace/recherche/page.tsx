import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchX, Store, X } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { COUNTRIES, SITE } from "@/config/site";
import { CategoryTile } from "@/components/marketplace/category-tile";
import { FilterDrawer, FilterSidebar, SortSelect } from "@/components/marketplace/filter-panel";
import { Breadcrumbs, JsonLd, Pagination } from "@/components/marketplace/parts";
import { ProductCard } from "@/components/marketplace/product-card";
import { SearchBar } from "@/components/marketplace/search-bar";
import { StoreCard } from "@/components/marketplace/store-card";
import { MARKETPLACE_CATEGORIES, categoryBySlug } from "@/lib/marketplace/categories";
import { getCities, searchMarketplace, type SearchResult } from "@/lib/marketplace/data";
import { PAGE_SIZE, hasActiveFilters, parseMarketplaceQuery, searchHref, type MarketplaceQuery } from "@/lib/marketplace/query";
import type { CityCount } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const q = parseMarketplaceQuery(await searchParams);
  const cat = categoryBySlug(q.cat);
  const parts = [q.q ? `« ${q.q} »` : null, cat?.label, q.ville].filter(Boolean);
  return {
    title: parts.length ? `Recherche ${parts.join(", ")} | Marketplace` : "Rechercher sur la marketplace",
    description: "Résultats de recherche parmi les produits et boutiques de la marketplace Axi.",
    alternates: { canonical: "/marketplace/recherche" },
    robots: { index: false, follow: true },
  };
}

const nf = new Intl.NumberFormat("fr-FR");

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const query = parseMarketplaceQuery(await searchParams);
  const cat = categoryBySlug(query.cat);

  let result: SearchResult | null = null;
  let cities: CityCount[] = [];
  try {
    [result, cities] = await Promise.all([searchMarketplace(query), getCities(200)]);
  } catch (e) {
    console.error("[marketplace/recherche]", e);
  }

  if (result && query.page > result.pageCount) redirect(searchHref({ ...query, page: result.pageCount }));

  const countryCodes = new Set(cities.map((c) => c.country));
  const countries = COUNTRIES.filter((c) => countryCodes.has(c.code)).map((c) => ({ code: c.code, name: c.name }));

  const total = result ? (query.onglet === "produits" ? result.productTotal : result.storeTotal) : 0;
  const noun = query.onglet === "produits" ? (total > 1 ? "produits" : "produit") : total > 1 ? "boutiques" : "boutique";
  const title = query.q ? (
    <>
      Résultats pour <span className="text-ink-muted">« {query.q} »</span>
    </>
  ) : cat ? (
    cat.label
  ) : query.onglet === "boutiques" ? (
    "Toutes les boutiques"
  ) : (
    "Tous les produits"
  );

  const hidden = { cat: query.cat, pays: query.pays, ville: query.ville, onglet: query.onglet !== "produits" ? query.onglet : undefined };
  const chips = activeChips(query);

  const jsonLd =
    result && query.onglet === "produits" && result.products.length
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: result.products.map((p, i) => ({ "@type": "ListItem", position: (query.page - 1) * PAGE_SIZE + i + 1, url: `${SITE.url}/s/${p.store.slug}/p/${p.slug}`, name: p.name })),
        }
      : null;

  return (
    <div data-mk className="container-x pb-20 pt-6 md:pt-10">
      <Breadcrumbs items={[{ href: "/marketplace", label: "Marketplace" }, { label: "Recherche" }]} />

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-end">
        <h1 className="text-h1 font-semibold text-ink">{title}</h1>
        <SearchBar defaultValue={query.q ?? ""} size="md" hidden={hidden} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-12">
        <aside aria-label="Filtres" className="hidden lg:block">
          <div className="sticky top-[92px] max-h-[calc(100dvh-110px)] overflow-y-auto pb-6 pr-1">
            <FilterSidebar query={query} cities={cities} countries={countries} />
          </div>
        </aside>

        <div className="min-w-0">
          {/* Barre d'outils : onglets, compteur, tri, filtres mobiles */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <nav aria-label="Type de résultats" className="flex gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-line">
              <Tab href={searchHref({ ...query, onglet: "produits", page: 1 })} active={query.onglet === "produits"} label="Produits" count={result?.productTotal} />
              <Tab href={searchHref({ ...query, onglet: "boutiques", page: 1, tri: query.tri === "prix-croissant" || query.tri === "prix-decroissant" ? "pertinence" : query.tri })} active={query.onglet === "boutiques"} label="Boutiques" count={result?.storeTotal} />
            </nav>
            <div className="flex items-center gap-2">
              <div className="lg:hidden">
                <FilterDrawer query={query} cities={cities} countries={countries} resultLabel={result ? `Voir ${nf.format(total)} ${noun}` : "Voir les résultats"} />
              </div>
              <SortSelect query={query} />
            </div>
          </div>

          <div className="mt-4 flex min-h-8 flex-wrap items-center gap-2">
            <p className="mr-2 text-sm text-ink-muted" aria-live="polite">
              {result ? (
                <>
                  <span className="font-semibold text-ink tabular">{nf.format(total)}</span> {noun}
                  {query.page > 1 && <>, page {query.page} sur {result.pageCount}</>}
                </>
              ) : null}
            </p>
            {chips.map((c) => (
              <Link key={c.key} href={searchHref({ ...query, ...c.clear, page: 1 })} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary-soft pl-3 pr-2 text-[13px] font-medium text-primary-deep transition-colors hover:bg-primary/15">
                {c.label}
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">Retirer ce filtre</span>
              </Link>
            ))}
          </div>

          {!result ? (
            <EmptyState className="mt-8" icon={Store} title="La recherche est momentanément indisponible" description="Nos serveurs rencontrent un souci temporaire. Réessayez dans quelques instants." action={<ButtonLink href={searchHref(query)} variant="outline">Réessayer</ButtonLink>} />
          ) : total === 0 ? (
            <NoResults query={query} otherTabCount={query.onglet === "produits" ? result.storeTotal : result.productTotal} />
          ) : query.onglet === "produits" ? (
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-3 xl:grid-cols-4">
              {result.products.map((p, i) => (
                <li key={p.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                  <ProductCard product={p} priority={i < 4} />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {result.stores.map((s, i) => (
                <li key={s.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
                  <StoreCard store={s} priority={i < 2} sizes="(max-width: 640px) 100vw, (max-width: 1280px) 40vw, 28vw" />
                </li>
              ))}
            </ul>
          )}

          {result && <Pagination page={query.page} pageCount={result.pageCount} hrefFor={(p) => searchHref({ ...query, page: p })} />}
        </div>
      </div>
      {jsonLd && <JsonLd data={jsonLd} />}
    </div>
  );
}

function Tab({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-300 ease-spring",
        active ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-muted hover:text-ink",
      )}
    >
      {label}
      {count != null && <span className={cn("rounded-full px-1.5 text-xs tabular", active ? "bg-primary-soft text-primary-deep" : "bg-surface text-ink-muted")}>{nf.format(count)}</span>}
    </Link>
  );
}

function activeChips(q: MarketplaceQuery): { key: string; label: string; clear: Partial<MarketplaceQuery> }[] {
  const out: { key: string; label: string; clear: Partial<MarketplaceQuery> }[] = [];
  const cat = categoryBySlug(q.cat);
  if (cat) out.push({ key: "cat", label: cat.short, clear: { cat: undefined } });
  if (q.pays) out.push({ key: "pays", label: COUNTRIES.find((c) => c.code === q.pays)?.name ?? q.pays, clear: { pays: undefined } });
  if (q.ville) out.push({ key: "ville", label: q.ville, clear: { ville: undefined } });
  if (q.min != null || q.max != null) {
    const label = q.min != null && q.max != null ? `${nf.format(q.min)} à ${nf.format(q.max)}` : q.min != null ? `Dès ${nf.format(q.min)}` : `Jusqu'à ${nf.format(q.max!)}`;
    out.push({ key: "prix", label, clear: { min: undefined, max: undefined } });
  }
  return out;
}

function NoResults({ query, otherTabCount }: { query: MarketplaceQuery; otherTabCount: number }) {
  const other = query.onglet === "produits" ? "boutiques" : "produits";
  return (
    <div className="mt-8">
      <EmptyState
        icon={SearchX}
        title={query.q ? `Aucun résultat pour « ${query.q} »` : "Aucun résultat avec ces filtres"}
        description={
          otherTabCount > 0
            ? `Mais ${nf.format(otherTabCount)} ${other} correspondent. Vérifiez aussi l'orthographe ou essayez un mot plus court.`
            : "Vérifiez l'orthographe, essayez un mot plus général ou retirez un filtre."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {otherTabCount > 0 && (
              <ButtonLink href={searchHref({ ...query, onglet: other as MarketplaceQuery["onglet"], page: 1 })} variant="primary">
                Voir les {other}
              </ButtonLink>
            )}
            {hasActiveFilters(query) && (
              <ButtonLink href={searchHref({ q: query.q, onglet: query.onglet })} variant="outline">
                Retirer les filtres
              </ButtonLink>
            )}
            {!hasActiveFilters(query) && otherTabCount === 0 && (
              <ButtonLink href="/marketplace" variant="outline">
                Retour à la marketplace
              </ButtonLink>
            )}
          </div>
        }
      />
      <h2 className="mt-12 text-h3 font-semibold text-ink">Explorer par catégorie</h2>
      <div className="mt-4 grid auto-rows-[130px] grid-cols-2 gap-3 sm:grid-cols-4">
        {MARKETPLACE_CATEGORIES.slice(0, 4).map((c) => (
          <CategoryTile key={c.slug} category={c} className="min-h-0" />
        ))}
      </div>
    </div>
  );
}
