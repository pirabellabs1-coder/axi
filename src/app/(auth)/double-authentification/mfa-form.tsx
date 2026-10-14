"use client";

import { useActionState, useState, useTransition } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { cancelMfaLogin, verifyMfaLogin } from "./actions";

export function MfaForm() {
  const [state, action] = useActionState(verifyMfaLogin, undefined);
  const [backup, setBackup] = useState(false);
  const [leaving, startLeave] = useTransition();
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {backup ? (
        <Field id="code" label="Code de secours" hint="Format xxxx-xxxx. Chaque code ne sert qu'une fois." error={fieldError(state, "code")} required>
          {(p) => <Input {...p} key="backup" name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="abcd-efgh" className="text-center font-mono text-lg tracking-[0.2em]" autoFocus />}
        </Field>
      ) : (
        <Field id="code" label="Code de l'application" error={fieldError(state, "code")} required>
          {(p) => <Input {...p} key="totp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" className="text-center font-mono text-2xl tracking-[0.5em]" autoFocus />}
        </Field>
      )}
      <SubmitButton className="w-full" size="lg" trailing={ArrowRight}>
        Vérifier et continuer
      </SubmitButton>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => setBackup((b) => !b)}>
          <KeyRound className="size-4" aria-hidden /> {backup ? "Utiliser l'application" : "Utiliser un code de secours"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-11 text-ink-muted" loading={leaving} onClick={() => startLeave(() => cancelMfaLogin())}>
          Changer de compte
        </Button>
      </div>
    </form>
  );
}
