"use client";

import { startTransition, useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { submitContact } from "@/lib/marketing/actions";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { ButtonLink } from "@/components/ui/button";

const SUBJECTS = [
  { value: "Question sur Axi", label: "Question sur Axi" },
  { value: "Aide pour ma boutique", label: "Aide pour ma boutique" },
  { value: "Paiements et Mobile Money", label: "Paiements et Mobile Money" },
  { value: "Abonnement et facturation", label: "Abonnement et facturation" },
  { value: "Offre Enterprise", label: "Offre Enterprise (réseaux, franchises)" },
  { value: "Partenariat", label: "Partenariat" },
  { value: "Autre", label: "Autre" },
];

export function ContactForm({ defaultSubject }: { defaultSubject?: string }) {
  const [state, action, pending] = useActionState(submitContact, undefined);

  if (state?.ok) {
    return (
      <div role="status" className="rounded-[var(--radius-xl)] bg-primary-soft p-8 text-center ring-1 ring-primary/20 sm:p-10">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-primary text-on-primary">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <h2 className="mt-5 text-h3 font-semibold text-ink">Message bien reçu</h2>
        <p className="mt-2 text-ink-muted">{state.message}</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <ButtonLink href="/" variant="outline">
            Retour à l&apos;accueil
          </ButtonLink>
          <ButtonLink href="/aide" variant="ghost">
            Consulter le centre d&apos;aide
          </ButtonLink>
        </div>
      </div>
    );
  }

  const subjectDefault = SUBJECTS.some((s) => s.value === defaultSubject) ? defaultSubject : SUBJECTS[0].value;

  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Soumission manuelle : React ne réinitialise pas les champs si la validation échoue.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      noValidate
      className="relative space-y-5"
    >
      <FormMessage state={state} toastSuccess={false} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="contact-name" label="Votre nom" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} name="name" autoComplete="name" maxLength={80} />}
        </Field>
        <Field id="contact-email" label="Adresse e-mail" required error={fieldError(state, "email")} hint="Nous répondons à cette adresse.">
          {(p) => <Input {...p} name="email" type="email" inputMode="email" autoComplete="email" maxLength={120} />}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="contact-store" label="Nom de votre boutique" error={fieldError(state, "storeName")} hint="Facultatif, si vous avez déjà une boutique Axi.">
          {(p) => <Input {...p} name="storeName" autoComplete="organization" maxLength={80} />}
        </Field>
        <Field id="contact-subject" label="Sujet" required error={fieldError(state, "subject")}>
          {(p) => (
            <Select {...p} name="subject" defaultValue={subjectDefault}>
              {SUBJECTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field id="contact-message" label="Votre message" required error={fieldError(state, "message")} hint="Décrivez votre situation : plus c'est précis, plus la réponse sera utile.">
        {(p) => <Textarea {...p} name="message" rows={6} minLength={20} maxLength={4000} />}
      </Field>

      {/* Honeypot : invisible pour les humains, rempli par les robots. */}
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden>
        <label htmlFor="contact-website">Site web</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-muted">
          En envoyant ce formulaire, vous acceptez notre{" "}
          <a href="/legal/confidentialite" className="font-medium text-primary underline underline-offset-4">
            politique de confidentialité
          </a>
          .
        </p>
        <SubmitButton variant="accent" size="lg" trailing loading={pending}>
          Envoyer le message
        </SubmitButton>
      </div>
    </form>
  );
}
