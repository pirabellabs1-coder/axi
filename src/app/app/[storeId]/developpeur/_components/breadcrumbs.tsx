"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useDevBase } from "./dev-link";

/** Fil d'Ariane du portail (pages profondes). Le dernier élément est la page courante. */
export function Breadcrumbs({ items }: { items: { href?: string; to?: string; label: string }[] }) {
  const dev = useDevBase();
  return (
    <nav aria-label="Fil d'Ariane" className="mb-3 min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
        {items.map((raw, i) => {
          const it = { ...raw, href: raw.to !== undefined ? dev + raw.to : raw.href };
          const last = i === items.length - 1;
          return (
            <li key={`${it.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {it.href && !last ? (
                <Link href={it.href} className="inline-flex min-h-8 items-center rounded px-0.5 hover:text-ink hover:underline">
                  {it.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="truncate font-medium text-ink">
                  {it.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5 shrink-0 text-ink-faint" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
