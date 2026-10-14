"use client";

import { useActionState, useState } from "react";
import { saveReturnPolicy } from "@/lib/returns/actions";
import type { ReturnPolicy } from "@/lib/returns/policy";
import { Field, Input, Select, Textarea, Checkbox, Switch } from "@/components/ui/field";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function ReturnPolicyForm({ storeId, policy, locked }: { storeId: string; policy: ReturnPolicy; locked: boolean }) {
  const [state, action] = useActionState(saveReturnPolicy, undefined);
  const [enabled, setEnabled] = useState(policy.enabled);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="storeId" value={storeId} />
      <FormMessage state={state} />
      <Switch name="enabled" checked={enabled} onChange={setEnabled} disabled={locked && !enabled} label="Accepter les demandes de retour en ligne" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id="windowDays" label="Délai (jours après livraison)" required error={fieldError(state, "windowDays")}>
          {(p) => <Input {...p} name="windowDays" type="number" inputMode="numeric" min={1} max={90} defaultValue={policy.windowDays} />}
        </Field>
        <Field id="restockingFeePercent" label="Frais de remise en stock (%)" hint="0 à 30 %" error={fieldError(state, "restockingFeePercent")}>
          {(p) => <Input {...p} name="restockingFeePercent" type="number" inputMode="numeric" min={0} max={30} defaultValue={policy.restockingFeePercent} />}
        </Field>
        <Field id="storeCreditBonusPercent" label="Bonus si avoir (%)" hint="0 à 20 %, incite à garder la valeur chez vous" error={fieldError(state, "storeCreditBonusPercent")}>
          {(p) => <Input {...p} name="storeCreditBonusPercent" type="number" inputMode="numeric" min={0} max={20} defaultValue={policy.storeCreditBonusPercent} />}
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-ink">Résolutions proposées au client</legend>
        <Checkbox name="allowRefund" defaultChecked={policy.allowRefund} label="Remboursement" description="Uniquement si la commande a été payée." />
        <Checkbox name="allowStoreCredit" defaultChecked={policy.allowStoreCredit} label="Avoir" description="Crédité sur le compte client, utilisable à la prochaine commande." />
        <Checkbox name="allowExchange" defaultChecked={policy.allowExchange} label="Échange" description="Autre taille ou couleur, au prix actuel." />
        {fieldError(state, "allowRefund") && <p className="text-sm text-danger">{fieldError(state, "allowRefund")}</p>}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="returnShippingPaidBy" label="Frais de retour à la charge de">
          {(p) => (
            <Select {...p} name="returnShippingPaidBy" defaultValue={policy.returnShippingPaidBy}>
              <option value="customer">Client</option>
              <option value="merchant">Boutique</option>
            </Select>
          )}
        </Field>
        <Field id="nonReturnableTags" label="Étiquettes non retournables" hint="Séparées par des virgules, ex. soldes, sous-vêtements">
          {(p) => <Input {...p} name="nonReturnableTags" defaultValue={policy.nonReturnableTags.join(", ")} maxLength={2000} />}
        </Field>
      </div>
      <Checkbox name="requirePhotos" defaultChecked={policy.requirePhotos} label="Exiger au moins une photo" description="Le client joint jusqu'à 3 photos des articles." />
      <Field id="instructions" label="Instructions envoyées après approbation" hint="Adresse de dépôt, horaires, emballage. 1 000 caractères maximum." error={fieldError(state, "instructions")}>
        {(p) => <Textarea {...p} name="instructions" rows={4} maxLength={1000} defaultValue={policy.instructions} />}
      </Field>
      <SubmitButton className="h-11 w-full sm:w-auto">Enregistrer</SubmitButton>
    </form>
  );
}
