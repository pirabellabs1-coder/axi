"use client";

import { CopyButton } from "@/components/app/action-controls";
import { cn } from "@/lib/utils";

/** Bloc de code monospace avec bouton Copier (commande, extrait JSON, URL). */
export function CodeBlock({ code, label, className, copyLabel = "Copier" }: { code: string; label?: string; className?: string; copyLabel?: string }) {
  return (
    <figure className={cn("min-w-0", className)}>
      {label && <figcaption className="mb-1.5 text-xs font-medium text-ink-muted">{label}</figcaption>}
      <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-2 ring-1 ring-inset ring-line">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1.5 py-1.5 font-mono text-[12.5px] leading-relaxed text-ink [scrollbar-width:thin]">
          <code>{code}</code>
        </pre>
        <CopyButton value={code} label={copyLabel} className="h-9" />
      </div>
    </figure>
  );
}
