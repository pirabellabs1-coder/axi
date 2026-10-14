"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string; action?: ToastAction };

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 1;

/**
 * toast.success("Enregistré") · toast.error("Échec", "Détail") · toast.info(…)
 * Option : toast.success("Commande archivée", undefined, { label: "Annuler", onClick })
 */
export function toast(kind: ToastKind, title: string, description?: string, action?: ToastAction) {
  const item = { id: seq++, kind, title, description, action };
  listeners.forEach((l) => l(item));
}
toast.success = (title: string, description?: string, action?: ToastAction) => toast("success", title, description, action);
toast.error = (title: string, description?: string, action?: ToastAction) => toast("error", title, description, action);
toast.info = (title: string, description?: string, action?: ToastAction) => toast("info", title, description, action);

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const colors = { success: "text-primary", error: "text-danger", info: "text-info" };
const DURATION = 5000;

export function Toaster() {
  const [items, setItems] = React.useState<(ToastItem & { leaving?: boolean })[]>([]);
  const [paused, setPaused] = React.useState(false);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 180);
  }, []);

  React.useEffect(() => {
    const l: Listener = (t) => setItems((prev) => [...prev.slice(-3), t]);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  // Minuterie : suspendue au survol / focus et quand l'onglet est masqué.
  React.useEffect(() => {
    if (paused || items.length === 0) return;
    const live = items.filter((t) => !t.leaving);
    const timers = live.map((t) => setTimeout(() => dismiss(t.id), t.kind === "error" ? DURATION + 2000 : DURATION));
    return () => timers.forEach(clearTimeout);
  }, [items, paused, dismiss]);

  React.useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:right-6"
    >
      {items.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--radius-md)] bg-surface p-3.5 ring-1 ring-line shadow-[var(--shadow-lg)]",
              "transition-[opacity,transform] duration-200 ease-out starting:translate-y-3 starting:opacity-0",
              t.leaving && "translate-y-1 scale-[0.98] opacity-0 duration-150",
            )}
          >
            <Icon className={cn("mt-0.5 size-5 shrink-0", colors[t.kind])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm text-ink-muted">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-2 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Fermer la notification"
              onClick={() => dismiss(t.id)}
              className="-m-1 inline-flex size-8 items-center justify-center rounded-full text-ink-faint hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
