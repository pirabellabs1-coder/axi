"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus } from "lucide-react";
import { setStockLevel } from "@/lib/products/actions";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { canDecrement, quickStockTarget, sanitizeStockInput, stepStock } from "@/lib/inventory/quick-stock";

/** Ajustement rapide en ligne : nouvelle quantité absolue, enregistrée comme mouvement de stock audité. */
export function QuickStock({ storeId, productId, variantId, stock, label }: { storeId: string; productId: string; variantId: string | null; stock: number; label: string }) {
  const [value, setValue] = useState(String(stock));
  const [pending, start] = useTransition();
  const router = useRouter();
  const target = quickStockTarget(value, stock);
  const changed = target != null;
  const n = target ?? stock;

  const save = () => {
    if (!changed) return;
    start(async () => {
      const r = await setStockLevel(storeId, { productId, variantId, quantity: n });
      if (r.ok) {
        toast.success(`${label} : ${n} en stock`, `Mouvement ${n - stock > 0 ? "+" : ""}${n - stock} enregistré.`);
        router.refresh();
      } else {
        toast.error("Ajustement impossible", r.error);
        setValue(String(stock));
      }
    });
  };

  // Stock négatif (survente) : « + » remonte normalement, « − » désactivé à zéro ou moins.
  const step = (d: 1 | -1) => setValue(stepStock(value, d));

  return (
    <form
      className="flex items-center justify-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <button type="button" onClick={() => step(-1)} disabled={!canDecrement(value)} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35 sm:size-8" aria-label={`Retirer une unité à ${label}`}>
        <Minus className="size-3.5" aria-hidden />
      </button>
      <label className="sr-only" htmlFor={`qs-${variantId ?? productId}`}>
        Quantité en stock de {label}
      </label>
      <input
        id={`qs-${variantId ?? productId}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(sanitizeStockInput(e.target.value))}
        onKeyDown={(e) => e.key === "Escape" && setValue(String(stock))}
        className={cn(
          "tabular h-11 w-20 rounded-[10px] bg-surface px-2 text-center text-sm text-ink ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-primary sm:h-9",
          changed && "ring-primary",
          stock <= 0 && !changed && "text-danger",
        )}
      />
      <button type="button" onClick={() => step(1)} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label={`Ajouter une unité à ${label}`}>
        <Plus className="size-3.5" aria-hidden />
      </button>
      <button
        type="submit"
        disabled={!changed || pending}
        className={cn(
          "inline-flex h-11 items-center gap-1 rounded-full px-3 text-xs font-medium transition-[opacity,transform] active:scale-[0.97] sm:h-8",
          changed ? "bg-primary text-on-primary" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!changed}
        tabIndex={changed ? 0 : -1}
      >
        <Check className="size-3.5" aria-hidden /> {pending ? "…" : "Valider"}
      </button>
    </form>
  );
}
