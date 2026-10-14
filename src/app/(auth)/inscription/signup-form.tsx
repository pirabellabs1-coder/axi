"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { signup } from "@/lib/auth/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { PasswordInput } from "../password-input";

export function SignupForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signup, undefined);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="name" label="Votre nom" error={fieldError(state, "name")} required>
        {(p) => <Input {...p} name="name" autoComplete="name" autoCapitalize="words" placeholder="Ex. Aïcha Dossou" autoFocus />}
      </Field>
      <Field id="email" label="Adresse e-mail" hint="Vous recevrez un code de vérification." error={fieldError(state, "email")} required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="vous@exemple.com" />}
      </Field>
      <Field id="password" label="Mot de passe" hint="8 caractères minimum, avec des lettres et des chiffres." error={fieldError(state, "password")} required>
        {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" minLength={8} />}
      </Field>
      <SubmitButton className="w-full" size="lg" variant="accent" trailing={ArrowRight}>
        Créer mon compte
      </SubmitButton>
      <p className="text-center text-xs leading-relaxed text-ink-faint">
        En continuant, vous acceptez les{" "}
        <Link href="/legal/cgu" className="underline underline-offset-2 hover:text-ink">
          conditions d&apos;utilisation
        </Link>{" "}
        et la{" "}
        <Link href="/legal/confidentialite" className="underline underline-offset-2 hover:text-ink">
          politique de confidentialité
        </Link>
        .
      </p>
    </form>
  );
}
