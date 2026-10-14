"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { retryDomainCharge, retryDomainDns, updateDomainMargin } from "@/lib/domains/admin-actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton } from "@/components/app/action-controls";

export function MarginForm({ percent, minUsd, disabled }: { percent: number; minUsd: number; disabled?: boolean }) {
  const [state, action] = useActionState(updateDomainMargin, undefined);
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} toastSuccess />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="percent" label="Marge (%)" error={fieldError(state, "percent")} hint="Du coût de gros Route 53.">
          {(p) => <Input {...p} name="percent" type="number" inputMode="decimal" min={0} max={300} step="0.01" defaultValue={percent} disabled={disabled} />}
        </Field>
        <Field id="minUsd" label="Minimum par an (USD)" error={fieldError(state, "minUsd")} hint="Converti dans la devise de la boutique.">
          {(p) => <Input {...p} name="minUsd" type="number" inputMode="decimal" min={0} max={1000} step="0.01" defaultValue={minUsd} disabled={disabled} />}
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton disabled={disabled}>Enregistrer la marge</SubmitButton>
      </div>
    </form>
  );
}

export function RetryChargeButton({ chargeId }: { chargeId: string }) {
  const router = useRouter();
  return (
    <ActionButton size="sm" variant="outline" action={() => retryDomainCharge(chargeId)} onDone={(r) => r.ok && router.refresh()}>
      <RefreshCw className="size-4" aria-hidden /> Relancer
    </ActionButton>
  );
}

export function RetryDnsButton({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  return (
    <ActionButton size="sm" variant="outline" action={() => retryDomainDns(registrationId)} onDone={(r) => r.ok && router.refresh()}>
      <RefreshCw className="size-4" aria-hidden /> Configurer
    </ActionButton>
  );
}
