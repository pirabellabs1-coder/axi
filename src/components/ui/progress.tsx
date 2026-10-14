import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Barre de progression (rôle progressbar). `max = null` = illimité (barre neutre).
 * Teinte automatique : primaire < 80 %, avertissement ≥ 80 %, danger ≥ 100 % (`tone="auto"`).
 */
export function Progress({
  value,
  max = 100,
  label,
  showValue = false,
  valueLabel,
  tone = "auto",
  size = "md",
  className,
}: {
  value: number;
  max?: number | null;
  label?: React.ReactNode;
  showValue?: boolean;
  valueLabel?: React.ReactNode;
  tone?: "auto" | "primary" | "accent" | "warning" | "danger";
  size?: "sm" | "md";
  className?: string;
}) {
  const unlimited = max == null;
  const pct = unlimited ? 0 : max === 0 ? 100 : Math.min(100, Math.max(0, (value / max) * 100));
  const resolved = tone === "auto" ? (pct >= 100 ? "danger" : pct >= 80 ? "warning" : "primary") : tone;
  const fill = { primary: "bg-primary", accent: "bg-accent", warning: "bg-sun", danger: "bg-danger" }[resolved];
  const id = React.useId();

  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          {label && <span id={id} className="font-medium text-ink-muted">{label}</span>}
          {showValue && (
            <span className="tabular text-ink">
              {valueLabel ?? (unlimited ? `${value.toLocaleString("fr-FR")} / illimité` : `${value.toLocaleString("fr-FR")} / ${max.toLocaleString("fr-FR")}`)}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-labelledby={label ? id : undefined}
        aria-valuemin={0}
        aria-valuemax={unlimited ? undefined : max}
        aria-valuenow={unlimited ? undefined : value}
        aria-valuetext={unlimited ? `${value}, illimité` : undefined}
        className={cn("relative w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div
          className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-700 ease-out-expo", unlimited ? "bg-line-strong" : fill)}
          style={{ transform: `scaleX(${unlimited ? 0.08 : pct / 100})` }}
        />
      </div>
    </div>
  );
}

/** Indicateur d'étapes (assistant) : « Étape 2 sur 6 » + segments. */
export function StepProgress({ current, total, label, className }: { current: number; total: number; label?: string; className?: string }) {
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-ink-muted">
        <span>{label ?? `Étape ${current} sur ${total}`}</span>
        <span className="tabular">{Math.round((current / total) * 100)} %</span>
      </div>
      <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} aria-label={`Étape ${current} sur ${total}`}>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
            <span
              className="absolute inset-0 origin-left rounded-full bg-primary transition-transform duration-500 ease-out-expo"
              style={{ transform: `scaleX(${i < current ? 1 : 0})` }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
