"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductImage } from "../product-image";
import { QuickAddButton } from "../quick-add-button";
import type { CartLine } from "../cart-store";

/**
 * Vidéo achetable (lot 4 §17, équipe CAN) : lecteur + produits étiquetés. Composant CLIENT unique, pour que
 * l'instant de lecture puisse mettre en avant le bon produit sans remonter au serveur.
 *
 *  - la vidéo n'est TÉLÉCHARGÉE que lorsque la section entre dans la vue (`IntersectionObserver`, aucun
 *    écouteur de défilement) ; l'image de couverture, rendue par le serveur, porte le cadrage et évite
 *    tout décalage de mise en page ;
 *  - lecture automatique muette seulement si elle est autorisée : réglage de la section, animations actives
 *    sur la boutique (`[data-motion]`, absent sous Save-Data et en mode économie), ni `prefers-reduced-motion`,
 *    ni `navigator.connection.saveData` ; et uniquement tant que la vidéo est visible ;
 *  - commandes réelles au clavier (Pause/Lecture, Son), cibles de 44 px, `aria-pressed` ;
 *  - sous-titres VTT facultatifs ;
 *  - produits : lien vers la fiche, ajout direct quand c'est possible, commande sur WhatsApp.
 */

const RATIO: Record<string, string> = { portrait: "aspect-[4/5]", square: "aspect-square", landscape: "aspect-video" };

export type TaggedItem = {
  id: string;
  slug: string;
  name: string;
  priceLabel: string;
  compareLabel: string | null;
  image: string | null;
  /** Instant d'apparition dans la vidéo, en secondes. */
  at: number;
  note: string;
  soldOut: boolean;
  /** Ajout direct possible (produit simple, boutique ouverte, ajout rapide autorisé). */
  quickAdd: boolean;
  line: Omit<CartLine, "key">;
  waHref: string | null;
};

export function ShoppableBody({
  src,
  poster,
  autoplay,
  loop,
  captions,
  label,
  items,
  slug,
  base,
  addLabel,
  side,
  ratio,
}: {
  src: string | null;
  poster: string | null;
  autoplay: boolean;
  loop: boolean;
  captions: string | null;
  label: string;
  items: TaggedItem[];
  slug: string;
  base: string;
  addLabel: string;
  side: boolean;
  ratio: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [visible, setVisible] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.4 });
    io.observe(v);
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const allowed = autoplay && !!v.closest("[data-motion]") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && !conn?.saveData;
    if (allowed) setLoaded(true);
    return () => io.disconnect();
  }, [autoplay, src]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !loaded) return;
    if (visible && !userPaused) v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [loaded, visible, userPaused]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !items.some((i) => i.at > 0)) return;
    let last = -1;
    const onUpdate = () => {
      const s = Math.floor(v.currentTime);
      if (s !== last) {
        last = s;
        setTime(s);
      }
    };
    v.addEventListener("timeupdate", onUpdate);
    return () => v.removeEventListener("timeupdate", onUpdate);
  }, [items]);

  /** Produit courant : dernier produit dont l'instant d'apparition est passé. */
  const currentId = useMemo(() => {
    const passed = items.filter((i) => i.at <= time);
    return (passed.length ? passed[passed.length - 1] : items[0])?.id ?? null;
  }, [items, time]);

  const toggle = () => {
    if (!loaded) {
      setLoaded(true);
      setUserPaused(false);
      return;
    }
    setUserPaused(playing);
  };

  const toggleSound = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) {
      setLoaded(true);
      setUserPaused(false);
    }
  };

  const btn =
    "inline-flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none";

  const ratioClass = RATIO[ratio] ?? RATIO.portrait;
  return (
    <div className={cn("grid grid-cols-1 gap-6", side && "md:grid-cols-[1.1fr_1fr] md:gap-10 md:items-start")}>
      <div className={cn("relative overflow-hidden rounded-[calc(var(--store-card-radius)+4px)] bg-[var(--store-primary-soft)]", ratioClass)}>
        {poster && <ProductImage src={poster} alt="" ratio="h-full" className="absolute inset-0 size-full !bg-transparent" sizes="(max-width: 768px) 100vw, 55vw" />}
        {src && (
          <>
            <video
              ref={ref}
              src={loaded ? src : undefined}
              muted={muted}
              loop={loop}
              playsInline
              preload="none"
              aria-label={label}
              className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none", playing ? "opacity-100" : "opacity-0")}
            >
              {captions && <track kind="captions" src={captions} srcLang="fr" label="Français" default />}
            </video>
            <div className="absolute bottom-3 right-3 z-[1] flex gap-2">
              <button type="button" onClick={toggleSound} aria-pressed={!muted} aria-label={muted ? `Activer le son : ${label}` : `Couper le son : ${label}`} className={btn}>
                {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
              </button>
              <button type="button" onClick={toggle} aria-pressed={playing} aria-label={playing ? `Mettre en pause : ${label}` : `Lire : ${label}`} className={btn}>
                {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
              </button>
            </div>
          </>
        )}
      </div>
      <ProductList items={items} currentId={currentId} slug={slug} base={base} addLabel={addLabel} side={side} />
    </div>
  );
}

function ProductList({ items, currentId, slug, base, addLabel, side }: { items: TaggedItem[]; currentId: string | null; slug: string; base: string; addLabel: string; side: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={cn("sf-shoppable-list space-y-3", side ? "" : "sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0")}>
      {items.map((p) => {
        const current = p.id === currentId;
        return (
          <li
            key={p.id}
            aria-current={current ? "true" : undefined}
            className={cn(
              "rounded-[min(var(--store-card-radius),18px)] bg-surface p-3 ring-1 transition-shadow duration-200 motion-reduce:transition-none",
              current ? "ring-2 ring-[var(--store-primary)]" : "ring-line",
            )}
          >
            <div className="flex items-center gap-3">
              <Link href={`${base}/p/${p.slug}`} className="flex min-w-0 flex-1 items-center gap-3 group">
                <ProductImage src={p.image ?? undefined} alt="" ratio="aspect-square" className="w-16 shrink-0 rounded-[12px]" sizes="64px" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink group-hover:underline group-hover:underline-offset-4">{p.name}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    <span className="font-semibold text-ink">{p.priceLabel}</span>
                    {p.compareLabel && <s className="ml-2 opacity-70">{p.compareLabel}</s>}
                    {p.note && <span className="ml-2">· {p.note}</span>}
                  </span>
                </span>
              </Link>
              <span className="flex shrink-0 items-center gap-2">
                {p.quickAdd && !p.soldOut && <QuickAddButton slug={slug} line={p.line} label={addLabel} variant="icon" />}
                {p.waHref && (
                  <a
                    href={p.waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Commander ${p.name} sur WhatsApp`}
                    className="inline-flex size-11 items-center justify-center rounded-full bg-whatsapp-deep text-white transition-transform active:scale-95 motion-reduce:transition-none"
                  >
                    <MessageCircle className="size-[18px]" aria-hidden />
                  </a>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
