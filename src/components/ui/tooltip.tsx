"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Infobulle accessible (survol + focus clavier, Échap pour fermer).
 * Délai d'ouverture 350 ms, puis ouverture instantanée pour les infobulles voisines (fenêtre de 600 ms).
 * À réserver aux compléments d'information : jamais pour une information indispensable.
 */
let lastClosedAt = 0;

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [instant, setInstant] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (delay = true) => {
    if (timer.current) clearTimeout(timer.current);
    const skip = !delay || Date.now() - lastClosedAt < 600;
    setInstant(skip);
    timer.current = setTimeout(() => setOpen(true), skip ? 0 : 350);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    if (open) lastClosedAt = Date.now();
    setOpen(false);
  };

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const pos = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2 origin-bottom",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2 origin-top",
    left: "right-full top-1/2 mr-2 -translate-y-1/2 origin-right",
    right: "left-full top-1/2 ml-2 -translate-y-1/2 origin-left",
  }[side];

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={hide}
      onFocus={() => show(false)}
      onBlur={hide}
    >
      {React.cloneElement(children, { "aria-describedby": open ? id : undefined })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-[70] w-max max-w-[240px] rounded-[10px] bg-ink px-2.5 py-1.5 text-xs font-medium leading-snug text-canvas shadow-[var(--shadow-md)]",
          "transition-[opacity,transform] ease-out",
          instant ? "duration-0" : "duration-150",
          open ? "scale-100 opacity-100" : "invisible scale-[0.97] opacity-0",
          pos,
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
