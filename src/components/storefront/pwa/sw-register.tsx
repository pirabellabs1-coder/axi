"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker de la boutique (lot 4 §14) et lui annonce le mode économie de données.
 * Rien n'est enregistré hors contexte sûr (http non local), dans un cadre d'aperçu (`iframe`), ni si le
 * navigateur ne gère pas les service workers : la boutique fonctionne exactement comme avant.
 */
export function SwRegister({ scope, lite }: { scope: string; lite: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (window.top !== window.self) return; // aperçu de l'éditeur
    let cancelled = false;
    const tell = (reg: ServiceWorkerRegistration) => {
      (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "axi:lite", lite });
    };
    navigator.serviceWorker
      .register(`${scope}sw.js`, { scope })
      .then((reg) => {
        if (cancelled) return;
        tell(reg);
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (sw.state === "activated") tell(reg);
          });
        });
      })
      .catch(() => {
        /* portée refusée ou navigation privée : la boutique reste utilisable, simplement non installable */
      });
    return () => {
      cancelled = true;
    };
  }, [scope, lite]);
  return null;
}
