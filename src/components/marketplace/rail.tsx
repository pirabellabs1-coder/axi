"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Carrousel horizontal (scroll-snap natif). Les flèches n'apparaissent qu'à partir de md
 * et uniquement si le contenu déborde ; au doigt, le défilement natif suffit.
 */
export function Rail({ label, children, className, itemClassName }: { label: string; children: React.ReactNode[]; className?: string; itemClassName?: string }) {
  const ref = React.useRef<HTMLUListElement>(null);
  const [edges, setEdges] = React.useState({ start: true, end: true });

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  function scrollBy(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className={cn("relative", className)}>
      <ul
        ref={ref}
        aria-label={label}
        className="relative scrollbar-none -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 pt-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8"
      >
        {children.map((child, i) => (
          <li key={i} className={cn("shrink-0 snap-start", itemClassName)}>
            {child}
          </li>
        ))}
      </ul>
      {!(edges.start && edges.end) && (
        <div className="pointer-events-none absolute -top-[76px] right-0 hidden gap-2 md:flex">
          <RailButton onClick={() => scrollBy(-1)} disabled={edges.start} label="Précédent">
            <ChevronLeft className="size-5" aria-hidden />
          </RailButton>
          <RailButton onClick={() => scrollBy(1)} disabled={edges.end} label="Suivant">
            <ChevronRight className="size-5" aria-hidden />
          </RailButton>
        </div>
      )}
    </div>
  );
}

function RailButton({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink ring-1 ring-line shadow-[var(--shadow-card)] transition-[transform,opacity] duration-300 ease-spring hover:-translate-y-px active:scale-95 disabled:opacity-35"
    >
      {children}
    </button>
  );
}
