"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rafraîchissement simple de la boîte : router.refresh() toutes les `intervalMs` quand l'onglet
 * est visible, et immédiatement au retour sur l'onglet. Les composants client gardent leur état
 * (brouillon du composer conservé).
 *
 * Choix assumé (skill realtime-websockets : « le transport le plus simple qui marche ») : les
 * messages entrants arrivent par le webhook Meta, donc un polling de 10 s suffit au MVP sans
 * infrastructure WebSocket. Évolution prévue : un flux SSE par boutique alimenté par le webhook
 * /api/webhooks/whatsapp (pub/sub Redis en multi-instance) rendra la boîte temps réel.
 */
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 3_000) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
