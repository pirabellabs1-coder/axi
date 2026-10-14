"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type TabItem = { href: string; label: string; count?: number; exact?: boolean };

/** Onglets de navigation (liens) : l'état actif dérive de l'URL. */
export function LinkTabs({ items, className, param }: { items: TabItem[]; className?: string; param?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const isActive = (t: TabItem) => {
    if (param) {
      const url = new URL(t.href, "http://x");
      return (sp.get(param) ?? "") === (url.searchParams.get(param) ?? "");
    }
    return t.exact ? pathname === t.href : pathname.startsWith(t.href);
  };
  return (
    <nav className={cn("scrollbar-none -mx-1 flex gap-1 overflow-x-auto border-b border-line", className)} aria-label="Sous-navigation">
      {items.map((t) => {
        const active = isActive(t);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "relative inline-flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors duration-150",
              active ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className={cn("tabular rounded-full px-1.5 text-xs", active ? "bg-primary-soft text-primary-deep" : "bg-surface-2 text-ink-muted")}>{t.count}</span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Onglets à état local (motif WAI-ARIA « tabs », activation automatique, flèches gauche/droite, Origine/Fin).
 * <Tabs items={[{ id: "a", label: "Détails", content: <…/> }]} />
 */
export function Tabs({
  items,
  defaultValue,
  value: controlled,
  onChange,
  label = "Onglets",
  className,
  panelClassName,
}: {
  items: { id: string; label: React.ReactNode; count?: number; content: React.ReactNode }[];
  defaultValue?: string;
  value?: string;
  onChange?: (id: string) => void;
  label?: string;
  className?: string;
  panelClassName?: string;
}) {
  const [inner, setInner] = React.useState(defaultValue ?? items[0]?.id);
  const value = controlled ?? inner;
  const base = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const select = (id: string) => {
    setInner(id);
    onChange?.(id);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(items[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto border-b border-line">
        {items.map((t, i) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative inline-flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors duration-150",
                active ? "text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span className={cn("tabular rounded-full px-1.5 text-xs", active ? "bg-primary-soft text-primary-deep" : "bg-surface-2 text-ink-muted")}>{t.count}</span>
              )}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== value}
          tabIndex={0}
          className={cn("pt-5 focus-visible:outline-none", panelClassName)}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
