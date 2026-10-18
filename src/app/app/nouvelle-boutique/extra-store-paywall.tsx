"use client";

import { useActionState } from "react";
import { CreditCard } from "lucide-react";
import { purchaseExtraStoreSlot } from "@/lib/addons/actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

/** Bouton « Payer » : crée (ou réutilise) la facture d'option « Boutique en plus » puis redirige vers elle. */
export function PayExtraStoreButton({ label }: { label: string }) {
  const [state, action] = useActionState(purchaseExtraStoreSlot, undefined);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <SubmitButton variant="primary" size="lg" trailing={CreditCard}>
        {label}
      </SubmitButton>
    </form>
  );
}
