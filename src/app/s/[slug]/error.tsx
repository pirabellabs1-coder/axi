"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RotateCw, WifiOff } from "lucide-react";
import { storePath } from "@/components/storefront/format";

/** Erreur dans la vitrine : message clair, réessai, retour boutique. Le panier (local) est conservé. */
export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ slug?: string }>();
  useEffect(() => {
    console.error("[storefront]", error);
  }, [error]);
  return (
    <div className="container-x py-16 sm:py-24">
      <div className="mx-auto flex max-w-md flex-col items-center rounded-[var(--store-card-radius)] bg-surface px-6 py-12 text-center ring-1 ring-line">
        <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink">
          <WifiOff className="size-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">Cette page n'a pas pu s'afficher</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">Vérifiez votre connexion puis réessayez. Votre panier est conservé sur cet appareil.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button type="button" onClick={reset} className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)] active:scale-[0.98]">
            <RotateCw className="size-4" aria-hidden /> Réessayer
          </button>
          {params?.slug && (
            <Link href={storePath(params.slug)} className="inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
              Accueil de la boutique
            </Link>
          )}
        </div>
        {error.digest && <p className="mt-6 font-mono text-[11px] text-ink-faint">Code : {error.digest}</p>}
      </div>
    </div>
  );
}
