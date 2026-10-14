import * as React from "react";
import { cn } from "@/lib/utils";

/** Carte standard : surface, anneau fin, ombre teintée, rayon 20 px. */
export function Card({ className, children, as: Tag = "div", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li" }) {
  return (
    <Tag className={cn("rounded-[var(--radius-lg)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]", className)} {...props}>
      {children}
    </Tag>
  );
}

/**
 * Carte « double-bezel » : coque extérieure + noyau intérieur aux rayons concentriques.
 * Pour les blocs importants (tarifs, mises en avant, panneaux clés).
 */
export function Bezel({ className, coreClassName, children, as: Tag = "div" }: { className?: string; coreClassName?: string; children: React.ReactNode; as?: "div" | "section" | "article" | "li" }) {
  return (
    <Tag className={cn("bezel", className)}>
      <div className={cn("bezel-core h-full", coreClassName)}>{children}</div>
    </Tag>
  );
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-1 sm:px-6", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-3.5 sm:px-6", className)}>{children}</div>;
}
