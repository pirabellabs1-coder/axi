/**
 * Pièces partagées des listes de produits (collection, catalogue, recherche) : facettes, filtres, tri, puces de
 * filtres actifs, pagination. Extraites de `main-collection.tsx` pour que la section `main-search` réutilise
 * EXACTEMENT les mêmes composants que le catalogue (même balisage, même accessibilité, mêmes paramètres d'URL).
 * Composants purs (serveur et aperçu client).
 */
import Link from "next/link";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { activeFilterCount, catalogQuery, SORTS, type CatalogParams } from "@/lib/storefront/catalog";
import { currencyShortLabel, isConverted } from "@/lib/storefront/currency-view";
import { formatMoney } from "@/lib/money";
import type { ListingData } from "@/lib/storefront/render-types";
import { cn } from "@/lib/utils";
import type { RenderCtx } from "../render-context";
import { FilterForm } from "../filter-form";

/** Y a-t-il quelque chose à filtrer (facettes calculées avant filtrage) ? */
export function hasUsefulFacets(L: ListingData): boolean {
  const f = L.facets;
  return f.total > 0 && (f.options.length > 0 || f.tags.length > 0 || f.collections.length > 0 || f.price.max > f.price.min || f.availableCount < f.total);
}

/** Champs cachés qui conservent les paramètres courants lors d'un envoi de formulaire. */
export function HiddenParams({ p, without }: { p: CatalogParams; without?: "sort" }) {
  return (
    <>
      {p.q && <input type="hidden" name="q" value={p.q} />}
      {without !== "sort" && p.sort && <input type="hidden" name="tri" value={p.sort} />}
      {p.collection && <input type="hidden" name="collection" value={p.collection} />}
      {p.min !== null && <input type="hidden" name="prix_min" value={p.min} />}
      {p.max !== null && <input type="hidden" name="prix_max" value={p.max} />}
      {p.available && <input type="hidden" name="dispo" value="1" />}
      {p.tags.map((t) => (
        <input key={t} type="hidden" name="tag" value={t} />
      ))}
      {Object.entries(p.options).flatMap(([k, vs]) => vs.map((v) => <input key={`${k}:${v}`} type="hidden" name="opt" value={`${k}:${v}`} />))}
    </>
  );
}

export function Chip({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link href={href} scroll={false} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
        {label}
        <X className="size-3.5" aria-hidden />
        <span className="sr-only">: retirer ce filtre</span>
      </Link>
    </li>
  );
}

/** Puces des filtres actifs + « Tout effacer » (la requête de recherche n'est jamais retirée). */
export function ActiveFilters({ L, ctx }: { L: ListingData; ctx: RenderCtx }) {
  const p = L.params;
  const count = activeFilterCount(p);
  if (count === 0) return null;
  const store = ctx.data.store;
  const link = (patch: Partial<CatalogParams>) => `${L.basePath}${catalogQuery(p, patch)}`;
  return (
    <ul className="mb-6 flex flex-wrap items-center gap-2" aria-label="Filtres actifs">
      {(p.min !== null || p.max !== null) && (
        <Chip href={link({ min: null, max: null })} label={`Prix : ${p.min !== null ? formatMoney(p.min, store.currency) : "0"} à ${p.max !== null ? formatMoney(p.max, store.currency) : "max"}`} />
      )}
      {p.available && <Chip href={link({ available: false })} label="Disponibles" />}
      {p.collection && <Chip href={link({ collection: null })} label={ctx.data.collections.find((c) => c.handle === p.collection)?.name ?? p.collection} />}
      {p.tags.map((t) => (
        <Chip key={t} href={link({ tags: p.tags.filter((x) => x !== t) })} label={t} />
      ))}
      {Object.entries(p.options).flatMap(([k, vs]) => vs.map((v) => <Chip key={`${k}:${v}`} href={link({ options: { ...p.options, [k]: vs.filter((x) => x !== v) } })} label={`${k} : ${v}`} />))}
      <li>
        <Link href={`${L.basePath}${catalogQuery({ ...p, min: null, max: null, available: false, collection: null, tags: [], options: {} })}`} scroll={false} className="inline-flex min-h-9 items-center px-2 text-sm font-medium text-ink underline underline-offset-4">
          Tout effacer
        </Link>
      </li>
    </ul>
  );
}

