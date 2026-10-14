"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileCheck2, FileMinus2, Printer } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { issueInvoiceAction, issueMissingCreditNotesAction } from "@/lib/tax/actions";

export function InvoiceToolbar({ backHref, printable }: { backHref: string; printable: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ButtonLink href={backHref} variant="outline" size="sm" className="h-11 sm:h-9">
        <ArrowLeft className="size-4" aria-hidden /> Retour à la commande
      </ButtonLink>
      {printable && (
        <Button size="sm" className="h-11 sm:h-9" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Imprimer ou PDF
        </Button>
      )}
    </div>
  );
}

export function IssueInvoiceButton({ storeId, orderId }: { storeId: string; orderId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      className="h-11"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await issueInvoiceAction(storeId, orderId);
          if (r.ok) {
            toast.success(r.message ?? "Facture émise");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      <FileCheck2 className="size-4" aria-hidden /> {pending ? "Émission…" : "Émettre la facture"}
    </Button>
  );
}

export function IssueCreditNotesButton({ storeId, orderId }: { storeId: string; orderId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-11 sm:h-9"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await issueMissingCreditNotesAction(storeId, orderId);
          if (r.ok) {
            toast.success(r.message ?? "Avoirs émis");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      <FileMinus2 className="size-4" aria-hidden /> {pending ? "Émission…" : "Émettre les avoirs manquants"}
    </Button>
  );
}
