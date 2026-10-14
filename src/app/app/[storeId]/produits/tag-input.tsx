"use client";

import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Saisie d'étiquettes (combobox accessible) : Entrée ou virgule pour ajouter, Retour arrière pour retirer la dernière,
 * suggestions filtrées parmi les étiquettes existantes de la boutique.
 */
export function TagInput({
  id,
  label,
  value,
  onChange,
  suggestions,
  placeholder = "Ajouter une étiquette",
  max = 50,
  hint,
}: {
  id: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  max?: number;
  hint?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const hintId = useId();

  const matches = useMemo(() => {
    const q = text.trim().toLocaleLowerCase("fr");
    const taken = new Set(value.map((v) => v.toLocaleLowerCase("fr")));
    return suggestions.filter((s) => !taken.has(s.toLocaleLowerCase("fr")) && (!q || s.toLocaleLowerCase("fr").includes(q))).slice(0, 8);
  }, [text, suggestions, value]);

  const add = (raw: string) => {
    const parts = raw.split(",").map((t) => t.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (next.length < max && !next.some((v) => v.toLocaleLowerCase("fr") === p.toLocaleLowerCase("fr"))) next.push(p);
    onChange(next);
    setText("");
    setActive(-1);
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] bg-surface px-2 py-1.5 ring-1 ring-inset ring-line-strong focus-within:ring-2 focus-within:ring-primary">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2.5 pr-0.5 text-[13px] font-medium text-ink ring-1 ring-inset ring-line">
              {t}
              <button type="button" onClick={() => onChange(value.filter((v) => v !== t))} className="inline-flex size-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface hover:text-ink" aria-label={`Retirer l'étiquette ${t}`}>
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <input
            id={id}
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            aria-describedby={hint ? hintId : undefined}
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(",")) add(v);
              else setText(v);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setTimeout(() => setOpen(false), 120);
              if (text.trim()) add(text);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(active >= 0 && matches[active] ? matches[active] : text);
              } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(matches.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(-1, a - 1));
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder={value.length ? "" : placeholder}
            className="h-9 min-w-24 flex-1 border-0 bg-transparent px-1.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
            disabled={value.length >= max}
          />
        </div>
        {open && matches.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Suggestions" className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-[var(--radius-md)] bg-surface py-1 shadow-[var(--shadow-lg)] ring-1 ring-line">
            {matches.map((m, i) => (
              <li
                key={m}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(m);
                }}
                className={cn("flex min-h-11 cursor-pointer items-center px-3 text-sm text-ink sm:min-h-9", i === active ? "bg-primary-soft" : "hover:bg-surface-2")}
              >
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-[13px] text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
