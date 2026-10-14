"use client";

import { useEffect } from "react";

/**
 * Révèle les `.reveal` de la page courante (le RevealObserver du layout ne s'exécute qu'au premier
 * chargement ; celui-ci couvre les navigations côté client). Reduced-motion géré par le CSS global.
 */
export function RevealScope() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-mk] .reveal:not(.is-visible)"));
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return null;
}
