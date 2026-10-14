"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Img } from "@/lib/storefront/render-types";
import { ProductImage } from "../product-image";

export type GalleryStyle = "thumbnails-left" | "thumbnails-bottom" | "carousel" | "stacked" | "grid-2";

const SIZES_MAIN = "(max-width: 1024px) 100vw, 55vw";

/**
 * Galerie produit : 5 dispositions, swipe natif sur mobile (aimantation), vignettes, zoom au survol (ordinateur)
 * et visionneuse plein écran (<dialog> : focus piégé, Échap pour fermer). L'image active est pilotée par la variante.
 */
export function ProductGallery({ images, name, style, zoom, active, onActiveChange, badge }: { images: Img[]; name: string; style: GalleryStyle; zoom: boolean; active: number; onActiveChange: (i: number) => void; badge?: React.ReactNode }) {
  const list = images.length ? images : [{ url: "", alt: name }];
  const track = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const fromScroll = useRef(false);
  const [lightbox, setLightbox] = useState(0);
  // Visionneuse : l'image plein écran n'est rendue qu'une fois ouverte (sinon téléchargée au chargement, en concurrence
  // avec l'image du LCP : mesure du lot 1, double téléchargement 828w + 900w).
  const [viewerOpen, setViewerOpen] = useState(false);

  // Défilement mobile → image active.
  useEffect(() => {
    const el = track.current;
    if (!el || list.length < 2) return;
    const slides = Array.from(el.children) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            fromScroll.current = true;
            onActiveChange(slides.indexOf(e.target as HTMLElement));
          }
      },
      { root: el, threshold: 0.6 },
    );
    slides.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [list.length, onActiveChange]);

  // Image active (variante, vignette) → défilement du carrousel.
  useEffect(() => {
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const el = track.current;
    const slide = el?.children[active] as HTMLElement | undefined;
    if (!el || !slide || el.scrollWidth <= el.clientWidth) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: slide.offsetLeft - el.offsetLeft, behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  const open = useCallback((i: number) => {
    setLightbox(i);
    setViewerOpen(true);
    dialog.current?.showModal();
  }, []);

  const slider = (cls: string, showDots = true) => (
    <div className={cn("relative", cls)}>
      <div ref={track} className="scrollbar-none sf-snap relative flex overflow-x-auto rounded-[var(--store-card-radius)]" aria-label={`Photos de ${name}`} role="region" aria-roledescription="carrousel">
        {list.map((im, i) => (
          <div key={i} className="w-full shrink-0" aria-roledescription="diapositive" aria-label={`${i + 1} sur ${list.length}`}>
            <ZoomImage img={im} name={name} priority={i === 0} zoom={zoom} onOpen={() => open(i)} />
          </div>
        ))}
      </div>
      {badge && <div className="pointer-events-none absolute left-3 top-3">{badge}</div>}
      {list.length > 1 && showDots && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden>
          {list.map((_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.08)] transition-[width,opacity] duration-300", i === active ? "w-5 opacity-100" : "w-1.5 opacity-60")} />
          ))}
        </div>
      )}
      {list.length > 1 && (
        <>
          <button type="button" aria-label="Photo précédente" onClick={() => onActiveChange((active - 1 + list.length) % list.length)} className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#111412] shadow-[var(--shadow-md)] transition-transform active:scale-95 lg:inline-flex">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" aria-label="Photo suivante" onClick={() => onActiveChange((active + 1) % list.length)} className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#111412] shadow-[var(--shadow-md)] transition-transform active:scale-95 lg:inline-flex">
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </>
      )}
    </div>
  );

  const thumbs = (vertical: boolean) =>
    list.length > 1 && (
      <ul className={cn("scrollbar-none hidden gap-2 lg:flex", vertical ? "max-h-[640px] w-[76px] shrink-0 flex-col overflow-y-auto" : "mt-3 overflow-x-auto")} aria-label="Choisir une photo">
        {list.map((im, i) => (
          <li key={i} className="shrink-0">
            <button
              type="button"
              onClick={() => onActiveChange(i)}
              aria-label={`Afficher la photo ${i + 1} sur ${list.length}`}
              aria-current={i === active ? "true" : undefined}
              className={cn("block w-[72px] overflow-hidden rounded-[10px] ring-2 ring-offset-2 ring-offset-canvas transition-[box-shadow,opacity] duration-200", i === active ? "ring-[var(--store-primary)]" : "opacity-65 ring-transparent hover:opacity-100")}
            >
              <ProductImage src={im.url || null} alt="" ratio="aspect-square" sizes="72px" />
            </button>
          </li>
        ))}
      </ul>
    );

  let body: React.ReactNode;
  if (style === "stacked" || style === "grid-2") {
    body = (
      <>
        <div className="lg:hidden">{slider("")}</div>
        <div className={cn("hidden gap-3 lg:grid", style === "grid-2" && "grid-cols-2")}>
          {list.map((im, i) => (
            <div key={i} className={cn("relative", style === "grid-2" && i === 0 && list.length % 2 === 1 && "col-span-2")}>
              <ZoomImage img={im} name={name} priority={i === 0} zoom={zoom} onOpen={() => open(i)} rounded />
              {i === 0 && badge && <div className="pointer-events-none absolute left-3 top-3">{badge}</div>}
            </div>
          ))}
        </div>
      </>
    );
  } else if (style === "thumbnails-left") {
    body = (
      <div className="flex gap-3">
        {thumbs(true)}
        {slider("min-w-0 flex-1")}
      </div>
    );
  } else if (style === "thumbnails-bottom") {
    body = (
      <>
        {slider("")}
        {thumbs(false)}
      </>
    );
  } else {
    body = slider("");
  }

  return (
    <div className="-mx-4 sm:mx-0">
      {body}
      <dialog
        ref={dialog}
        aria-label={`Photos de ${name} en plein écran`}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        onClose={() => setViewerOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setLightbox((x) => (x + 1) % list.length);
          if (e.key === "ArrowLeft") setLightbox((x) => (x - 1 + list.length) % list.length);
        }}
      >
        <div className="relative flex h-full w-full items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {viewerOpen && list[lightbox]?.url && <img src={list[lightbox].url} alt={list[lightbox].alt ?? name} className="max-h-full max-w-full object-contain" />}
          <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Fermer" className="absolute right-4 top-4 inline-flex size-12 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25">
            <X className="size-6" aria-hidden />
          </button>
          {list.length > 1 && (
            <>
              <button type="button" onClick={() => setLightbox((x) => (x - 1 + list.length) % list.length)} aria-label="Photo précédente" className="absolute left-4 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
                <ChevronLeft className="size-6" aria-hidden />
              </button>
              <button type="button" onClick={() => setLightbox((x) => (x + 1) % list.length)} aria-label="Photo suivante" className="absolute right-4 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
                <ChevronRight className="size-6" aria-hidden />
              </button>
              <p className="absolute bottom-5 left-1/2 -translate-x-1/2 text-sm tabular text-white/80">
                {lightbox + 1} / {list.length}
              </p>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

/** Image avec zoom au survol (pointeur fin uniquement) et ouverture plein écran au clic. */
function ZoomImage({ img, name, priority, zoom, onOpen, rounded }: { img: Img; name: string; priority?: boolean; zoom: boolean; onOpen: () => void; rounded?: boolean }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const fine = useRef(false);
  useEffect(() => {
    fine.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  if (!img.url) return <ProductImage src={null} alt="" ratio="aspect-[4/5]" />;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Agrandir : ${img.alt || name}`}
      className={cn("group relative block w-full cursor-zoom-in overflow-hidden", rounded && "rounded-[var(--store-card-radius)]")}
      onPointerMove={(e) => {
        if (!zoom || !fine.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        setOrigin(`${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}% ${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
      }}
      onPointerLeave={() => setOrigin(null)}
    >
      <div className="transition-transform duration-300 ease-out will-change-transform" style={origin ? { transform: "scale(1.9)", transformOrigin: origin } : undefined}>
        <ProductImage src={img.url} alt={img.alt || name} ratio="aspect-[4/5]" sizes={SIZES_MAIN} priority={priority} />
      </div>
      <span className="pointer-events-none absolute bottom-3 right-3 inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-[#111412] opacity-0 shadow-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
        <Expand className="size-4" />
      </span>
    </button>
  );
}