function FilterGroup({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-b border-line py-4 first:pt-0">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronRight className="size-4 text-ink-muted transition-transform duration-200 group-open:rotate-90" aria-hidden />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** Panneau de filtres (disponibilité, prix, collection, options, thèmes). `idPrefix` : « d » bureau, « m » mobile. */
export function ListingFilters({ L, ctx, idPrefix }: { L: ListingData; ctx: RenderCtx; idPrefix: string }) {
  const p = L.params;
  const f = L.facets;
  // Le filtre de prix porte sur les montants de la boutique (règles et stock évalués en devise boutique).
  const cur = currencyShortLabel(ctx.data.store.currency);
  const converted = isConverted(ctx.data.currency);
  const box = "flex min-h-10 cursor-pointer items-center gap-3 text-[15px] text-ink";
  return (
    <FilterForm action={L.basePath} className="text-sm">
      {p.q && <input type="hidden" name="q" value={p.q} />}
      {p.sort && <input type="hidden" name="tri" value={p.sort} />}

      {f.availableCount < f.total && (
        <FilterGroup title="Disponibilité">
          <label className={box}>
            <input type="checkbox" name="dispo" value="1" defaultChecked={p.available} className="size-5 accent-[var(--store-primary)]" />
            En stock uniquement <span className="text-ink-muted tabular">({f.availableCount})</span>
          </label>
        </FilterGroup>
      )}

      {f.price.max > f.price.min && (
        <FilterGroup title="Prix">
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs text-ink-muted">Min ({cur})</span>
              <input type="number" name="prix_min" inputMode="numeric" min={0} placeholder={String(f.price.min)} defaultValue={p.min ?? ""} className="sf-input h-11 text-sm" id={`${idPrefix}-min`} />
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs text-ink-muted">Max ({cur})</span>
              <input type="number" name="prix_max" inputMode="numeric" min={0} placeholder={String(f.price.max)} defaultValue={p.max ?? ""} className="sf-input h-11 text-sm" id={`${idPrefix}-max`} />
            </label>
          </div>
          {converted && <p className="mt-1.5 text-xs text-ink-muted">Fourchette exprimée en {cur}, la devise de la boutique.</p>}
          <button type="submit" className="sf-btn sf-btn-soft mt-2 h-10 w-full text-sm">
            Appliquer le prix
          </button>
        </FilterGroup>
      )}

      {f.collections.length > 1 && (
        <FilterGroup title="Collection">
          <label className={box}>
            <input type="radio" name="collection" value="" defaultChecked={!p.collection} className="size-5 accent-[var(--store-primary)]" />
            Toutes
          </label>
          {f.collections.map((c) => (
            <label key={c.handle} className={box}>
              <input type="radio" name="collection" value={c.handle} defaultChecked={p.collection === c.handle} className="size-5 accent-[var(--store-primary)]" />
              {c.name} <span className="text-ink-muted tabular">({c.count})</span>
            </label>
          ))}
        </FilterGroup>
      )}

      {f.options.map((o) => (
        <FilterGroup key={o.name} title={o.name}>
          <div className={cn(o.type === "color" || o.type === "size" ? "flex flex-wrap gap-2" : "")}>
            {o.values.map((v) => {
              const checked = p.options[o.name]?.includes(v.value) ?? false;
              if (o.type === "size" || o.type === "color") {
                return (
                  <label key={v.value} className={cn("relative inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] px-3 text-sm ring-1 ring-inset has-[:checked]:bg-ink has-[:checked]:text-canvas has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--store-primary)]", "ring-line-strong")}>
                    <input type="checkbox" name="opt" value={`${o.name}:${v.value}`} defaultChecked={checked} className="sr-only" />
                    {o.type === "color" && v.swatch && <span className="size-4 rounded-full ring-1 ring-inset ring-black/15" style={{ background: v.swatch }} aria-hidden />}
                    {v.value}
                  </label>
                );
              }
              return (
                <label key={v.value} className={box}>
                  <input type="checkbox" name="opt" value={`${o.name}:${v.value}`} defaultChecked={checked} className="size-5 accent-[var(--store-primary)]" />
                  {v.value} <span className="text-ink-muted tabular">({v.count})</span>
                </label>
              );
            })}
          </div>
        </FilterGroup>
      ))}

      {f.tags.length > 0 && (
        <FilterGroup title="Thèmes" open={f.tags.length <= 8}>
          {f.tags.map((t) => (
            <label key={t.value} className={box}>
              <input type="checkbox" name="tag" value={t.value} defaultChecked={p.tags.includes(t.value)} className="size-5 accent-[var(--store-primary)]" />
              {t.value} <span className="text-ink-muted tabular">({t.count})</span>
            </label>
          ))}
        </FilterGroup>
      )}
      <noscript>
        <button type="submit" className="sf-btn sf-btn-solid mt-4 h-11 w-full text-sm">
          Appliquer
        </button>
      </noscript>
    </FilterForm>
  );
}

/** Colonne de filtres (ordinateur) : collante, défilement propre. */
export function FiltersAside({ L, ctx }: { L: ListingData; ctx: RenderCtx }) {
  return (
    <aside className="hidden lg:block" aria-label="Filtres">
      <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-1">
        <ListingFilters L={L} ctx={ctx} idPrefix="d" />
      </div>
    </aside>
  );
}

/** Filtres sur mobile : panneau en bas d'écran, ouvert par un `<details>` (fonctionne sans JavaScript). */
export function MobileFilters({ L, ctx }: { L: ListingData; ctx: RenderCtx }) {
  const count = activeFilterCount(L.params);
  return (
    <details className="group relative lg:hidden">
      <summary className="sf-btn sf-btn-outline h-11 cursor-pointer list-none px-4 text-sm [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="size-4" aria-hidden /> Filtrer{count ? ` (${count})` : ""}
      </summary>
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-y-auto rounded-t-[24px] bg-surface p-5 pb-8 shadow-[var(--shadow-lg)] ring-1 ring-line">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-lg font-semibold text-ink">Filtres</p>
          <span className="text-sm text-ink-muted">Touchez « Filtrer » pour fermer</span>
        </div>
        <ListingFilters L={L} ctx={ctx} idPrefix="m" />
      </div>
    </details>
  );
}

/** Tri : `<select>` natif envoyé automatiquement (bouton de repli sans JavaScript). */
export function ListingSort({ L, id = "sort-select", defaultSort }: { L: ListingData; id?: string; defaultSort?: string }) {
  return (
    <FilterForm action={L.basePath} className="flex items-center gap-2">
      <HiddenParams p={L.params} without="sort" />
      <label htmlFor={id} className="sr-only sm:not-sr-only sm:text-sm sm:text-ink-muted">
        Trier par
      </label>
      <select id={id} name="tri" defaultValue={L.params.sort ?? defaultSort ?? "pertinence"} className="sf-input h-11 w-auto pr-8 text-sm">
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="sf-btn sf-btn-soft h-11 px-4 text-sm">
          Trier
        </button>
      </noscript>
    </FilterForm>
  );
}

export function ListingPagination({ L }: { L: ListingData }) {
  const pages = Array.from({ length: L.pages }, (_, i) => i + 1).filter((n) => n === 1 || n === L.pages || Math.abs(n - L.page) <= 1);
  const href = (n: number) => `${L.basePath}${catalogQuery(L.params, { page: n })}`;
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1.5">
      {L.page > 1 && (
        <Link href={href(L.page - 1)} aria-label="Page précédente" className="inline-flex size-11 items-center justify-center rounded-full ring-1 ring-inset ring-line-strong hover:bg-surface-2">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      )}
      {pages.map((n, i) => (
        <span key={n} className="contents">
          {i > 0 && n - pages[i - 1] > 1 && <span className="px-1 text-ink-muted">…</span>}
          <Link href={href(n)} aria-current={n === L.page ? "page" : undefined} className={cn("inline-flex size-11 items-center justify-center rounded-full text-sm font-medium tabular", n === L.page ? "bg-ink text-canvas" : "ring-1 ring-inset ring-line-strong hover:bg-surface-2")}>
            {n}
          </Link>
        </span>
      ))}
      {L.page < L.pages && (
        <Link href={href(L.page + 1)} aria-label="Page suivante" className="inline-flex size-11 items-center justify-center rounded-full ring-1 ring-inset ring-line-strong hover:bg-surface-2">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </nav>
  );
}
