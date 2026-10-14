"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { btnClass } from "@/components/storefront/ui";
import { cn } from "@/lib/utils";

/** Bouton d'envoi aux couleurs de la boutique, état « en cours » annoncé aux lecteurs d'écran. */
export function SfSubmit({ children, style = "solid", size = "md", className, disabled }: { children: React.ReactNode; style?: "solid" | "outline" | "soft"; size?: "md" | "lg" | "sm"; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} className={cn(btnClass(style, size), "active:scale-[0.98] disabled:opacity-60", className)}>
      {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

/** Champ de la boutique : libellé au-dessus, aide et erreur reliées par aria-describedby. */
export function SfField({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; children: (p: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-muted">(facultatif)</span>}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Erreur globale d'une action (les erreurs de champ sont affichées sous les champs). */
export function SfFormError({ state }: { state?: ActionResult<unknown> }) {
  if (!state || state.ok) return null;
  const fieldOnly = state.fieldErrors && Object.values(state.fieldErrors).flat().includes(state.error);
  if (fieldOnly) return null;
  return (
    <p role="alert" className="rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {state.error}
    </p>
  );
}

export function sfFieldError(state: ActionResult<unknown> | undefined, name: string): string | undefined {
  if (!state || state.ok) return undefined;
  return state.fieldErrors?.[name]?.[0];
}
