"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Impression de l'étiquette par le navigateur (aucun PDF à générer côté serveur). */
export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Imprimer
    </Button>
  );
}
