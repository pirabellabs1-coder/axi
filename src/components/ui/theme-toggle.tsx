"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "system" | "light" | "dark";

/** Sélecteur de thème (système / clair / sombre), mémorisé sur l'appareil. */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    try {
      const t = localStorage.getItem("axi-theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (t === "light" || t === "dark") setMode(t);
    } catch {}
  }, []);

  function apply(next: Mode) {
    setMode(next);
    const root = document.documentElement;
    try {
      if (next === "system") {
        localStorage.removeItem("axi-theme");
        root.removeAttribute("data-theme");
      } else {
        localStorage.setItem("axi-theme", next);
        root.setAttribute("data-theme", next);
      }
    } catch {}
  }

  const opts: { id: Mode; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Thème clair", icon: Sun },
    { id: "system", label: "Thème du système", icon: Monitor },
    { id: "dark", label: "Thème sombre", icon: Moon },
  ];

  return (
    <div role="radiogroup" aria-label="Thème" className={cn("inline-flex items-center gap-0.5 rounded-full bg-surface-2 p-1 ring-1 ring-line", className)}>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          aria-label={o.label}
          title={o.label}
          onClick={() => apply(o.id)}
          className={cn(
            "inline-flex size-8 items-center pointer-coarse:size-11 justify-center rounded-full text-ink-muted transition-colors duration-300 ease-spring hover:text-ink",
            mode === o.id && "bg-surface text-ink shadow-sm",
          )}
        >
          <o.icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
