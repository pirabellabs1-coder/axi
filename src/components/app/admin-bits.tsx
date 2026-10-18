import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { barWidth } from "@/lib/admin/metrics";

/** Petits composants partagés par les écrans d'administration (Server Components). */

export const PAGE_SIZE = 25;

export function pageParam(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function str(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function Pagination({ page, total, pageSize = PAGE_SIZE, basePath, params = {}, pageKey = "page" }: { page: number; total: number; pageSize?: number; basePath: string; params?: Record<string, string>; pageKey?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    sp.set(pageKey, String(p));
    return `${basePath}?${sp.toString()}`;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-muted" aria-label="Pagination">
      <p>
        {from} à {to} sur {total}
      </p>
      <div className="flex items-center gap-1">
        <PageLink href={href(page - 1)} disabled={page <= 1} label="Page précédente">
          <ChevronLeft className="size-4" aria-hidden />
        </PageLink>
        <span className="px-2 tabular">
          {page} / {pages}
        </span>
        <PageLink href={href(page + 1)} disabled={page >= pages} label="Page suivante">
          <ChevronRight className="size-4" aria-hidden />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = "inline-flex size-11 items-center justify-center rounded-[var(--radius-md)] border border-line bg-surface text-ink hover:bg-surface-2";
  if (disabled) {
    return (
      <span className={cn(cls, "opacity-40")} aria-disabled="true" aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cls} aria-label={label}>
      {children}
    </Link>
  );
}

export const STORE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  PUBLISHED: { label: "Publiée", tone: "success" },
  CLOSED_TEMPORARILY: { label: "Fermée", tone: "warning" },
  SUSPENDED: { label: "Suspendue", tone: "danger" },
  ARCHIVED: { label: "Archivée", tone: "neutral" },
  PAUSED: { label: "En pause (abonnement)", tone: "warning" },
};

export const SUB_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  TRIALING: { label: "Essai", tone: "sun" },
  ACTIVE: { label: "Actif", tone: "success" },
  PAST_DUE: { label: "Impayé", tone: "warning" },
  SUSPENDED: { label: "Suspendu", tone: "danger" },
  CANCELLED: { label: "Annulé", tone: "neutral" },
  PAUSED: { label: "En pause", tone: "warning" },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  OPEN: { label: "À payer", tone: "sun" },
  PAID: { label: "Payée", tone: "success" },
  VOID: { label: "Annulée", tone: "neutral" },
  UNCOLLECTIBLE: { label: "Irrécouvrable", tone: "danger" },
};

export const JOB_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "En attente", tone: "neutral" },
  RUNNING: { label: "En cours", tone: "info" },
  DONE: { label: "Terminée", tone: "success" },
  FAILED: { label: "Échec", tone: "warning" },
  DEAD: { label: "Abandonnée", tone: "danger" },
};

export const NOTIF_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: "En file", tone: "neutral" },
  SENT: { label: "Envoyée", tone: "success" },
  FAILED: { label: "Échec", tone: "danger" },
  SKIPPED: { label: "Ignorée", tone: "warning" },
};

export const ATTEMPT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  CREATED: { label: "Créée", tone: "neutral" },
  PENDING: { label: "En attente", tone: "sun" },
  INITIATED: { label: "Initiée", tone: "info" },
  CONFIRMED: { label: "Confirmée", tone: "success" },
  FAILED: { label: "Échec", tone: "danger" },
  EXPIRED: { label: "Expirée", tone: "neutral" },
};

export const TICKET_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Ouvert", tone: "accent" },
  PENDING: { label: "En attente", tone: "sun" },
  RESOLVED: { label: "Résolu", tone: "success" },
  CLOSED: { label: "Fermé", tone: "neutral" },
};

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: BadgeTone }>; value: string }) {
  const s = map[value] ?? { label: value, tone: "neutral" as BadgeTone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Métadonnées JSON repliées (journal d'audit, payloads de jobs). */
export function JsonDetails({ value, summary = "Détails" }: { value: unknown; summary?: string }) {
  if (value == null) return <span className="text-ink-faint">-</span>;
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">{summary}</summary>
      <pre className="mt-1 max-h-64 max-w-[420px] overflow-auto rounded-[var(--radius-sm)] bg-surface-2 p-2 font-mono text-[11px] leading-snug text-ink">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function DL({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{it.label}</dt>
          <dd className="mt-0.5 break-words text-ink">{it.value ?? <span className="text-ink-faint">-</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Titre de section des écrans d'administration (h2 + action à droite). */
export function SectionTitle({ id, title, description, action }: { id: string; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export type BarItem = { key: string; label: React.ReactNode; value: number; display: React.ReactNode; hint?: React.ReactNode; href?: string };

/**
 * Barres horizontales fines (classement, répartition). Chaque ligne porte sa valeur en texte :
 * la couleur n'est jamais la seule information. Largeur via transform (aucune mise en page animée).
 */
export function BarList({ items, label, empty = "Aucune donnée pour le moment." }: { items: BarItem[]; label: string; empty?: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0 || max === 0) return <p className="px-5 py-6 text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-3 px-5 pb-5 pt-3 sm:px-6" aria-label={label}>
      {items.map((i) => {
        const w = barWidth(i.value, max);
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">{i.label}</span>
              <span className="tabular shrink-0 font-medium text-ink">{i.display}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-spring motion-reduce:transition-none" style={{ transform: `scaleX(${w / 100})` }} />
            </div>
            {i.hint && <p className="mt-1 text-xs text-ink-muted">{i.hint}</p>}
          </>
        );
        return (
          <li key={i.key}>
            {i.href ? (
              <Link href={i.href} className="-mx-2 block rounded-[10px] px-2 py-1 transition-colors hover:bg-surface-2/60">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Libellés des types de crédits pour l'admin (courts). */
export const CREDIT_SHORT: Record<string, string> = { WA_UTILITY: "WhatsApp utilitaire", WA_MARKETING: "WhatsApp marketing", AI: "IA" };

export const ADDON_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "En attente de paiement", tone: "sun" },
  ACTIVE: { label: "Active", tone: "success" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
  EXPIRED: { label: "Expirée", tone: "neutral" },
};

export const ZONE_SHORT: Record<string, string> = { WORLD: "Monde (EUR)", AFRICA: "Afrique (FCFA)" };
