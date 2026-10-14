"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { changeStoreCurrency } from "@/lib/store/actions";
import { Field, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { CURRENCY_LOCKED_MESSAGE, STORE_CURRENCY_OPTIONS, storeCurrencyLabel } from "@/lib/currency/store-currencies";

/** Devise de la boutique : modifiable tant qu'aucune commande ni carte cadeau n'existe (contrôle refait côté serveur). */
export function CurrencyForm({ storeId, currency, locked }: { storeId: string; currency: string; locked: boolean }) {
  const [state, action] = useActionState(changeStoreCurrency, undefined);
  if (locked) {
    return (
      <div className="space-y-2">
        <p className="inline-flex items-center gap-2 font-medium text-ink">
          <Lock className="size-4 text-ink-muted" aria-hidden /> {storeCurrencyLabel(currency)}
        </p>
        <p className="text-sm text-ink-muted">{CURRENCY_LOCKED_MESSAGE}</p>
      </div>
    );
  }
  return (
    <form action={action} noValidate className="space-y-4">
      <input type="hidden" name="storeId" value={storeId} />
      <FormMessage state={state} />
      <Field id="currency" label="Devise de la boutique" error={fieldError(state, "currency")} hint="Modifiable tant que vous n'avez reçu aucune commande.">
        {(p) => (
          <Select {...p} name="currency" defaultValue={currency} className="sm:max-w-80">
            {STORE_CURRENCY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Alert tone="warning" title="Vos montants ne sont pas convertis">
        Les prix, frais de livraison et seuils déjà saisis gardent leur valeur numérique dans la nouvelle devise. Vérifiez-les après le changement.
      </Alert>
      <SubmitButton>Changer la devise</SubmitButton>
    </form>
  );
}
