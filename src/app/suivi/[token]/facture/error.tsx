"use client";

import { Button } from "@/components/ui/button";

export default function InvoiceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-ink">Impossible d&apos;afficher la facture</h1>
      <p className="mt-2 text-sm text-ink-muted">Réessayez dans un instant. Si le problème persiste, contactez la boutique.</p>
      <Button className="mt-6 h-11" onClick={reset}>
        Réessayer
      </Button>
    </div>
  );
}
