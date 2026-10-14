"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Panneau latéral (droite / gauche) ou tiroir bas, sur <dialog> natif :
 * piège de focus, Échap et clic sur le voile gérés. Glisse depuis son bord (transform uniquement).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  side = "right",
  children,
  footer,
  className,
  hideHeader = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  side?: "right" | "left" | "bottom";
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Masque visuellement l'en-tête (le titre reste lu par les lecteurs d'écran). */
  hideHeader?: boolean;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Garde l'état React synchronisé avec le <dialog> natif : Chrome peut fermer la fenêtre sans
  // « cancel » annulable (deuxième Échap, CloseWatcher), ce qui laissait `open` à true et empêchait
  // toute réouverture.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    const onNativeClose = () => {
      if (openRef.current) onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    el.addEventListener("close", onNativeClose);
    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("close", onNativeClose);
    };
  }, []);

  const placement = {
    right: "inset-y-0 right-0 left-auto h-dvh max-h-none w-[min(440px,100vw)] [&[open]>div]:animate-[sheet-r_280ms_cubic-bezier(0.32,0.72,0,1)]",
    left: "inset-y-0 left-0 right-auto h-dvh max-h-none w-[min(300px,88vw)] [&[open]>div]:animate-[sheet-l_280ms_cubic-bezier(0.32,0.72,0,1)]",
    bottom: "inset-x-0 bottom-0 top-auto max-h-[90dvh] w-full max-w-full [&[open]>div]:animate-[sheet-b_300ms_cubic-bezier(0.32,0.72,0,1)]",
  }[side];
  const radius = {
    right: "rounded-l-[var(--radius-xl)]",
    left: "rounded-r-[var(--radius-xl)]",
    bottom: "rounded-t-[var(--radius-xl)]",
  }[side];

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn("fixed m-0 bg-transparent p-0 text-ink backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]", placement)}
    >
      <div className={cn("flex h-full max-h-[inherit] flex-col bg-surface shadow-[var(--shadow-lg)] ring-1 ring-line", radius, className)}>
        {side === "bottom" && <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong" />}
        <div className={cn("flex items-start justify-between gap-4 px-5 pt-4 pb-3", hideHeader && "sr-only")}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="-mr-2 -mt-1 inline-flex size-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
      <style>{`@keyframes sheet-r{from{transform:translateX(100%)}to{transform:none}}@keyframes sheet-l{from{transform:translateX(-100%)}to{transform:none}}@keyframes sheet-b{from{transform:translateY(100%)}to{transform:none}}`}</style>
    </dialog>
  );
}
