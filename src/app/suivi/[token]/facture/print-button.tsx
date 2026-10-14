"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintInvoiceButton() {
  return (
    <Button size="sm" className="h-11" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Imprimer ou enregistrer en PDF
    </Button>
  );
}
