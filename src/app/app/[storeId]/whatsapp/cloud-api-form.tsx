"use client";

import { useActionState } from "react";
import { saveWhatsappCloud, disconnectWhatsappCloud } from "@/lib/whatsapp/actions";
import { Field, Input } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ConfirmActionButton } from "@/components/app/action-controls";

export function CloudApiForm({ storeId, phoneNumberId, wabaId, hasToken }: { storeId: string; phoneNumberId: string; wabaId: string; hasToken: boolean }) {
  const [state, action] = useActionState(saveWhatsappCloud, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="phoneNumberId" label="Identifiant du numéro (Phone number ID)" required error={fieldError(state, "phoneNumberId")} hint="Meta for Developers, rubrique WhatsApp, Configuration de l'API.">
          {(p) => <Input {...p} name="phoneNumberId" defaultValue={phoneNumberId} inputMode="numeric" autoComplete="off" spellCheck={false} className="font-mono text-sm" />}
        </Field>
        <Field id="wabaId" label="Identifiant du compte (WABA ID)" required error={fieldError(state, "wabaId")} hint="WhatsApp Business Account ID, même page.">
          {(p) => <Input {...p} name="wabaId" defaultValue={wabaId} inputMode="numeric" autoComplete="off" spellCheck={false} className="font-mono text-sm" />}
        </Field>
      </div>
      <Field
        id="token"
        label="Jeton d'accès permanent (System User token)"
        required={!hasToken}
        error={fieldError(state, "token")}
        hint={hasToken ? "Un jeton est déjà enregistré. Laissez vide pour le conserver, saisissez-en un nouveau pour le remplacer." : "Chiffré au repos, jamais réaffiché."}
      >
        {(p) => <Input {...p} name="token" type="password" autoComplete="new-password" spellCheck={false} placeholder={hasToken ? "Jeton enregistré (inchangé)" : "EAAG…"} />}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {hasToken && (
          <ConfirmActionButton
            title="Supprimer la connexion ?"
            description="Les identifiants seront effacés et les notifications automatiques WhatsApp cesseront."
            confirmLabel="Supprimer"
            action={() => disconnectWhatsappCloud(storeId)}
            className={buttonClasses({ variant: "ghost", className: "text-danger hover:bg-danger-soft" })}
          >
            Supprimer la connexion
          </ConfirmActionButton>
        )}
        <SubmitButton>Enregistrer les identifiants</SubmitButton>
      </div>
    </form>
  );
}
