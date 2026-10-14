"use client";

import { useActionState, useState } from "react";
import { updateTaxSettings } from "@/lib/tax/actions";
import type { TaxRegistration } from "@/lib/tax/registration";
import { TAX_REGIMES, TAX_REGIME_LABELS, DEFAULT_EXEMPTION_MENTION } from "@/config/taxes";
import { Field, Input, Select, Checkbox, Switch } from "@/components/ui/field";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function TaxSettingsForm({
  storeId,
  taxesEnabled,
  pricesIncludeTax,
  registration,
  locked,
  invoicesInPlan,
}: {
  storeId: string;
  taxesEnabled: boolean;
  pricesIncludeTax: boolean;
  registration: TaxRegistration;
  locked: boolean;
  invoicesInPlan: boolean;
}) {
  const [state, action] = useActionState(updateTaxSettings, undefined);
  const [enabled, setEnabled] = useState(taxesEnabled);
  const [regime, setRegime] = useState(registration.regime);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="storeId" value={storeId} />
      <FormMessage state={state} />

      <div className="space-y-1">
        <Switch name="taxesEnabled" checked={enabled} onChange={setEnabled} disabled={locked && !enabled} label="Collecter la TVA sur mes ventes" />
        <p className="text-sm text-ink-muted">Désactivé : aucune taxe n&apos;est calculée et vos factures portent la mention d&apos;exonération.</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-ink">Mes prix sont saisis</legend>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input type="radio" name="pricesIncludeTax" value="true" defaultChecked={pricesIncludeTax} className="mt-0.5 size-5 accent-[var(--c-primary)]" />
          <span>
            <span className="font-medium text-ink">Toutes taxes comprises (TTC)</span>
            <span className="block text-ink-muted">Usage courant en Afrique francophone : le prix affiché est le prix payé, « dont TVA ».</span>
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input type="radio" name="pricesIncludeTax" value="false" defaultChecked={!pricesIncludeTax} className="mt-0.5 size-5 accent-[var(--c-primary)]" />
          <span>
            <span className="font-medium text-ink">Hors taxes (HT)</span>
            <span className="block text-ink-muted">La TVA s&apos;ajoute au total du panier. Changer ce choix modifie le prix payé de tous vos produits.</span>
          </span>
        </label>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="regime" label="Régime fiscal" error={fieldError(state, "regime")}>
          {(p) => (
            <Select {...p} name="regime" value={regime} onChange={(e) => setRegime(e.target.value as TaxRegistration["regime"])}>
              {TAX_REGIMES.map((r) => (
                <option key={r} value={r}>
                  {TAX_REGIME_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="legalName" label="Raison sociale" hint="Nom légal imprimé sur les factures." error={fieldError(state, "legalName")}>
          {(p) => <Input {...p} name="legalName" defaultValue={registration.legalName} maxLength={160} autoComplete="organization" />}
        </Field>
        <Field id="taxId" label="Numéro fiscal (IFU, NIF…)" required={enabled && regime === "TVA"} error={fieldError(state, "taxId")}>
          {(p) => <Input {...p} name="taxId" defaultValue={registration.taxId} maxLength={60} />}
        </Field>
        <Field id="rccm" label="RCCM" hint="Registre du commerce, si vous en avez un." error={fieldError(state, "rccm")}>
          {(p) => <Input {...p} name="rccm" defaultValue={registration.rccm} maxLength={60} />}
        </Field>
        <div className="sm:col-span-2">
          <Field id="address" label="Adresse du siège" hint="Par défaut, l'adresse de la boutique." error={fieldError(state, "address")}>
            {(p) => <Input {...p} name="address" defaultValue={registration.address} maxLength={300} autoComplete="street-address" />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            id="exemptionMention"
            label="Mention d'exonération"
            hint={regime === "TPS" || !enabled ? `Imprimée sur vos factures. Par défaut : « ${DEFAULT_EXEMPTION_MENTION} ».` : "Imprimée sur les factures comportant des articles exonérés."}
            error={fieldError(state, "exemptionMention")}
          >
            {(p) => <Input {...p} name="exemptionMention" defaultValue={registration.exemptionMention} maxLength={200} placeholder={DEFAULT_EXEMPTION_MENTION} />}
          </Field>
        </div>
      </div>

      <Checkbox
        name="autoIssueInvoices"
        defaultChecked={registration.autoIssueInvoices}
        label="Émettre la facture automatiquement au paiement"
        description={invoicesInPlan ? "Sinon, émettez-la depuis la commande. Un avoir est émis à chaque remboursement d'une commande facturée." : "Les factures numérotées ne sont pas incluses dans votre plan."}
      />

      <SubmitButton className="h-11 w-full sm:w-auto">Enregistrer</SubmitButton>
    </form>
  );
}
