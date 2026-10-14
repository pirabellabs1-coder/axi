"use client";

import { useEffect } from "react";
import { cartActions, writeCartNote, writeCartToken } from "./cart-store";

/**
 * Vide le panier local après une commande confirmée — une seule fois par jeton :
 * revenir sur la page merci plus tard ne doit pas effacer un nouveau panier.
 */
export function ClearCart({ slug, token }: { slug: string; token: string }) {
  useEffect(() => {
    const key = `axi:cart-cleared:${slug}:${token}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      /* stockage indisponible : on vide quand même */
    }
    cartActions(slug).clear();
    writeCartToken(slug, null);
    writeCartNote(slug, "");
  }, [slug, token]);
  return null;
}
