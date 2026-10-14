"use client";

import { useActionState } from "react";
import { updateStoreContact } from "@/lib/store/actions";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";

export function ContactForm({
  storeId,
  dialCode,
  defaults,
}: {
  storeId: string;
  dialCode: string;
  defaults: { whatsappNumber: string | null; contactPhone: string | null; contactEmail: string | null; address: string | null; tagline: string | null };
}) {
  const [state, action] = useActionState(updateStoreContact, undefined);
  const local = (e164: string | null) => (e164 && e164.startsWith(dialCode) ? e164.slice(dialCode.length) : e164 ?? "");

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      <FormMessage state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="whatsappNumber" label="Numéro WhatsApp" required hint="Celui qui recevra les commandes de vos clients." error={fieldError(state, "whatsappNumber")}>
          {(p) => (
            <div className="flex items-stretch">
              <span className="inline-flex shrink-0 items-center rounded-l-[var(--radius-md)] bg-surface-2 px-3 text-sm text-ink-muted ring-1 ring-inset ring-line-strong" aria-hidden>
                +{dialCode}
              </span>
              <Input {...p} name="whatsappNumber" type="tel" inputMode="tel" autoComplete="tel-national" defaultValue={local(defaults.whatsappNumber)} className="rounded-l-none" placeholder="01 97 00 00 00" />
            </div>
          )}
        </Field>
        <Field id="contactPhone" label="Téléphone d'appel (optionnel)" error={fieldError(state, "contactPhone")}>
          {(p) => <Input {...p} name="contactPhone" type="tel" inputMode="tel" defaultValue={local(defaults.contactPhone)} autoComplete="tel-national" placeholder="Si différent du WhatsApp" />}
        </Field>
        <Field id="contactEmail" label="E-mail de contact" error={fieldError(state, "contactEmail")} hint="Vous recevrez les notifications de commande ici.">
          {(p) => <Input {...p} name="contactEmail" type="email" inputMode="email" autoComplete="email" defaultValue={defaults.contactEmail ?? ""} />}
        </Field>
        <Field id="tagline" label="Slogan (optionnel)" error={fieldError(state, "tagline")} hint="Une phrase courte affichée sous le nom.">
          {(p) => <Input {...p} name="tagline" maxLength={80} defaultValue={defaults.tagline ?? ""} placeholder="Ex. Pâtisseries fraîches tous les jours" />}
        </Field>
      </div>
      <Field id="address" label="Adresse ou repère (optionnel)" error={fieldError(state, "address")} hint="Affichée aux clients qui choisissent le retrait.">
        {(p) => <Textarea {...p} name="address" rows={2} className="min-h-16" defaultValue={defaults.address ?? ""} placeholder="Ex. Cotonou, Akpakpa, en face de la pharmacie…" />}
      </Field>
      <SubmitButton>Enregistrer les coordonnées</SubmitButton>
    </form>
  );
}
