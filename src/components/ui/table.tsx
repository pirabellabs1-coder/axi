import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tableau dense façon Linear / Stripe : en-têtes discrets, lignes 48 px, chiffres tabulaires.
 * `bare` : sans coque (à placer dans une Card qui porte déjà la toolbar).
 * Mobile : défilement horizontal ; prévoir une vue cartes (`md:hidden`) pour les listes longues.
 */
export function Table({ className, children, bare = false, minWidth = 640 }: { className?: string; children: React.ReactNode; bare?: boolean; minWidth?: number }) {
  return (
    <div className={cn("relative overflow-x-auto", !bare && "rounded-[var(--radius-lg)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]", className)}>
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children, sticky = false }: { children: React.ReactNode; sticky?: boolean }) {
  return (
    <thead className={cn("border-b border-line bg-surface-2/50 text-left text-xs font-medium text-ink-muted", sticky && "sticky top-0 z-10")}>{children}</thead>
  );
}

/**
 * Colonne d'actions collée au bord droit : reste visible quand le tableau défile horizontalement
 * (écrans étroits, 1280 px avec la barre latérale ouverte). Fond opaque + ombre de séparation.
 */
const STICKY_END =
  "sticky right-0 z-[1] bg-surface shadow-[-10px_0_12px_-12px_rgb(var(--c-shadow)/0.35)] group-hover/row:bg-[color-mix(in_srgb,var(--c-surface-2)_60%,var(--c-surface))]";

export function TH({ className, children, align = "left", sticky = false }: { className?: string; children?: React.ReactNode; align?: "left" | "right" | "center"; sticky?: boolean }) {
  return (
    <th
      scope="col"
      className={cn("h-10 whitespace-nowrap px-4 text-[12px] font-medium tracking-[0.01em]", align === "right" && "text-right", align === "center" && "text-center", sticky && cn(STICKY_END, "bg-[color-mix(in_srgb,var(--c-surface-2)_50%,var(--c-surface))]"), className)}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({ className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("group/row transition-colors duration-150 hover:bg-surface-2/60", className)} {...props}>
      {children}
    </tr>
  );
}

export function TD({ className, children, align = "left", sticky = false }: { className?: string; children?: React.ReactNode; align?: "left" | "right" | "center"; sticky?: boolean }) {
  return (
    <td className={cn("h-12 px-4 py-2.5 align-middle text-ink", align === "right" && "text-right tabular", align === "center" && "text-center", sticky && STICKY_END, className)}>
      {children}
    </td>
  );
}

/**
 * Lien « ligne entière cliquable » : à placer dans la 1re cellule. Étend sa zone de clic à toute la ligne
 * (pseudo-élément) tout en gardant un vrai lien pour le clavier et les lecteurs d'écran.
 * Le <TR> doit avoir la classe `relative` (fournie par `rowLink`).
 */
export function RowLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("font-medium text-ink outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[var(--radius-sm)] focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset", className)}>
      {children}
    </Link>
  );
}
export const rowLink = "relative [&_button]:relative [&_button]:z-[1] [&_a:not(:first-child)]:relative [&_a:not(:first-child)]:z-[1]";

/** Barre d'outils au-dessus d'un tableau (recherche, filtres, actions groupées). */
export function TableToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4", className)}>{children}</div>;
}

/** Pied de tableau : compteur + pagination. */
export function TableFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-muted", className)}>{children}</div>;
}
