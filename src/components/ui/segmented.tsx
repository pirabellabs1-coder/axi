"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string = string> = { value: T; label: React.ReactNode; href?: string; count?: number };

/**
 * Contrôle segmenté (pilule). Deux modes :
 *  - liens (`href` sur chaque option) : navigation, état actif fourni par `value` (Server Component friendly via wrapper client)
 *  - boutons (`onChange`) : radiogroup, flèches gauche/droite.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  fill = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange?: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  /** Occupe toute la largeur : options de largeur égale, libellés qui passent à la ligne au lieu de déborder. */
  fill?: boolean;
  className?: string;
}) {
  const refs = React.useRef<(HTMLElement | null)[]>([]);
  const isLinks = options.every((o) => o.href);
  const h = fill
    ? cn("min-w-0 flex-1 basis-0 justify-center whitespace-normal text-center leading-tight", size === "sm" ? "min-h-8 px-2 py-1 text-[13px]" : "min-h-9 px-2.5 py-1.5 text-sm")
    : cn("shrink-0 whitespace-nowrap", size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-sm");

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (isLinks || !onChange) return;
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role={isLinks ? undefined : "radiogroup"}
      aria-label={label}
      className={cn(
        "scrollbar-none max-w-full items-stretch gap-0.5 rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line",
        fill ? "flex w-full rounded-[14px] [&>*]:rounded-[10px]" : "inline-flex overflow-x-auto",
        className,
      )}
    >
      {isLinks && <span className="sr-only">{label}</span>}
      {options.map((o, i) => {
        const active = o.value === value;
        const cls = cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium transition-[background-color,color,box-shadow] duration-200 ease-out",
          h,
          active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(var(--c-shadow)/0.1),0_0_0_1px_var(--c-line)]" : "text-ink-muted hover:text-ink",
        );
        const inner = (
          <>
            {o.label}
            {typeof o.count === "number" && (
              <span className={cn("tabular rounded-full px-1.5 text-[11px] leading-4", active ? "bg-primary-soft text-primary-deep" : "bg-surface text-ink-faint")}>{o.count}</span>
            )}
          </>
        );
        if (o.href) {
          return (
            <Link key={o.value} href={o.href} aria-current={active ? "page" : undefined} className={cls} scroll={false}>
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cls}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
