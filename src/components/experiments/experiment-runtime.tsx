"use client";

import { useEffect } from "react";

/**
 * Lot 4 §13 : balises des tests A/B, côté visiteur.
 *
 *  1. persiste les cookies fonctionnels `axi_vid` (1 an) et `axi_src` (30 jours, premier contact) calculés par le
 *     serveur pour CETTE requête — l'affectation affichée et l'affectation mémorisée sont donc identiques ;
 *  2. compte une EXPOSITION quand la section testée entre réellement dans la vue (IntersectionObserver), une seule
 *     fois par visiteur et par jour (mémoire locale, puis dédoublonnage côté serveur) ;
 *  3. compte les conversions `add_to_cart` (événement `axi:add-to-cart` de la fiche produit) et `checkout_start`
 *     (clic vers la page de commande).
 *
 * Tout passe par `navigator.sendBeacon` : aucune requête bloquante, aucun impact sur le rendu. Le serveur recalcule
 * la variante à partir du cookie : rien de ce qui est envoyé ici ne peut influencer la répartition.
 */

export type RuntimeAssignment = { experimentId: string; anchorId: string };

export type ExperimentRuntimeProps = {
  slug: string;
  visitorId: string;
  /**
   * Valeur SIGNÉE du cookie `axi_vid` (`<id>.<hmac>`), calculée par le serveur (mineur n° 11).
   * L'îlot ne fait que la recopier : il ne peut pas fabriquer d'identifiant accepté.
   */
  visitorCookie: string;
  /** Le cookie `axi_vid` n'existait pas (ou n'était pas signé par ce serveur) : l'îlot le pose. */
  persistVisitor: boolean;
  source: string | null;
  persistSource: boolean;
  assignments: RuntimeAssignment[];
};

const DAY = () => new Date().toISOString().slice(0, 10);

function alreadySent(key: string): boolean {
  try {
    const k = `axi:exp:${key}:${DAY()}`;
    if (window.localStorage.getItem(k)) return true;
    window.localStorage.setItem(k, "1");
    // Ménage léger : on retire les clés d'un autre jour.
    const today = DAY();
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const name = window.localStorage.key(i);
      if (name?.startsWith("axi:exp:") && !name.endsWith(today)) window.localStorage.removeItem(name);
    }
    return false;
  } catch {
    return false; // stockage indisponible : le serveur dédoublonne de toute façon
  }
}

function setCookie(name: string, value: string, maxAge: number) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

export function ExperimentRuntime({ slug, visitorCookie, persistVisitor, source, persistSource, assignments }: ExperimentRuntimeProps) {
  useEffect(() => {
    if (persistVisitor && /^[0-9a-f]{32}\.[0-9a-f]{32}$/.test(visitorCookie)) setCookie("axi_vid", visitorCookie, 365 * 24 * 3600);
    if (persistSource && source && /^[a-z]{4,10}$/.test(source)) setCookie("axi_src", source, 30 * 24 * 3600);
  }, [persistVisitor, visitorCookie, persistSource, source]);

  useEffect(() => {
    if (assignments.length === 0) return;
    const url = `/api/s/${encodeURIComponent(slug)}/events`;

    const send = (events: { t: string; e: string }[]) => {
      if (events.length === 0) return;
      const body = JSON.stringify({ events: events.slice(0, 5) });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
        else void fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain;charset=UTF-8" } });
      } catch {
        /* balise perdue : sans conséquence */
      }
    };

    const convert = (metric: "add_to_cart" | "checkout_start") => {
      const events = assignments.filter((a) => !alreadySent(`${a.experimentId}:${metric}`)).map((a) => ({ t: metric, e: a.experimentId }));
      send(events);
    };

    // 1. Expositions
    let observer: IntersectionObserver | null = null;
    const pending: { t: string; e: string }[] = [];
    if ("IntersectionObserver" in window) {
      const byElement = new Map<Element, string>();
      observer = new IntersectionObserver(
        (entries) => {
          const batch: { t: string; e: string }[] = [];
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const id = byElement.get(entry.target);
            observer?.unobserve(entry.target);
            if (!id || alreadySent(`${id}:exposure`)) continue;
            batch.push({ t: "exposure", e: id });
          }
          send(batch);
        },
        { threshold: 0.25 },
      );
      for (const a of assignments) {
        const el = document.querySelector(`[data-section-id="${CSS.escape(a.anchorId)}"]`);
        if (!el) continue;
        byElement.set(el, a.experimentId);
        observer.observe(el);
      }
    } else {
      for (const a of assignments) if (!alreadySent(`${a.experimentId}:exposure`)) pending.push({ t: "exposure", e: a.experimentId });
      send(pending);
    }

    // 2. Ajout au panier (événement émis par la fiche produit)
    const onAdd = () => convert("add_to_cart");
    window.addEventListener("axi:add-to-cart", onAdd);

    // 3. Départ vers la page de commande
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      try {
        const path = new URL(link.href, window.location.origin).pathname;
        if (/\/commander\/?$/.test(path)) convert("checkout_start");
      } catch {
        /* lien non analysable */
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      observer?.disconnect();
      window.removeEventListener("axi:add-to-cart", onAdd);
      document.removeEventListener("click", onClick, true);
    };
  }, [slug, assignments]);

  return null;
}
