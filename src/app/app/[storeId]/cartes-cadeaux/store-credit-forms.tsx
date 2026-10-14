"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus } from "lucide-react";
import { grantStoreCredit, deductStoreCredit } from "@/lib/store-credit/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";

/**
 * Formulaires « Créditer / Débiter l'avoir » du panneau Avoir de la fiche client
 * (src/app/app/[storeId]/clients/[customerId]/store-credit-panel.tsx). Propriété : équipe C.
 */
function CreditForm({ storeId, customerId, unit, mode, close }: { storeId: string; customerId: string; unit: string; mode: "grant" | "deduct"; close: () => void }) {
  const [state, action] = useActionState(mode === "grant" ? grantStoreCredit : deductStoreCredit, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      close();
      router.refresh();
    }
  }, [state, close, router]);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="customerId" value={customerId} />
      <Field id={`sc-amount-${mode}`} label={`Montant (${unit})`} required error={fieldError(state, "amount")}>
        {(p) => <Input {...p} name="amount" inputMode="numeric" autoComplete="off" />}
      </Field>
      <Field id={`sc-reason-${mode}`} label="Motif" required hint="Visible dans le journal d'avoir et l'audit." error={fieldError(state, "reason")}>
        {(p) => <Input {...p} name="reason" maxLength={300} placeholder={mode === "grant" ? "Geste commercial, retard de livraison…" : "Correction, utilisé en boutique…"} />}
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant={mode === "grant" ? "primary" : "danger"}>{mode === "grant" ? "Créditer" : "Débiter"}</SubmitButton>
      </div>
    </form>
  );
}

export function StoreCreditButtons({ storeId, customerId, unit, canGrant, canDeduct }: { storeId: string; customerId: string; unit: string; canGrant: boolean; canDeduct: boolean }) {
  const [mode, setMode] = useState<null | "grant" | "deduct">(null);
  const close = () => setMode(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canGrant && (
          <Button type="button" size="sm" variant="outline" onClick={() => setMode("grant")}>
            <Plus className="size-4" aria-hidden /> Créditer
          </Button>
        )}
        {canDeduct && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("deduct")}>
            <Minus className="size-4" aria-hidden /> Débiter
          </Button>
        )}
      </div>
      <Dialog open={mode !== null} onClose={close} title={mode === "deduct" ? "Débiter l'avoir" : "Créditer l'avoir"} size="sm">
        {mode && <CreditForm key={mode} storeId={storeId} customerId={customerId} unit={unit} mode={mode} close={close} />}
      </Dialog>
    </>
  );
}
