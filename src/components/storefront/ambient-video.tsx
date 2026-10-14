"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Fichier vidéo direct lisible par `<video>` (pas YouTube / Vimeo : trop lourds pour une ambiance). */
export function isAmbientVideoUrl(v: string | null | undefined): v is string {
  return typeof v === "string" && /^https:\/\/[^\s<>"']+\.(mp4|webm)(\?[^\s<>"']*)?$/i.test(v);
}

/**
 * Vidéo d'ambiance (lot 4 §4, T3) posée sur l'image de couverture (qui reste l'élément du LCP).
 * Le fichier n'est chargé que si : lecture automatique demandée, section visible, animations actives sur la boutique
 * (`[data-motion]` absent sous Save-Data / mode économie / aperçu « Réduire les animations »), et
 * `prefers-reduced-motion` non demandé. Toujours sans son, en boucle, avec un bouton Pause / Lecture (WCAG 2.2.2).
 */
export function AmbientVideo({ src, autoplay, label }: { src: string; autoplay: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(v);
    const allowed = autoplay && !!v.closest("[data-motion]") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (allowed) setLoaded(true);
    return () => io.disconnect();
  }, [autoplay]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !loaded) return;
    if (visible && !userPaused) v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [loaded, visible, userPaused]);

  const toggle = () => {
    if (!loaded) {
      setLoaded(true);
      setUserPaused(false);
      return;
    }
    setUserPaused(playing);
  };

  return (
    <>
      <video
        ref={ref}
        src={loaded ? src : undefined}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none", playing ? "opacity-100" : "opacity-0")}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `Mettre en pause : ${label}` : `Lire : ${label}`}
        className="absolute bottom-3 right-3 z-[1] inline-flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
      </button>
    </>
  );
}
