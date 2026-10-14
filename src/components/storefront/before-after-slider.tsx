"use client";

import { useId, useState } from "react";
import { ChevronsLeftRight } from "lucide-react";

/**
 * Curseur avant / après : un vrai `<input type="range">` (clavier : flèches, Début, Fin ; lecteurs d'écran : valeur
 * annoncée) superposé à l'image. Seule la variable `--pos` change : l'image « après » est découpée par `clip-path`
 * et la poignée déplacée par `transform` (aucune mise en page recalculée).
 */
export function BeforeAfterSlider({ start, beforeLabel, afterLabel, before, after }: { start: number; beforeLabel: string; afterLabel: string; before: React.ReactNode; after: React.ReactNode }) {
  const [pos, setPos] = useState(start);
  const id = useId();
  return (
    <div className="relative isolate select-none" style={{ "--pos": `${pos}%` } as React.CSSProperties}>
      {before}
      <div className="absolute inset-0" style={{ clipPath: "inset(0 0 0 var(--pos))" }}>
        {after}
      </div>
      <span aria-hidden className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
        {beforeLabel}
      </span>
      <span aria-hidden className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
        {afterLabel}
      </span>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-full" style={{ transform: "translateX(var(--pos))" }}>
        <span className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)]" />
        <span className="absolute top-1/2 -ml-[22px] -mt-[22px] flex size-11 items-center justify-center rounded-full bg-white text-[#111412] shadow-[0_4px_16px_rgb(0_0_0/0.25)]">
          <ChevronsLeftRight className="size-5" aria-hidden />
        </span>
      </span>
      <label htmlFor={id} className="sr-only">
        Comparer {beforeLabel.toLowerCase()} et {afterLabel.toLowerCase()} : part de l&apos;image « {beforeLabel} » visible
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-valuetext={`${pos} % ${beforeLabel.toLowerCase()}`}
        className="peer absolute inset-0 z-[1] size-full cursor-ew-resize opacity-0"
      />
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] ring-[var(--store-primary)] peer-focus-visible:ring-4" />
    </div>
  );
}
