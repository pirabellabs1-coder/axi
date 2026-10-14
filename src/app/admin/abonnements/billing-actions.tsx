"use client";

import { useState, useTransition } from "react";
import type { SubscriptionStatus } from "@prisma/client";
import { CheckCircle2, XCircle } from "lucide-react";
import { markInvoicePaid, voidInvoice, setSubscriptionStatus } from "@/lib/admin/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, onOk?: () => void) =>
    new Promise<void>((resolve) => {
      start(async () => {
        const res = await fn();
        if (res.ok) {
          toast.success(res.message ?? "Enregistré");
          onOk?.();
        } else toast.error(res.error);
        resolve();
      });
    });
  return { pending, run };
}

export function InvoiceActions({ invoiceId, number, status, kind = "plan" }: { invoiceId: string; number: string; status: string; kind?: "plan" | "addon" }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  if (status === "PAID" || status === "VOID") return <span className="text-xs text-ink-faint">-</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button size="sm" variant="primary" onClick={() => setOpen(true)} disabled={pending}>
        <CheckCircle2 className="size-4" aria-hidden /> Marquer payée
      </Button>
      <ConfirmButton
        title={`Annuler la facture ${number}`}
        description="La facture passe en statut « Annulée ». L'abonnement n'est pas modifié."
        confirmLabel="Annuler la facture"
        disabled={pending}
        onConfirm={() => run(() => voidInvoice(invoiceId))}
        className={buttonClasses({ variant: "ghost", size: "sm" })}
      >
        <XCircle className="size-4" aria-hidden /> Annuler
      </ConfirmButton>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Marquer ${number} comme payée`}
        description={kind === "addon" ? "La facture passe en payée et l'option est activée : crédits ajoutés au portefeuille pour un pack, échéance calculée pour une option récurrente." : "La facture passe en payée et l'abonnement devient actif sur la période de la facture."}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button loading={pending} onClick={() => run(() => markInvoicePaid(invoiceId, ref), () => setOpen(false))}>Confirmer le paiement</Button>
          </>
        }
      >
        <Field id={`ref-${invoiceId}`} label="Référence du paiement" hint="Facultatif : ID de transaction Mobile Money, virement, etc.">
          {(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ex. MP240101.1234.A56789" />}
        </Field>
      </Dialog>
    </div>
  );
}

const STATUSES: { value: SubscriptionStatus; label: string }[] = [
  { value: "TRIALING", label: "Essai" },
  { value: "ACTIVE", label: "Actif" },
  { value: "PAST_DUE", label: "Impayé" },
  { value: "SUSPENDED", label: "Suspendu" },
  { value: "CANCELLED", label: "Annulé" },
];

export function SubscriptionStatusSelect({ subscriptionId, status }: { subscriptionId: string; status: SubscriptionStatus }) {
  const { pending, run } = useRun();
  return (
    <select
      aria-label="Changer le statut de l'abonnement"
      value={status}
      disabled={pending}
      onChange={(e) => run(() => setSubscriptionStatus(subscriptionId, e.target.value as SubscriptionStatus))}
      className="h-9 rounded-[var(--radius-md)] border border-line-strong bg-surface px-2 text-sm text-ink disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  );
}
