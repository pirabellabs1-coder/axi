"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, SlidersHorizontal, X } from "lucide-react";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace/categories";
import { SORTS, searchHref, type MarketplaceQuery, type SortId } from "@/lib/marketplace/query";
import type { CityCount } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";

type Props = {
  query: MarketplaceQuery;
  cities: CityCount[];
  countries: { code: string; name: string }[];
};

function useQueryNavigation(query: MarketplaceQuery) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const update = React.useCallback(
    (patch: Partial<MarketplaceQuery>) => {
      startTransition(() => router.push(searchHref({ ...query, ...patch, page: 1 }), { scroll: false }));
    },
    [query, router],
  );
  return { update, pending };
}

const fieldCls =
  "block h-12 w-full rounded-[var(--radius-md)] border-0 bg-surface px-3.5 text-ink ring-1 ring-inset ring-line-strong transition-shadow duration-200 ease-spring focus:outline-none focus:ring-2 focus:ring-primary";

function Filters({ query, cities, countries, update, idPrefix }: Props & { update: (p: Partial<MarketplaceQuery>) => void; idPrefix: string }) {
  const [min, setMin] = React.useState(query.min?.toString() ?? "");
  const [max, setMax] = React.useState(query.max?.toString() ?? "");
  const urlPrice = `${query.min ?? ""}-${query.max ?? ""}`;
  const [prevPrice, setPrevPrice] = React.useState(urlPrice);
  if (prevPrice !== urlPrice) {
    setPrevPrice(urlPrice);
    setMin(query.min?.toString() ?? "");
    setMax(query.max?.toString() ?? "");
  }

  const toInt = (v: string) => {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return v.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };

  const visibleCities = query.pays ? cities.filter((c) => c.country === query.pays) : cities;

  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Catégorie</legend>
        <div className="mt-2.5 space-y-0.5">
          {[{ slug: undefined as string | undefined, short: "Toutes les catégories" }, ...MARKETPLACE_CATEGORIES].map((c) => {
            const checked = query.cat === c.slug;
            return (
              <label
                key={c.slug ?? "all"}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2.5 text-[15px] transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                  checked ? "bg-primary-soft font-medium text-primary-deep" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <input type="radio" name={`${idPrefix}-cat`} className="sr-only" checked={checked} onChange={() => update({ cat: c.slug })} />
                <span className={cn("inline-flex size-[18px] shrink-0 items-center justify-center rounded-full ring-1 ring-inset", checked ? "bg-primary text-on-primary ring-primary" : "ring-line-strong")} aria-hidden>
                  {checked && <Check className="size-3" />}
                </span>
                {c.short}
              </label>
            );
          })}
        </div>
      </fieldset>

      {countries.length > 1 && (
        <div>
          <label htmlFor={`${idPrefix}-pays`} className="text-sm font-semibold text-ink">
            Pays
          </label>
          <select id={`${idPrefix}-pays`} className={cn(fieldCls, "mt-2.5")} value={query.pays ?? ""} onChange={(e) => update({ pays: e.target.value || undefined, ville: undefined })}>
            <option value="">Tous les pays</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {visibleCities.length > 0 && (
        <div>
          <label htmlFor={`${idPrefix}-ville`} className="text-sm font-semibold text-ink">
            Ville
          </label>
          <select id={`${idPrefix}-ville`} className={cn(fieldCls, "mt-2.5")} value={query.ville ?? ""} onChange={(e) => update({ ville: e.target.value || undefined })}>
            <option value="">Toutes les villes</option>
            {visibleCities.map((c) => (
              <option key={c.slug} value={c.city}>
                {c.city} ({c.stores})
              </option>
            ))}
          </select>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          update({ min: toInt(min), max: toInt(max) });
        }}
      >
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Prix</legend>
          <p id={`${idPrefix}-price-hint`} className="mt-1 text-[13px] text-ink-muted">
            Dans la devise de la boutique (FCFA, euros...).
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${idPrefix}-min`} className="mb-1 block text-[13px] text-ink-muted">
                Minimum
              </label>
              <input id={`${idPrefix}-min`} inputMode="numeric" pattern="[0-9 ]*" aria-describedby={`${idPrefix}-price-hint`} className={fieldCls} value={min} onChange={(e) => setMin(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-max`} className="mb-1 block text-[13px] text-ink-muted">
                Maximum
              </label>
              <input id={`${idPrefix}-max`} inputMode="numeric" pattern="[0-9 ]*" aria-describedby={`${idPrefix}-price-hint`} className={fieldCls} value={max} onChange={(e) => setMax(e.target.value)} placeholder="Sans limite" />
            </div>
          </div>
          <button type="submit" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-full bg-surface-2 text-sm font-medium text-ink ring-1 ring-inset ring-line transition-[background-color,transform] duration-300 ease-spring hover:bg-line active:scale-[0.98]">
            Appliquer le prix
          </button>
        </fieldset>
      </form>
    </div>
  );
}

