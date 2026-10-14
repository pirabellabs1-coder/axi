"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

export function PrintButton({ backHref }: { backHref: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ButtonLink href={backHref} variant="outline" size="sm" className="h-11 sm:h-9">
        <ArrowLeft className="size-4" aria-hidden /> Retour à la commande
      </ButtonLink>
      <Button size="sm" className="h-11 sm:h-9" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden /> Imprimer
      </Button>
    </div>
  );
}
