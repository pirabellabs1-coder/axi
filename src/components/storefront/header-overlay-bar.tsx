"use client";

import { useEffect, useRef, useState } from "react";

/**
 * En-tête transparent superposé à la bannière : l'en-tête collant chevauche la 1re section (marge négative, CSS),
 * sans la pousser vers le bas. Ce wrapper client ne gère QUE l'état « défilé » : il bascule `data-overlay-state`
 * de « top » (transparent, texte clair) à « pinned » (opaque, style actuel) une fois dépassée ~1 hauteur d'en-tête.
 *
 * Il n'introduit aucune boîte (`display:contents`) : la mise en page et le collant de l'en-tête serveur sont
 * inchangés. Logique minimale : écouteur `scroll` passif lu dans un `requestAnimationFrame` (pas de thrash).
 * Le style/la transition viennent du CSS de `store-styles` (`prefers-reduced-motion` y coupe la transition).
 */
export function HeaderOverlayBar({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const header = el.querySelector<HTMLElement>(".sf-header-overlay");
    let raf = 0;
    const update = () => {
      raf = 0;
      // Seuil ≈ hauteur de l'en-tête : transparent tant que la bannière est encore sous l'en-tête.
      const threshold = Math.max(48, (header?.offsetHeight ?? 64) * 0.6);
      setPinned(window.scrollY > threshold);
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div ref={ref} style={{ display: "contents" }} data-overlay-state={pinned ? "pinned" : "top"}>
      {children}
    </div>
  );
}
