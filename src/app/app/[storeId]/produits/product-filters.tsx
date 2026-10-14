"use client";

import { useRef } from "react";
import { Search, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const control =
  "h-11 md:h-9 rounded-full border-0 bg-surface text-sm text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint transition-shadow duration-200 hover:ring-ink-faint/60 focus:outline-none focus:ring-2 focus:ring-primary";

type Opt = { value: string; label: string };

function FilterSelect({ id, name, label, value, options, all, onChange }: { id: string; name: string; label: string; value?: string; options: Opt[]; all: string; onChange: () => void }) {
  if (options.length === 0) return null;
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} onChange={onChange} className={cn(control, "max-w-44 appearance-none pl-3.5 pr-8", value && "ring-primary/60 font-medium")}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted">
        <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * Filtres de la liste produits (formulaire GET : URL partageable, fonctionne sans JS).
 * Les listes se soumettent au changement ; la recherche à la validation.
 */
export function ProductFilters({
  action,
  values,
  collections,
  types,
  vendors,
  tags,
  stockTracking,
}: {
  action: string;
  values: { q: string; status?: string; collection?: string; type?: string; vendor?: string; tag?: string; lowStock: boolean; sort?: string };
  collections: { id: string; name: string }[];
  types: string[];
  vendors: string[];
  tags: string[];
  stockTracking: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form ref={formRef} method="get" action={action} role="search" className="flex w-full flex-wrap items-center gap-2">
      {values.status && <input type="hidden" name="status" value={values.status} />}
      <div className="relative min-w-0 flex-1 basis-56">
        <label htmlFor="product-q" className="sr-only">
          Rechercher un produit
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input id="product-q" name="q" type="search" defaultValue={values.q} placeholder="Titre, SKU, étiquette" className={cn(control, "w-full pl-9 pr-3")} />
      </div>
      <FilterSelect id="f-col" name="collection" label="Collection" value={values.collection} all="Toutes collections" options={[{ value: "none", label: "Sans collection" }, ...collections.map((c) => ({ value: c.id, label: c.name }))]} onChange={submit} />
      <FilterSelect id="f-type" name="type" label="Type de produit" value={values.type} all="Tous types" options={types.map((t) => ({ value: t, label: t }))} onChange={submit} />
      <FilterSelect id="f-vendor" name="vendor" label="Marque" value={values.vendor} all="Toutes marques" options={vendors.map((t) => ({ value: t, label: t }))} onChange={submit} />
      <FilterSelect id="f-tag" name="tag" label="Étiquette" value={values.tag} all="Toutes étiquettes" options={tags.map((t) => ({ value: t, label: t }))} onChange={submit} />
      {stockTracking && (
        <label
          className={cn(
            "inline-flex h-11 cursor-pointer select-none items-center gap-2 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary md:h-9",
            values.lowStock ? "bg-warning-soft text-warning ring-warning/30" : "bg-surface text-ink-muted ring-line-strong hover:text-ink",
          )}
        >
          <input type="checkbox" name="stock" value="bas" defaultChecked={values.lowStock} onChange={submit} className="sr-only" />
          <AlertTriangle className="size-3.5" aria-hidden />
          Stock bas
        </label>
      )}
      <FilterSelect
        id="f-sort"
        name="sort"
        label="Trier"
        value={values.sort}
        all="Modifiés récemment"
        options={[
          { value: "created", label: "Créés récemment" },
          { value: "name", label: "Titre A à Z" },
          { value: "price_asc", label: "Prix croissant" },
          { value: "price_desc", label: "Prix décroissant" },
        ]}
        onChange={submit}
      />
      <button type="submit" className="sr-only">
        Filtrer
      </button>
    </form>
  );
}
