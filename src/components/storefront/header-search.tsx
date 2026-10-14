"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Recherche de l'en-tête : champ intégré dès 1024 px, bouton qui déplie une ligne de recherche sinon.
 * Simple formulaire GET vers /recherche (fonctionne sans JS).
 */
export function HeaderSearch({ base, placeholder, compact }: { base: string; placeholder: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const mobileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) mobileInput.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const field = (id: string, ref?: React.Ref<HTMLInputElement>) => (
    <div className="sf-ink-reset relative w-full">
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        ref={ref}
        id={id}
        name="q"
        type="search"
        enterKeyHint="search"
        placeholder={`${placeholder}…`}
        maxLength={80}
        className="h-11 w-full rounded-full border-0 bg-surface-2 pl-10 pr-4 text-[15px] text-ink ring-1 ring-inset ring-transparent transition-[box-shadow,background-color] duration-200 placeholder:text-ink-faint hover:ring-line-strong focus:bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]"
      />
    </div>
  );

  return (
    <>
      {!compact && (
        <form action={`${base}/recherche`} method="get" role="search" className="hidden w-full max-w-[280px] xl:block">
          {field("store-search")}
        </form>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="store-search-panel" aria-label={open ? "Fermer la recherche" : "Rechercher"} className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-2 ${compact ? "" : "xl:hidden"}`}>
        {open ? <X className="size-5" aria-hidden /> : <Search className="size-5" aria-hidden />}
      </button>
      <div id="store-search-panel" hidden={!open} className="absolute inset-x-0 top-full border-b border-line bg-surface px-4 pb-4 pt-2 shadow-[var(--shadow-md)]">
        <form action={`${base}/recherche`} method="get" role="search" className="sf-pop mx-auto max-w-2xl">
          {field("store-search-m", mobileInput)}
        </form>
      </div>
    </>
  );
}
