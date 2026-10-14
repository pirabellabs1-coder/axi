"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { updateDeveloperProfile } from "@/lib/apps/dev-actions";

export function ProfileForm({ defaultName, disabled }: { defaultName: string; disabled?: boolean }) {
  const [state, action] = useActionState(updateDeveloperProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field id="developerName" label="Nom de développeur public" required error={fieldError(state, "developerName")} hint="Votre nom ou celui de votre société.">
        {(p) => <Input {...p} name="developerName" defaultValue={defaultName} maxLength={80} autoComplete="organization" disabled={disabled} />}
      </Field>
      <SubmitButton disabled={disabled}>Enregistrer</SubmitButton>
    </form>
  );
}
