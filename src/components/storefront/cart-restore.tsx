"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { RenderData } from "@/lib/storefront/render-types";
import { cartActions, replaceCart, writeCartToken } from "./cart-store";

/**
 * Reprise d'un panier depuis le lien de relance (`?panier=jeton`) : les articles encore en vente (vérifiés
 * côté serveur par loadCartDraft) remplacent le panier local, le jeton est conservé jusqu'à la commande.
 */
export function CartRestore({ slug, restored, drawer }: { slug: string; restored: NonNullable<RenderData["restoredCart"]>; drawer: boolean }) {
  const done = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if ("error" in restored) {
      setMsg(restored.error);
    } else if (restored.lines.length) {
      replaceCart(slug, restored.lines);
      writeCartToken(slug, restored.token);
      setMsg("Votre panier a été restauré.");
      if (drawer) cartActions(slug).openSheet();
    } else {
      setMsg("Les articles de ce panier ne sont plus disponibles.");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("panier");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [slug, restored, drawer]);
  if (!msg) return null;
  return (
    <div role="status" className="sf-pop fixed inset-x-3 top-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-[14px] bg-ink px-4 py-3 text-sm text-canvas shadow-[var(--shadow-lg)]">
      <p className="flex-1">{msg}</p>
      <button type="button" onClick={() => setMsg(null)} aria-label="Fermer" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/10">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
