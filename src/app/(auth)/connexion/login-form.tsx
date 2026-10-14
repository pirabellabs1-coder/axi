"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { login } from "@/lib/auth/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { PasswordInput } from "../password-input";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="email" label="Adresse e-mail" error={fieldError(state, "email")} required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="vous@exemple.com" autoFocus />}
      </Field>
      <div>
        <Field id="password" label="Mot de passe" error={fieldError(state, "password")} required>
          {(p) => <PasswordInput {...p} name="password" autoComplete="current-password" />}
        </Field>
        <div className="mt-1 flex justify-end">
          <Link href="/mot-de-passe-oublie" className="inline-flex min-h-11 items-center text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>
      </div>
      <SubmitButton className="w-full" size="lg" trailing={ArrowRight}>
        Se connecter
      </SubmitButton>
    </form>
  );
}
