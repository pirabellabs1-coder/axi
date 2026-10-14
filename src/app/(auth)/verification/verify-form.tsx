"use client";

import { useActionState, useTransition } from "react";
import { verifyEmail, resendVerification, logout } from "@/lib/auth/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function VerifyForm({ next }: { next?: string }) {
  const [state, action] = useActionState(verifyEmail, undefined);
  const [resending, startResend] = useTransition();
  const [leaving, startLeave] = useTransition();
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="code" label="Code de vérification" error={fieldError(state, "code")} required>
        {(p) => <Input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" className="text-center font-mono text-2xl tracking-[0.5em]" autoFocus />}
      </Field>
      <SubmitButton className="w-full" size="lg">
        Vérifier mon e-mail
      </SubmitButton>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11"
          loading={resending}
          onClick={() =>
            startResend(async () => {
              const r = await resendVerification();
              if (r.ok) toast.success(r.message ?? "Code envoyé");
              else toast.error(r.error);
            })
          }
        >
          Renvoyer le code
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-11 text-ink-muted" loading={leaving} onClick={() => startLeave(() => logout())}>
          Changer de compte
        </Button>
      </div>
    </form>
  );
}
