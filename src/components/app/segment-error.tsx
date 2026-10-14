"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Écran d'erreur commun aux segments de l'espace marchand (utilisé par chaque error.tsx). */
export function SegmentError({ error, reset, title = "Une erreur est survenue" }: { error: Error & { digest?: string }; reset: () => void; title?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center rounded-[var(--radius-lg)] border border-line bg-surface px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <span className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1.5 text-sm text-ink-muted">Nous n&apos;avons pas pu charger cette page. Vérifiez votre connexion puis réessayez.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">Réf. {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        Réessayer
      </Button>
    </div>
  );
}
