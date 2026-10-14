"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toggleFavorite } from "@/lib/buyer/actions";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Cœur « Favori » (cartes produit et fiche, branché par l'équipe E).
 * Mise à jour optimiste, annulée si le serveur refuse. Non connecté : redirection vers la connexion avec retour.
 *
 *   <FavoriteButton slug={store.slug} productId={p.id} productName={p.name} initial={favoriteIds.has(p.id)} loggedIn={!!buyer} />
 */
export function FavoriteButton({
  slug,
  productId,
  productName,
  initial = false,
  loggedIn = true,
  className,
  size = "md",
  onChange,
}: {
  slug: string;
  productId: string;
  productName: string;
  initial?: boolean;
  loggedIn?: boolean;
  className?: string;
  size?: "sm" | "md";
  onChange?: (favorited: boolean) => void;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  const goLogin = () => {
    const back = typeof window !== "undefined" ? window.location.pathname : `/s/${slug}`;
    router.push(`/s/${slug}/compte/connexion?next=${encodeURIComponent(back)}`);
  };

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Retirer ${productName} des favoris` : `Ajouter ${productName} aux favoris`}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!loggedIn) return goLogin();
        const next = !on;
        setOn(next);
        start(async () => {
          const r = await toggleFavorite(slug, productId);
          if (!r.ok) {
            setOn(!next);
            if (/session|connect/i.test(r.error)) return goLogin();
            toast.error(r.error);
            return;
          }
          const fav = r.data?.favorited ?? next;
          setOn(fav);
          onChange?.(fav);
        });
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-surface/90 text-ink shadow-[var(--shadow-card)] ring-1 ring-line backdrop-blur-sm transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-70 motion-reduce:transition-none",
        size === "sm" ? "size-10" : "size-11",
        className,
      )}
    >
      <Heart className={cn("size-[18px] transition-colors", on ? "fill-[var(--store-primary)] text-[var(--store-primary)]" : "")} aria-hidden />
    </button>
  );
}
