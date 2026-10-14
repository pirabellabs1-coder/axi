"use client";

import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Menu déroulant accessible (motif « menu button » WAI-ARIA).
 * Clavier : Entrée/Espace/Flèche bas ouvrent, flèches haut/bas naviguent, Origine/Fin, Échap ferme et rend le focus.
 *
 * <DropdownMenu trigger={(p) => <button {...p}>Actions</button>}>
 *   <DropdownItem href="/x" icon={Eye}>Voir</DropdownItem>
 *   <DropdownItem onSelect={() => …} tone="danger">Supprimer</DropdownItem>
 * </DropdownMenu>
 */
type TriggerProps = {
  ref: React.Ref<HTMLButtonElement>;
  type: "button";
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

const MenuCtx = React.createContext<{ close: () => void } | null>(null);

export function DropdownMenu({
  trigger,
  children,
  align = "end",
  side = "bottom",
  className,
  wrapperClassName,
  label,
}: {
  trigger: (props: TriggerProps) => React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  className?: string;
  /** Classes du conteneur (ex. `flex w-full` pour un déclencheur pleine largeur). */
  wrapperClassName?: string;
  /** Nom accessible du menu (sinon : texte du bouton). */
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  const focusAt = (i: number) => {
    const list = items();
    if (!list.length) return;
    list[(i + list.length) % list.length]?.focus();
  };

  const close = React.useCallback((restore = true) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusAt(0));
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const target = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (target !== undefined) {
      e.preventDefault();
      focusAt(target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative inline-flex", wrapperClassName)}>
      {trigger({
        ref: triggerRef,
        type: "button",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": id,
        onClick: () => setOpen((v) => !v),
        onKeyDown: (e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        },
      })}
      <MenuCtx.Provider value={{ close: () => close() }}>
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          hidden={!open}
          onKeyDown={onMenuKey}
          onBlur={(e) => {
            // Focus parti ailleurs au clavier (Tab) : on ferme. Les clics extérieurs sont gérés par mousedown.
            if (e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget as Node)) close(false);
          }}
          className={cn(
            "absolute z-[60] min-w-[220px] overflow-hidden rounded-[var(--radius-md)] bg-surface p-1.5 ring-1 ring-line shadow-[var(--shadow-lg)]",
            "origin-top animate-[menu-in_160ms_cubic-bezier(0.23,1,0.32,1)]",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2 origin-bottom",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      </MenuCtx.Provider>
      <style>{`@keyframes menu-in{from{opacity:0;transform:scale(.97) translateY(-2px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

const itemBase =
  "flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm text-ink outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50";

export function DropdownItem({
  href,
  onSelect,
  icon: Icon,
  children,
  tone = "default",
  disabled,
  external,
  hint,
  download,
}: {
  href?: string;
  onSelect?: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  external?: boolean;
  hint?: React.ReactNode;
  /** Lien de téléchargement (fichier, export CSV) : <a download> natif, sans prefetch ni routeur client. */
  download?: boolean | string;
}) {
  const ctx = React.useContext(MenuCtx);
  const cls = cn(itemBase, tone === "danger" && "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft");
  const inner = (
    <>
      {Icon && <Icon className={cn("size-4 shrink-0", tone === "danger" ? "text-danger" : "text-ink-muted")} aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="ml-2 shrink-0 text-xs text-ink-faint">{hint}</span>}
    </>
  );
  if (href && !disabled && download) {
    return (
      <a href={href} download={download === true ? "" : download} role="menuitem" tabIndex={-1} className={cls} onClick={() => ctx?.close()}>
        {inner}
      </a>
    );
  }
  if (href && !disabled) {
    return (
      <Link
        href={href}
        role="menuitem"
        tabIndex={-1}
        className={cls}
        onClick={() => ctx?.close()}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={cls}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        ctx?.close();
      }}
    >
      {inner}
    </button>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{children}</p>;
}

export function DropdownSeparator() {
  return <div role="separator" className="my-1.5 h-px bg-line" />;
}
