"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { reorder } from "@/lib/buyer/actions";
import { cartActions } from "@/components/storefront/cart-store";
import { btnClass } from "@/components/storefront/ui";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * « Commander à nouveau » : le serveur reconstruit les lignes encore disponibles (prix actuels), elles sont
 * ajoutées au panier local, puis l'acheteur arrive sur le panier. Les articles ignorés sont signalés.
 */
export function ReorderButton({ slug, reference, className }: { slug: string; reference: string; className?: string }) {
  const [pending, start] = useTransition();
  const [skipped, setSkipped] = useState<string[]>([]);
  const router = useRouter();
  return (
    <div className={className}>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          start(async () => {
            const r = await reorder(slug, reference);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            const cart = cartActions(slug);
            for (const line of r.data?.lines ?? []) cart.add(line, { open: false });
            const sk = r.data?.skipped ?? [];
            setSkipped(sk);
            toast.success("Articles ajoutés au panier", sk.length ? `${sk.length} indisponible${sk.length > 1 ? "s" : ""} ignoré${sk.length > 1 ? "s" : ""}.` : undefined);
            if (!sk.length) router.push(`/s/${slug}/panier`);
          })
        }
        className={cn(btnClass("solid", "lg"), "w-full active:scale-[0.98] disabled:opacity-60 sm:w-auto")}
      >
        {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
        Commander à nouveau
      </button>
      {skipped.length > 0 && (
        <div role="status" className="mt-3 rounded-[12px] bg-sun-soft px-4 py-3 text-sm text-ink">
          <p className="font-medium">Ces articles ne sont plus disponibles et n&apos;ont pas été ajoutés :</p>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">
            {skipped.map((s, i) => (
              <li key={`${s}-${i}`}>{s}</li>
            ))}
          </ul>
          <button type="button" onClick={() => router.push(`/s/${slug}/panier`)} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
            Voir mon panier
          </button>
        </div>
      )}
    </div>
  );
}
