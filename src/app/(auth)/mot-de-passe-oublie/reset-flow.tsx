"use client";

import { useActionState, useState } from "react";
import { requestPasswordReset, resetPassword } from "@/lib/auth/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { Alert } from "@/components/ui/misc";
import { PasswordInput } from "../password-input";

export function ResetFlow() {
  const [email, setEmail] = useState("");
  const [reqState, reqAction] = useActionState(requestPasswordReset, undefined);
  const [resetState, resetAction] = useActionState(resetPassword, undefined);
  const sent = reqState?.ok;

  if (!sent) {
    return (
      <form action={reqAction} className="space-y-5" noValidate>
        <FormMessage state={reqState} toastSuccess={false} />
        <Field id="email" label="Adresse e-mail" error={fieldError(reqState, "email")} required>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="vous@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <SubmitButton className="w-full" size="lg">
          Envoyer le code
        </SubmitButton>
      </form>
    );
  }

  return (
    <form action={resetAction} className="space-y-5" noValidate>
      <Alert tone="success">{reqState.message}</Alert>
      <FormMessage state={resetState} />
      <input type="hidden" name="email" value={email} />
      <Field id="code" label="Code reçu par e-mail" hint={`Envoyé à ${email}.`} error={fieldError(resetState, "code")} required>
        {(p) => <Input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" className="text-center font-mono text-2xl tracking-[0.5em]" autoFocus />}
      </Field>
      <Field id="password" label="Nouveau mot de passe" hint="8 caractères minimum, avec des lettres et des chiffres." error={fieldError(resetState, "password")} required>
        {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" minLength={8} />}
      </Field>
      <SubmitButton className="w-full" size="lg">
        Changer le mot de passe
      </SubmitButton>
    </form>
  );
}
