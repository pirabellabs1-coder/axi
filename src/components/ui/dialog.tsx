"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog accessible basé sur <dialog> natif (focus trap + Esc gérés par le navigateur).
 * `sheet` : panneau bas sur mobile / latéral sur desktop.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  sheet = false,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  sheet?: boolean;
  size?: "sm" | "md" | "lg";
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

  const widths = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-0 w-full bg-transparent p-0 text-ink backdrop:bg-ink/40 backdrop:backdrop-blur-[2px] open:animate-fade-in [&[open]>div]:animate-[dialog-in_220ms_cubic-bezier(0.23,1,0.32,1)]",
        sheet
          ? "fixed inset-x-0 bottom-0 top-auto max-h-[92dvh] max-w-full sm:inset-y-0 sm:left-auto sm:right-0 sm:h-dvh sm:max-h-none sm:w-[480px]"
          : cn("fixed inset-0 m-auto max-h-[90dvh] max-w-[calc(100%-2rem)]", widths[size]),
      )}
    >
      <div
        className={cn(
          "flex max-h-[inherit] flex-col bg-surface shadow-[var(--shadow-lg)]",
          sheet ? "h-full rounded-t-[var(--radius-xl)] sm:rounded-none sm:rounded-l-[var(--radius-xl)]" : "rounded-[var(--radius-xl)]",
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div>
            <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="-mr-2 -mt-1.5 inline-flex size-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
      <style>{"@keyframes dialog-in{from{opacity:0;transform:scale(.97) translateY(4px)}to{opacity:1;transform:none}}"}</style>
    </dialog>
  );
}

export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirmer",
  tone = "danger",
  onConfirm,
  className,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} disabled={disabled}>
        {children}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2">
              Annuler
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setPending(false);
                }
              }}
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium transition-transform duration-150 active:scale-[0.98] disabled:opacity-50",
                tone === "danger" ? "bg-danger text-canvas hover:opacity-90" : "bg-primary text-on-primary hover:bg-primary-hover",
              )}
            >
              {pending ? "Patientez…" : confirmLabel}
            </button>
          </>
        }
      >
        <span className="sr-only">{description}</span>
      </Dialog>
    </>
  );
}
