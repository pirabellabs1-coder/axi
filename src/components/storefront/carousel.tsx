"use client";

import { Children, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Carrousel accessible à défilement natif (swipe au doigt, aimantation CSS), flèches sur ordinateur,
 * lecture automatique optionnelle mise en pause au survol, au focus et en mouvement réduit.
 */
export function Carousel({
  children,
  label,
  itemClassName = "w-[78%] sm:w-[46%] lg:w-[calc((100%-3*20px)/4)]",
  gapClassName = "gap-3 sm:gap-5",
  autoplay = 0,
  dots = false,
  arrows = "outside",
  bleed = true,
}: {
  children: React.ReactNode;
  label: string;
  itemClassName?: string;
  gapClassName?: string;
  /** Secondes entre deux défilements (0 = désactivé). */
  autoplay?: number;
  dots?: boolean;
  arrows?: "outside" | "inside" | "none";
  bleed?: boolean;
}) {
  const items = Children.toArray(children);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: items.length <= 1 });
  const paused = useRef(false);

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft >= max - 4 });
    const kids = Array.from(el.children) as HTMLElement[];
    let best = 0;
    let dist = Infinity;
    kids.forEach((k, i) => {
      const d = Math.abs(k.offsetLeft - el.offsetLeft - el.scrollLeft);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setIndex(best);
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update, items.length]);

  const go = useCallback((i: number) => {
    const el = track.current;
    const kids = el ? (Array.from(el.children) as HTMLElement[]) : [];
    if (!el || !kids.length) return;
    const target = kids[(i + kids.length) % kids.length];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: target.offsetLeft - el.offsetLeft, behavior: reduce ? "auto" : "smooth" });
  }, []);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: reduce ? "auto" : "smooth" });
  };

  useEffect(() => {
    if (!autoplay || items.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (paused.current || document.hidden) return;
      go(edges.end ? 0 : index + 1);
    }, autoplay * 1000);
    return () => clearInterval(t);
  }, [autoplay, items.length, go, index, edges.end]);

  const arrowBtn = "inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink shadow-[var(--shadow-md)] ring-1 ring-line transition-[opacity,transform] duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-0";

  return (
    <div
      className="group/carousel relative"
      role="region"
      aria-roledescription="carrousel"
      aria-label={label}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocusCapture={() => (paused.current = true)}
      onBlurCapture={() => (paused.current = false)}
    >
      <div ref={track} className={cn("scrollbar-none sf-snap relative flex overflow-x-auto", gapClassName, bleed && "-mx-4 px-4 sm:mx-0 sm:px-0", "scroll-px-4 sm:scroll-px-0")}>
        {items.map((child, i) => (
          <div key={i} className={cn("shrink-0", itemClassName)} aria-roledescription="diapositive" aria-label={`${i + 1} sur ${items.length}`}>
            {child}
          </div>
        ))}
      </div>
      {arrows !== "none" && items.length > 1 && (
        <>
          <button type="button" aria-label="Précédent" onClick={() => step(-1)} disabled={edges.start} className={cn(arrowBtn, "absolute top-1/2 hidden -translate-y-1/2 md:inline-flex", arrows === "outside" ? "-left-5" : "left-3")}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" aria-label="Suivant" onClick={() => step(1)} disabled={edges.end} className={cn(arrowBtn, "absolute top-1/2 hidden -translate-y-1/2 md:inline-flex", arrows === "outside" ? "-right-5" : "right-3")}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </>
      )}
      {dots && items.length > 1 && (
        <div className="mt-4 flex justify-center gap-1.5">
          {items.map((_, i) => (
            <button key={i} type="button" onClick={() => go(i)} aria-label={`Aller à ${i + 1}`} aria-current={i === index ? "true" : undefined} className="inline-flex h-6 min-w-6 items-center justify-center">
              <span className={cn("block h-1.5 rounded-full bg-ink transition-[width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]", i === index ? "w-6 opacity-90" : "w-1.5 opacity-25")} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
