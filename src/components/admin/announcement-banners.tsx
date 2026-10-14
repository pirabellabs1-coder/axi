"use client";

import { useEffect, useState } from "react";
import { Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { id: string; title: string; body: string; tone: "info" | "success" | "warning" };

const STORAGE_KEY = "axi.announcements.dismissed";

function readDismissed(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

const TONE = {
  info: { icon: Info, cls: "text-info", label: "Information" },
  success: { icon: Sparkles, cls: "text-primary", label: "Nouveauté" },
  warning: { icon: TriangleAlert, cls: "text-warning", label: "Important" },
} as const;

/** Bandeaux d'annonces fermables : rien n'est affiché avant la lecture de localStorage (pas de clignement). */
export function AnnouncementBanners({ items, preview = false }: { items: Item[]; preview?: boolean }) {
  const [dismissed, setDismissed] = useState<string[] | null>(preview ? [] : null);

  useEffect(() => {
    if (preview) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(readDismissed());
  }, [preview]);

  if (dismissed === null) return null;
  const visible = items.filter((i) => !dismissed.includes(i.id));
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    if (preview) return;
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // stockage indisponible (navigation privée) : fermeture pour la session seulement
    }
  };

  return (
    <div className={preview ? "space-y-2" : "mb-5 space-y-2"} role={preview ? undefined : "region"} aria-label={preview ? undefined : "Annonces de la plateforme"}>
      {visible.map((a) => {
        const t = TONE[a.tone];
        return (
          <div key={a.id} className="flex items-start gap-3 rounded-[var(--radius-md)] bg-surface py-2.5 pl-4 pr-1.5 text-sm ring-1 ring-line shadow-[var(--shadow-card)] motion-safe:animate-fade-in">
            <t.icon className={cn("mt-0.5 size-4 shrink-0", t.cls)} aria-hidden />
            <p className="min-w-0 flex-1 py-px text-ink-muted">
              <span className="sr-only">{t.label} : </span>
              <span className="font-medium text-ink">{a.title}</span> <span className="[overflow-wrap:anywhere]">{a.body}</span>
            </p>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              aria-label={`Masquer l'annonce « ${a.title} »`}
              className="-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
