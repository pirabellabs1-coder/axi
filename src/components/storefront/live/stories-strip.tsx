"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductImage } from "../product-image";

/**
 * Stories achetables (lot 4 §17, équipe CAN) : cercles + visionneuse plein écran.
 *
 * Accessibilité (point d'attention de la spec) :
 *  - les cercles sont de vrais `<button>` dans une liste, cibles ≥ 44 px, libellé explicite ;
 *  - la visionneuse est un `role="dialog"` `aria-modal="true"` : focus déplacé à l'ouverture, piégé dans la
 *    boîte (Tab et Maj+Tab bouclent), restitué au cercle d'origine à la fermeture ;
 *  - Échap ferme, flèches gauche/droite changent de story, Espace met en pause ;
 *  - l'avance automatique est annoncée par une barre de progression, peut être mise en pause (WCAG 2.2.2)
 *    et ne démarre PAS si le visiteur demande à réduire les animations ;
 *  - le défilement de la page est bloqué pendant l'ouverture, puis restauré.
 */

export type StoryItem = {
  id: string;
  title: string;
  text: string;
  image: string | null;
  video: string | null;
  durationMs: number;
  product: { slug: string; name: string; priceLabel: string; image: string | null } | null;
};

const SIZE: Record<string, string> = { sm: "size-16", md: "size-20", lg: "size-24" };

export function StoriesStrip({ stories, base, size, showLabels }: { stories: StoryItem[]; base: string; size: string; showLabels: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback(() => {
    const index = open;
    setOpen(null);
    if (index != null) triggers.current[index]?.focus();
  }, [open]);

  if (!stories.length) return null;
  return (
    <>
      <ul className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
        {stories.map((s, i) => (
          <li key={s.id} className="shrink-0 snap-start text-center">
            <button
              ref={(el) => {
                triggers.current[i] = el;
              }}
              type="button"
              onClick={() => setOpen(i)}
              className="group inline-flex flex-col items-center gap-2 rounded-[22px] p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--store-primary)]"
            >
              <span className={cn("relative rounded-full p-[3px] ring-2 ring-[var(--store-primary)] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:scale-105 motion-reduce:transition-none", SIZE[size] ?? SIZE.md)}>
                <ProductImage src={s.image ?? undefined} alt="" ratio="h-full" className="size-full overflow-hidden rounded-full" sizes="96px" />
              </span>
              <span className={cn("block max-w-24 truncate text-xs font-medium text-ink", !showLabels && "sr-only")}>{s.title || `Story ${i + 1}`}</span>
              <span className="sr-only">Ouvrir</span>
            </button>
          </li>
        ))}
      </ul>
      {open != null && <StoryViewer stories={stories} start={open} base={base} onClose={close} />}
    </>
  );
}

/** Exportée pour les tests (le rendu de la visionneuse est vérifié hors interaction). */
export function StoryViewer({ stories, start, base, onClose }: { stories: StoryItem[]; start: number; base: string; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const story = stories[index];

  const next = useCallback(() => {
    setProgress(0);
    setIndex((i) => (i + 1 < stories.length ? i + 1 : i));
    if (index + 1 >= stories.length) onClose();
  }, [index, stories.length, onClose]);

  const prev = useCallback(() => {
    setProgress(0);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Focus initial, blocage du défilement et restitution.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus?.();
    };
  }, []);

  // Clavier : Échap, flèches, Espace ; piège de focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "Tab") {
        const nodes = box.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (!nodes?.length) return;
        const list = Array.from(nodes);
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // Avance automatique : coupée si le visiteur réduit les animations ou met en pause.
  useEffect(() => {
    if (paused || !story) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const step = 100;
    const id = window.setInterval(() => {
      setProgress((p) => {
        const value = p + (step / story.durationMs) * 100;
        if (value >= 100) {
          window.clearInterval(id);
          next();
          return 0;
        }
        return value;
      });
    }, step);
    return () => window.clearInterval(id);
  }, [paused, story, index, next]);

  if (!story) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 p-0 sm:p-6">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={`Story ${index + 1} sur ${stories.length}${story.title ? ` : ${story.title}` : ""}`}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[460px] flex-col overflow-hidden bg-black sm:h-[86vh] sm:rounded-[24px]"
      >
        {/* Progression */}
        <div className="absolute inset-x-3 top-3 z-20 flex gap-1" aria-hidden>
          {stories.map((s, i) => (
            <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-white" style={{ width: i < index ? "100%" : i === index ? `${Math.min(100, progress)}%` : "0%" }} />
            </span>
          ))}
        </div>

        <div className="absolute right-2 top-7 z-20 flex gap-1">
          <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={paused ? "Reprendre la lecture" : "Mettre en pause"} className="inline-flex size-11 items-center justify-center rounded-full text-white hover:bg-white/15">
            {paused ? <Play className="size-5" aria-hidden /> : <Pause className="size-5" aria-hidden />}
          </button>
          <button type="button" onClick={onClose} aria-label="Fermer les stories" className="inline-flex size-11 items-center justify-center rounded-full text-white hover:bg-white/15">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="relative flex-1">
          {story.video ? (
            <video src={story.video} poster={story.image ?? undefined} autoPlay={!paused} muted loop playsInline preload="none" aria-label={story.title || "Story"} className="absolute inset-0 size-full object-cover" />
          ) : (
            story.image && <ProductImage src={story.image} alt={story.title || ""} ratio="h-full" className="absolute inset-0 size-full !bg-black" sizes="(max-width: 640px) 100vw, 460px" />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/80 to-transparent" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 p-4">
            {story.title && <p className="text-lg font-semibold text-white">{story.title}</p>}
            {story.text && <p className="mt-1 max-w-[38ch] text-sm leading-relaxed text-white/85">{story.text}</p>}
            {story.product && (
              <Link
                href={`${base}/p/${story.product.slug}`}
                className="mt-3 flex items-center gap-3 rounded-full bg-white/95 p-1.5 pr-5 text-left text-[#111412] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:scale-[1.01] motion-reduce:transition-none"
              >
                <ProductImage src={story.product.image ?? undefined} alt="" ratio="aspect-square" className="size-11 shrink-0 overflow-hidden rounded-full" sizes="44px" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{story.product.name}</span>
                  <span className="block text-xs font-medium opacity-70">{story.product.priceLabel} · Voir le produit</span>
                </span>
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-2 py-1">
          <button type="button" onClick={prev} disabled={index === 0} aria-label="Story précédente" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-white disabled:opacity-40">
            <ChevronLeft className="size-4" aria-hidden /> Précédente
          </button>
          <span className="text-xs text-white/60" aria-hidden>
            {index + 1} / {stories.length}
          </span>
          <button type="button" onClick={next} aria-label={index + 1 < stories.length ? "Story suivante" : "Fermer les stories"} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-white">
            Suivante <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