function activeCount(q: MarketplaceQuery) {
  return [q.cat, q.pays, q.ville, q.min ?? q.max].filter((v) => v != null && v !== "").length;
}

/** Filtres : barre latérale (desktop). */
export function FilterSidebar(props: Props) {
  const { update, pending } = useQueryNavigation(props.query);
  return (
    <div aria-busy={pending} className={cn("transition-opacity duration-300", pending && "opacity-60")}>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">Filtres</h2>
        {activeCount(props.query) > 0 && (
          <button type="button" onClick={() => update({ cat: undefined, pays: undefined, ville: undefined, min: undefined, max: undefined })} className="rounded-full px-2 py-1 text-sm font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline">
            Tout effacer
          </button>
        )}
      </div>
      <Filters {...props} update={update} idPrefix="side" />
    </div>
  );
}

/** Filtres : bouton + tiroir (mobile). */
export function FilterDrawer(props: Props & { resultLabel: string }) {
  const { update, pending } = useQueryNavigation(props.query);
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const count = activeCount(props.query);

  const close = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && panelRef.current) {
        const els = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button, input, select, a[href]")).filter((el) => !el.hasAttribute("disabled"));
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (!panelRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong transition-transform duration-300 ease-spring active:scale-[0.97]"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        Filtres
        {count > 0 && <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary tabular">{count}</span>}
      </button>

      <div className={cn("fixed inset-0 z-[60]", open ? "visible" : "invisible")} aria-hidden={!open}>
        <div className={cn("absolute inset-0 bg-forest-deep/50 transition-opacity duration-300 ease-out-expo", open ? "opacity-100" : "opacity-0")} onClick={close} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mk-filter-title"
          className={cn(
            "absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-xl)] bg-canvas shadow-[var(--shadow-lg)] transition-transform duration-500 ease-spring",
            open ? "translate-y-0" : "translate-y-full",
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="mk-filter-title" className="text-lg font-semibold text-ink">
              Filtres
            </h2>
            <button type="button" onClick={close} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2" aria-label="Fermer les filtres">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{open && <Filters {...props} update={update} idPrefix="drawer" />}</div>
          <div className="flex items-center gap-3 border-t border-line px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {count > 0 && (
              <button type="button" onClick={() => update({ cat: undefined, pays: undefined, ville: undefined, min: undefined, max: undefined })} className="h-12 rounded-full px-4 text-sm font-medium text-ink-muted hover:text-ink">
                Tout effacer
              </button>
            )}
            <button type="button" onClick={close} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-medium text-on-primary transition-transform duration-300 ease-spring active:scale-[0.98]">
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {props.resultLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Sélecteur de tri. */
export function SortSelect({ query }: { query: MarketplaceQuery }) {
  const { update, pending } = useQueryNavigation(query);
  const options = query.onglet === "boutiques" ? SORTS.filter((s) => s.id === "pertinence" || s.id === "nouveautes") : SORTS;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="mk-sort" className="hidden text-sm text-ink-muted sm:block">
        Trier par
      </label>
      <div className="relative">
        <select
          id="mk-sort"
          aria-label="Trier les résultats"
          value={query.tri}
          onChange={(e) => update({ tri: e.target.value as SortId })}
          className="h-11 appearance-none rounded-full bg-surface pl-4 pr-10 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {pending ? (
          <Loader2 className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-muted" aria-hidden />
        ) : (
          <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        )}
      </div>
    </div>
  );
}
