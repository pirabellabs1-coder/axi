"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, MapPin, Package, Search, Store, Tag, X } from "lucide-react";
import type { Suggestion } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";

const ICONS = { store: Store, product: Package, category: Tag, city: MapPin } as const;
const TYPE_LABEL = { store: "Boutique", product: "Produit", category: "Catégorie", city: "Ville" } as const;

/**
 * Barre de recherche avec suggestions (combobox ARIA 1.2).
 * Envoie le formulaire vers /marketplace/recherche ; une suggestion choisie ouvre directement sa page.
 */
export function SearchBar({
  defaultValue = "",
  size = "lg",
  hidden,
  autoFocus = false,
  className,
  placeholder = "Gâteau, robe en wax, téléphone, boutique...",
}: {
  defaultValue?: string;
  size?: "lg" | "md";
  /** Filtres à conserver lors d'une nouvelle recherche. */
  hidden?: Record<string, string | undefined>;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const id = React.useId();
  const listId = `${id}-list`;
  const [value, setValue] = React.useState(defaultValue);
  const [items, setItems] = React.useState<Suggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [loading, setLoading] = React.useState(false);
  /** Requête pour laquelle la réponse est arrivée (évite d'afficher « aucune suggestion » pendant l'anti-rebond). */
  const [doneFor, setDoneFor] = React.useState("");
  const [submitting, startTransition] = React.useTransition();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Resynchronise le champ si l'URL change (navigation), sans effet.
  const [prevDefault, setPrevDefault] = React.useState(defaultValue);
  if (prevDefault !== defaultValue) {
    setPrevDefault(defaultValue);
    setValue(defaultValue);
  }

  // Suggestions : anti-rebond 180 ms + annulation de la requête précédente.
  React.useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/marketplace/suggest?q=${encodeURIComponent(q.slice(0, 60))}`, { signal: ctrl.signal });
        const data = (await res.json()) as { items?: Suggestion[] };
        setItems(Array.isArray(data.items) ? data.items.slice(0, 8) : []);
        setActive(-1);
        setDoneFor(q);
      } catch {
        if (!ctrl.signal.aborted) setItems([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [value]);

  // Fermeture au clic extérieur.
  React.useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const hasQuery = value.trim().length >= 2;
  const showList = open && hasQuery && (items.length > 0 || (!loading && doneFor === value.trim()));

  function go(href: string) {
    setOpen(false);
    startTransition(() => router.push(href));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (showList && active >= 0 && items[active]) return go(items[active].href);
    const sp = new URLSearchParams();
    const q = value.trim().slice(0, 80);
    if (q) sp.set("q", q);
    for (const [k, v] of Object.entries(hidden ?? {})) if (v) sp.set(k, v);
    const qs = sp.toString();
    go(qs ? `/marketplace/recherche?${qs}` : "/marketplace/recherche");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (value) {
        setValue("");
      }
    }
  }

  const lg = size === "lg";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <form role="search" action="/marketplace/recherche" method="get" onSubmit={submit} className="bezel !rounded-full !p-1.5">
        <div className="flex items-center gap-2 rounded-full bg-surface pl-4 shadow-[var(--shadow-inset),0_1px_2px_rgb(var(--c-shadow)/0.05)] ring-1 ring-line focus-within:ring-2 focus-within:ring-primary">
          <Search className={cn("shrink-0 text-ink-faint", lg ? "size-5" : "size-[18px]")} aria-hidden />
          <label htmlFor={`${id}-q`} className="sr-only">
            Rechercher un produit, une boutique ou une ville
          </label>
          <input
            ref={inputRef}
            id={`${id}-q`}
            name="q"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={80}
            autoFocus={autoFocus}
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint focus:outline-none [&::-webkit-search-cancel-button]:appearance-none",
              lg ? "h-14 text-[17px]" : "h-12 text-base",
            )}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                setItems([]);
                inputRef.current?.focus();
              }}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
              aria-label="Effacer la recherche"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
          <button
            type="submit"
            className={cn(
              "group/s mr-1 inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent font-medium text-on-accent transition-[background-color,transform] duration-300 ease-spring hover:bg-accent-hover active:scale-[0.97]",
              lg ? "h-12 px-3 sm:px-5" : "h-10 px-3 sm:px-4",
            )}
            aria-label="Rechercher"
          >
            {submitting ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : <Search className="size-[18px] sm:hidden" aria-hidden />}
            <span className="hidden sm:inline">Rechercher</span>
          </button>
        </div>
        {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      </form>

      <div
        className={cn(
          "absolute inset-x-0 top-full z-40 mt-2 origin-top overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-lg)] ring-1 ring-line transition-[opacity,transform] duration-200 ease-out-expo",
          showList ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0",
        )}
      >
        <ul id={listId} role="listbox" aria-label="Suggestions" className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
          {items.map((s, i) => {
            const Icon = ICONS[s.type];
            return (
              <li
                key={`${s.type}-${s.href}`}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => go(s.href)}
                onPointerEnter={() => setActive(i)}
                className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2", i === active && "bg-surface-2")}
              >
                <span className="relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-surface-2 text-ink-muted ring-1 ring-line">
                  {s.image ? (
                    <Image src={s.image} alt="" width={40} height={40} sizes="40px" className="size-full object-cover" />
                  ) : (
                    <Icon className="size-[18px]" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{s.label}</span>
                  <span className="block truncate text-[13px] text-ink-muted">
                    {TYPE_LABEL[s.type]}
                    {s.sub ? `, ${s.sub}` : ""}
                  </span>
                </span>
                <ArrowRight className={cn("size-4 shrink-0 text-ink-faint transition-transform duration-300 ease-spring", i === active && "translate-x-0.5 text-ink")} aria-hidden />
              </li>
            );
          })}
          {!loading && items.length === 0 && (
            <li role="presentation" className="px-3 py-4 text-sm text-ink-muted">
              Aucune suggestion. Appuyez sur Entrée pour lancer la recherche.
            </li>
          )}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite">
        {showList && items.length > 0 ? `${items.length} suggestions disponibles` : ""}
      </p>
    </div>
  );
}
