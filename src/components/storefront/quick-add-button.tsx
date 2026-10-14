"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { cartActions, type CartLine } from "./cart-store";

/**
 * Ajout rapide (produits sans variantes ni options), sans ouvrir le tiroir :
 * pression physique, icône qui se transforme en coche (fondu + léger flou), compteur du panier qui rebondit.
 */
export function QuickAddButton({ slug, line, disabled, label = "Ajouter", variant = "pill" }: { slug: string; line: Omit<CartLine, "key">; disabled?: boolean; label?: string; variant?: "pill" | "icon" }) {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function onClick() {
    cartActions(slug).add(line, { open: false });
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1400);
  }

  const Icon = added ? Check : Plus;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={`${label} : ${line.snapshot.name}`}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 font-semibold shadow-[0_6px_16px_-8px_rgb(0_0_0/0.45)] transition-[transform,background-color,color] duration-200 ease-out active:scale-[0.94] disabled:opacity-50",
          added ? "bg-[#0f6b3f] text-white" : "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]",
          variant === "icon" ? "size-11 rounded-full" : "h-11 rounded-full px-4 text-sm",
        )}
      >
        <Icon key={added ? "ok" : "add"} className="sf-pop size-5" aria-hidden />
        {variant === "pill" && <span>{added ? "Ajouté" : label}</span>}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {added ? `${line.snapshot.name} ajouté au panier.` : ""}
      </span>
    </>
  );
}
