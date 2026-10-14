import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { thumbUrl } from "@/lib/image-loader";

export function Money({ amount, currency = "XOF", className }: { amount: number; currency?: string; className?: string }) {
  return <span className={cn("tabular", className)}>{formatMoney(amount, currency)}</span>;
}

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.38) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbUrl(src)} alt="" style={style} className={cn("shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      style={style}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-display font-bold text-primary-deep", className)}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Version sans coque, plus basse (dans une carte ou un tableau). */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-6 py-10" : "rounded-[var(--radius-lg)] bg-surface px-6 py-14 ring-1 ring-line",
        className,
      )}
    >
      {Icon && (
        <span className={cn("inline-flex items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10", compact ? "mb-4 size-11" : "mb-5 size-14")}>
          <Icon className={compact ? "size-5" : "size-6"} aria-hidden />
        </span>
      )}
      <h3 className={cn("font-display font-semibold text-ink", compact ? "text-[15px]" : "text-lg")}>{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("animate-pulse-soft rounded-[var(--radius-sm)] bg-surface-2", className)} style={style} aria-hidden />;
}

/** Lignes de texte fantômes (dernière ligne plus courte). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

/** Squelette de tableau : en-tête + n lignes, à la forme finale d'une liste dense. */
export function SkeletonTable({ rows = 8, cols = 5, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line", className)} aria-hidden>
      <div className="flex h-10 items-center gap-6 border-b border-line bg-surface-2/50 px-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-12 items-center gap-6 border-b border-line px-4 last:border-0">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 flex-1" style={{ maxWidth: i === 0 ? 180 : 120 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, trend, icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; trend?: { value: number; label?: string }; icon?: LucideIcon }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        {Icon && <Icon className="size-4 text-ink-faint" aria-hidden />}
      </div>
      <p className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink tabular">{value}</p>
      {(hint || trend) && (
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          {trend && (
            <span className={cn("font-semibold", trend.value >= 0 ? "text-primary" : "text-danger")}>
              {trend.value >= 0 ? "+" : ""}
              {trend.value}%
            </span>
          )}
          {hint ?? trend?.label}
        </p>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="-ml-1 mb-2 inline-flex min-h-8 items-center gap-1.5 rounded-full px-1 text-sm text-ink-muted transition-colors hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {back.label}
          </Link>
        )}
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children?: React.ReactNode; className?: string }) {
  const map = {
    info: "border-info/25 bg-info-soft text-info",
    warning: "border-warning/30 bg-warning-soft text-warning",
    danger: "border-danger/30 bg-danger-soft text-danger",
    success: "border-primary/30 bg-primary-soft text-primary-deep",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-md)] border px-4 py-3 text-sm", map[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1")}>{children}</div>}
    </div>
  );
}

export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) return <hr className={cn("border-line", className)} />;
  return (
    <div className={cn("flex items-center gap-3 text-xs uppercase tracking-wider text-ink-faint", className)}>
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">{children}</kbd>;
}

/** Variation en % vs période précédente. `null` = pas de base de comparaison. `inverse` : une baisse est positive. */
export function Delta({ value, inverse = false, className, suffix = "vs période préc." }: { value: number | null; inverse?: boolean; className?: string; suffix?: string | null }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={cn("text-xs text-ink-faint", className)}>Pas de base de comparaison</span>;
  }
  const up = value >= 0;
  const good = inverse ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const abs = Math.abs(value);
  const rounded = abs >= 10 ? Math.round(abs) : Math.round(abs * 10) / 10;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-ink-muted", className)}>
      <span
        className={cn(
          "tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-semibold",
          value === 0 ? "bg-surface-2 text-ink-muted" : good ? "bg-primary-soft text-primary-deep" : "bg-danger-soft text-danger",
        )}
      >
        <Icon className="size-3" aria-hidden />
        <span className="sr-only">{up ? "Hausse de" : "Baisse de"}</span>
        {up ? "+" : "-"}
        {rounded.toLocaleString("fr-FR")} %
      </span>
      {suffix}
    </span>
  );
}

/** KPI « double-bezel légère » : libellé, valeur tabulaire, variation. Pour les tableaux de bord. */
export function Kpi({
  label,
  value,
  delta,
  inverse,
  hint,
  icon: Icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  inverse?: boolean;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  className?: string;
}) {
  const body = (
    <div className="bezel-core h-full !rounded-[18px] px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        {Icon && <Icon className="size-4 text-ink-faint" aria-hidden />}
      </div>
      <p className="tabular mt-2.5 truncate text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink 2xl:text-[26px]">{value}</p>
      <div className="mt-2.5 min-h-5">
        {delta !== undefined ? <Delta value={delta} inverse={inverse} /> : hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      </div>
    </div>
  );
  const shell = cn("bezel block !rounded-[22px] !p-[4px]", className);
  if (href) {
    return (
      <Link href={href} className={cn(shell, "transition-transform duration-150 ease-out active:scale-[0.99]")}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/** Point d'état + libellé (jamais la couleur seule). */
export function StatusDot({ tone = "neutral", children, pulse = false }: { tone?: "neutral" | "success" | "warning" | "danger" | "info"; children: React.ReactNode; pulse?: boolean }) {
  const c = { neutral: "bg-ink-faint", success: "bg-primary", warning: "bg-sun", danger: "bg-danger", info: "bg-info" }[tone];
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <span className="relative inline-flex size-2" aria-hidden>
        {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden", c)} />}
        <span className={cn("relative size-2 rounded-full", c)} />
      </span>
      {children}
    </span>
  );
}

/** Liste clé / valeur (détails d'une commande, d'un client). */
export function KeyValue({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line text-sm", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2.5">
          <dt className="shrink-0 text-ink-muted">{it.label}</dt>
          <dd className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
