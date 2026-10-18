"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Play, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { liveEmbed, PLATFORM_LABELS } from "@/lib/social/live-embed";
import { cartActions } from "../cart-store";

/**
 * Lecteur du direct dans la section « Direct » (live-shopping) : façade cliquable, puis iframe officielle de la
 * plateforme (src/lib/social/live-embed.ts ; origines autorisées dans frame-src, next.config.ts).
 *  - rien n'est chargé chez la plateforme avant le clic (vie privée, données mobiles) ;
 *  - bouton de 48 px avec libellé explicite, iframe titrée, plein écran autorisé, `prefers-reduced-motion` respecté ;
 *  - lien de secours « Ouvrir sur … » toujours présent (directs TikTok et Instagram non intégrables).
 */
export function LivePlayer({ streamUrl, title }: { streamUrl: string; title: string }) {
  const embed = liveEmbed(streamUrl);
  const [on, setOn] = useState(false);
  if (!embed) return null;
  const label = PLATFORM_LABELS[embed.platform] ?? embed.platform;
  return (
    <div
      className={cn(
        "relative mt-4 w-full overflow-hidden rounded-[14px] bg-black",
        embed.vertical ? "mx-auto aspect-[9/16] max-h-[70vh] max-w-[min(100%,calc(70vh*9/16))]" : "aspect-video",
      )}
    >
      {on ? (
        <iframe
          src={embed.src}
          title={`Direct ${label} : ${title}`}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button
          type="button"
          onClick={() => setOn(true)}
          className="group absolute inset-0 flex size-full flex-col items-center justify-center gap-3 text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--store-primary)]"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/40 transition-transform group-hover:scale-105 motion-reduce:transition-none">
            <Play className="size-7 translate-x-0.5" aria-hidden />
          </span>
          <span className="px-4 text-center text-sm font-semibold">Lire le direct ici</span>
          <span className="px-4 text-center text-xs text-white/75">Lecteur {label} : chargé seulement après ce clic.</span>
        </button>
      )}
    </div>
  );
}

export type LiveCartInfo = { id: string; slug: string; name: string; price: number; image: string | null; minQty: number; quickAdd: boolean };

/**
 * Informations d'ajout au panier des produits du direct (`/s/{slug}/feeds/live-products.json`), relues quand la
 * liste des produits change (même cadence que le rafraîchissement du produit épinglé, sans requête si rien ne change).
 */
export function useLiveCart(slug: string, ids: string[]): Map<string, LiveCartInfo> {
  const [map, setMap] = useState<Map<string, LiveCartInfo>>(new Map());
  const key = ids.slice(0, 12).join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/s/${slug}/feeds/live-products.json?ids=${encodeURIComponent(key)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { products?: LiveCartInfo[] };
        if (!cancelled) setMap(new Map((data.products ?? []).map((p) => [p.id, p])));
      } catch {
        /* réseau indisponible : les liens « Voir » restent utilisables */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, key]);
  return map;
}

/** Bouton « Ajouter » (produit simple) : ajout rapide sans quitter le direct, annonce pour lecteur d'écran. */
export function LiveAddButton({ slug, info }: { slug: string; info: LiveCartInfo }) {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const add = () => {
    cartActions(slug).add(
      { productId: info.id, variantId: null, optionIds: [], quantity: info.minQty, snapshot: { name: info.name, variantName: null, unitPrice: info.price, image: info.image, productSlug: info.slug } },
      { open: false },
    );
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1800);
  };
  return (
    <>
      <button
        type="button"
        onClick={add}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-[var(--store-primary)] px-4 text-sm font-semibold text-[var(--store-primary-contrast)] transition-transform active:scale-[0.98] motion-reduce:transition-none"
      >
        {added ? <Check className="size-4" aria-hidden /> : <ShoppingBag className="size-4" aria-hidden />}
        {added ? "Ajouté" : "Ajouter"}
        <span className="sr-only"> {info.name} au panier</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {added ? `${info.name} ajouté au panier.` : ""}
      </span>
    </>
  );
}
