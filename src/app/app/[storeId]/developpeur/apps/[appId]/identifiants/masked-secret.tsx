"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { CopyButton } from "@/components/app/action-controls";

/** Secret affiché masqué ; « Afficher » le révèle, « Copier » fonctionne dans les deux états. */
export function MaskedSecret({ value, label }: { value: string; label: string }) {
  const [shown, setShown] = useState(false);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-xs font-medium text-ink-muted">{label}</figcaption>
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 p-2 ring-1 ring-inset ring-line">
        <code className="min-w-0 flex-1 px-1.5 py-1.5 font-mono text-[12.5px] text-ink [overflow-wrap:anywhere]">
          {shown ? value : `${value.slice(0, 6)}${"•".repeat(24)}`}
        </code>
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          {shown ? "Masquer" : "Afficher"}
        </button>
        <CopyButton value={value} label="Copier" />
      </div>
    </figure>
  );
}
