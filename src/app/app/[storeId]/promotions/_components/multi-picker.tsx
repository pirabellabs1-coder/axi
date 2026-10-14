"use client";

import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input, Label, Hint, FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type PickOption = { id: string; label: string; hint?: string };

/**
 * Sélection multiple avec recherche (produits, collections). Les valeurs choisies sont envoyées sous `name[]`
 * (inputs cachés) ; `onChange` permet un usage contrôlé (aperçu du résumé en direct).
 */
export function MultiPicker({
  name,
  label,
  options,
  value,
  onChange,
  hint,
  error,
  max = 50,
  emptyText = "Aucun élément",
}: {
  name?: string;
  label: string;
  options: PickOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  hint?: string;
  error?: string;
  max?: number;
  emptyText?: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const filtered = useMemo(() => {
    const n = q.trim().toLocaleLowerCase("fr");
    const list = n ? options.filter((o) => o.label.toLocaleLowerCase("fr").includes(n)) : options;
    return list.slice(0, 60);
  }, [q, options]);
  const toggle = (oid: string) => onChange(value.includes(oid) ? value.filter((x) => x !== oid) : value.length >= max ? value : [...value, oid]);

  return (
    <div>
      <Label htmlFor={`${id}-q`}>{label}</Label>
      {name && value.map((v) => <input key={v} type="hidden" name={`${name}[]`} value={v} />)}
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={`${label} : sélection`}>
          {value.map((v) => (
            <li key={v}>
              <button
                type="button"
                onClick={() => toggle(v)}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-primary-soft px-3 text-sm text-primary-deep hover:bg-primary-soft/70 focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label={`Retirer ${byId.get(v)?.label ?? "élément retiré"}`}
              >
                {byId.get(v)?.label ?? "Élément retiré"}
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-9" autoComplete="off" invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} />
      </div>
      <ul className="mt-2 max-h-48 overflow-y-auto rounded-[var(--radius-md)] border border-line" role="group" aria-label={label}>
        {filtered.length === 0 ? (
          <li className="px-3 py-3 text-sm text-ink-muted">{emptyText}</li>
        ) : (
          filtered.map((o) => {
            const checked = value.includes(o.id);
            return (
              <li key={o.id} className="border-b border-line last:border-b-0">
                <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2", checked && "bg-surface-2")}>
                  <input type="checkbox" className="size-5 shrink-0 accent-[var(--c-primary)]" checked={checked} onChange={() => toggle(o.id)} />
                  <span className="min-w-0 flex-1 truncate text-ink">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs text-ink-muted">{o.hint}</span>}
                </label>
              </li>
            );
          })
        )}
      </ul>
      {error ? <FieldError id={`${id}-err`}>{error}</FieldError> : hint ? <Hint id={`${id}-hint`}>{hint}</Hint> : null}
    </div>
  );
}
