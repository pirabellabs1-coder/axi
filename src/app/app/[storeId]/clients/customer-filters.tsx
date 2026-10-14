"use client";

import { useRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const control =
  "h-11 md:h-9 rounded-full border-0 bg-surface text-sm text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint transition-shadow duration-200 hover:ring-ink-faint/60 focus:outline-none focus:ring-2 focus:ring-primary";

/** Recherche + tri de la liste clients (formulaire GET, fonctionne sans JS ; le tri se soumet au changement). */
export function CustomerFilters({ action, q, segment, sort, showSort }: { action: string; q: string; segment?: string; sort: string; showSort: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} method="get" action={action} role="search" className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-1 lg:justify-end">
      {segment && <input type="hidden" name="segment" value={segment} />}
      <div className="relative min-w-0 flex-1 basis-56 lg:max-w-72">
        <label htmlFor="customer-q" className="sr-only">
          Rechercher un client
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input id="customer-q" name="q" type="search" defaultValue={q} placeholder="Nom, téléphone ou e-mail" className={cn(control, "w-full pl-9 pr-3")} />
      </div>
      {showSort && (
        <div className="relative">
          <label htmlFor="customer-sort" className="sr-only">
            Trier par
          </label>
          <select id="customer-sort" name="tri" defaultValue={sort} onChange={() => formRef.current?.requestSubmit()} className={cn(control, "appearance-none pl-3.5 pr-8")}>
            <option value="recent">Dernier achat</option>
            <option value="depenses">Total dépensé</option>
            <option value="commandes">Nombre de commandes</option>
            <option value="nom">Nom</option>
          </select>
          <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted">
            <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <button type="submit" className="sr-only">
        Rechercher
      </button>
    </form>
  );
}
