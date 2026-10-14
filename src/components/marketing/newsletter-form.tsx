"use client";

import { startTransition, useActionState, useId } from "react";
import { CheckCircle2 } from "lucide-react";
import { subscribeLead } from "@/lib/marketing/actions";
import { Input, Label, FieldError } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { fieldError } from "@/components/forms/form-message";
import { cn } from "@/lib/utils";

/** Inscription aux nouveautés : un champ, un bouton, un message. */
export function NewsletterForm({ source = "site", className, light = false }: { source?: string; className?: string; light?: boolean }) {
  const [state, action, pending] = useActionState(subscribeLead, undefined);
  const id = useId();

  if (state?.ok) {
    return (
      <p role="status" className={cn("flex items-center gap-2 text-sm font-medium", light ? "text-white" : "text-primary-deep", className)}>
        <CheckCircle2 className="size-5 shrink-0" aria-hidden />
        {state.message}
      </p>
    );
  }

  const error = fieldError(state, "email") ?? (state && !state.ok ? state.error : undefined);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      noValidate
      className={cn("relative", className)}
    >
      <Label htmlFor={`${id}-email`} className={cn(light && "text-white")}>
        Recevoir les nouveautés Axi
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id={`${id}-email`} name="email" type="email" inputMode="email" autoComplete="email" placeholder="vous@exemple.com" aria-describedby={error ? `${id}-error` : undefined} invalid={!!error} className="sm:flex-1" />
        <input type="hidden" name="source" value={source} />
        <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
          <label htmlFor={`${id}-website`}>Site web</label>
          <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <SubmitButton variant={light ? "accent" : "primary"} loading={pending}>S&apos;inscrire</SubmitButton>
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
      <p className={cn("mt-2 text-xs", light ? "text-white/70" : "text-ink-muted")}>Un e-mail par mois maximum. Désinscription en un clic.</p>
    </form>
  );
}
