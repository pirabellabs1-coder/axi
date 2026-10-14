"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Révélation au scroll des éléments `.reveal` (IntersectionObserver ; reduced-motion géré en CSS).
 * Relancé à chaque changement de page et pour les éléments ajoutés plus tard (MutationObserver),
 * sinon le contenu d'une page atteinte par navigation client resterait invisible.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    // Les pages marketplace ont leur propre RevealScope, rendu dans leur sous-arbre : les couvrir ici aussi
    // ferait muter des éléments pas encore hydratés (avertissement d'hydratation React).
    const pending = () => Array.from(document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)")).filter((el) => !el.closest("[data-mk]"));
    if (!("IntersectionObserver" in window)) {
      pending().forEach((e) => e.classList.add("is-visible"));
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
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const observeAll = () => pending().forEach((e) => io.observe(e));
    observeAll();
    const mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, [pathname]);

  return null;
}
