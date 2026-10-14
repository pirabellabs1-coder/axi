"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

/** Clé de jour locale AAAA-MM-JJ (pour les <input type="date"> et la borne « aujourd'hui »). */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Filtre de plage de dates personnalisée (calendrier). Navigue vers `${base}?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ`,
 * lu côté serveur par le tableau de bord. Pastille `<details>` cohérente avec le contrôle segmenté « Période ».
 */
export function DateRangeFilter({ base, start, end }: { base: string; start?: string; end?: string }) {
  const router = useRouter();
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [from, setFrom] = React.useState(start ?? "");
  const [to, setTo] = React.useState(end ?? "");
  const max = todayKey();
  const active = Boolean(start && end);
  const valid = Boolean(from && to && from <= to);

  // Fermer au clic extérieur et à Échap.
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.removeAttribute("open");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ref.current?.removeAttribute("open");
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function apply() {
    if (!valid) return;
    ref.current?.removeAttribute("open");
    router.push(`${base}?debut=${from}&fin=${to}`, { scroll: false });
  }
  function reset() {
    ref.current?.removeAttribute("open");
    setFrom("");
    setTo("");
    router.push(base, { scroll: false });
  }

  return (
    <details ref={ref} className="relative">
      <summary
        className={cn(
          "inline-flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ring-1 ring-inset transition-colors [&::-webkit-details-marker]:hidden",
          active
            ? "bg-surface text-ink ring-line shadow-[0_1px_2px_rgb(var(--c-shadow)/0.1)]"
            : "bg-surface-2 text-ink-muted ring-line hover:text-ink",
        )}
        aria-label="Plage de dates personnalisée"
      >
        <CalendarRange className="size-4" aria-hidden />
        {active ? `${start} → ${end}` : "Calendrier"}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-[0_10px_30px_rgb(var(--c-shadow)/0.18)]">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-ink-muted">
            Du
            <input
              type="date"
              value={from}
              max={to || max}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-10 w-full rounded-[10px] border border-line bg-surface px-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Au
            <input
              type="date"
              value={to}
              min={from || undefined}
              max={max}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-10 w-full rounded-[10px] border border-line bg-surface px-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
        </div>
        {from && to && from > to && <p className="mt-2 text-xs text-danger">La date de début doit précéder la date de fin.</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={reset} className="inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium text-ink-muted hover:text-ink">
            Réinitialiser
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!valid}
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary transition-opacity disabled:opacity-40"
          >
            Appliquer
          </button>
        </div>
      </div>
    </details>
  );
}
