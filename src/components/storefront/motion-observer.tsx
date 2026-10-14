"use client";

import { useEffect } from "react";

const TARGET = "[data-anim]:not([data-in-view])";

/**
 * Lot 4 §2 : apparition au défilement (un seul composant client par page, contrat `src/lib/theme-engine/motion.ts`).
 *  - au montage, les sections déjà visibles reçoivent `data-in-view` AVANT `data-motion-ready` sur la racine :
 *    rien de ce qui est à l'écran ne disparaît puis réapparaît (pas de flash, pas d'impact sur le LCP) ;
 *  - les autres sont observées (IntersectionObserver) et marquées une seule fois, puis libérées ;
 *  - un MutationObserver (regroupé par image) prend en charge les sections ajoutées ensuite (navigation, aperçu).
 * Sans JavaScript, ou si ce composant n'est pas rendu (Save-Data, mode économie, aperçu « Réduire les animations »),
 * `data-motion-ready` n'est jamais posé et rien n'est masqué. Aucun écouteur de défilement.
 */
export function MotionObserver() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-store][data-motion]");
    if (!root || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in-view", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    const scan = (initial: boolean) => {
      const els = root.querySelectorAll<HTMLElement>(TARGET);
      // Lectures groupées puis écritures (aucune mise en page forcée en boucle).
      const vh = window.innerHeight;
      const visible = initial ? Array.from(els, (el) => el.getBoundingClientRect().top < vh) : [];
      els.forEach((el, i) => {
        if (initial && visible[i]) el.setAttribute("data-in-view", "");
        else io.observe(el);
      });
    };

    scan(true);
    root.setAttribute("data-motion-ready", "");

    let frame = 0;
    const mo = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scan(false);
      });
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
      root.removeAttribute("data-motion-ready");
    };
  }, []);
  return null;
}
