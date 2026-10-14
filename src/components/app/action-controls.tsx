"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Bouton qui exécute une action serveur sans formulaire (useTransition + toast). */
export function ActionButton({
  action,
  children,
  successMessage,
  onDone,
  ...props
}: Omit<ButtonProps, "onClick"> & { action: () => Promise<ActionResult<unknown>>; successMessage?: string; onDone?: (r: ActionResult<unknown>) => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      {...props}
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r.ok) toast.success(r.message ?? successMessage ?? "Enregistré");
          else toast.error(r.error);
          onDone?.(r);
        })
      }
    >
      {children}
    </Button>
  );
}

/** Bouton d'action destructrice avec confirmation. */
export function ConfirmActionButton({
  action,
  children,
  title,
  description,
  confirmLabel,
  tone = "danger",
  className,
  disabled,
}: {
  action: () => Promise<ActionResult<unknown>>;
  children: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <ConfirmButton
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      className={className}
      disabled={disabled}
      onConfirm={async () => {
        const r = await action();
        if (r.ok) toast.success(r.message ?? "Fait");
        else toast.error(r.error);
      }}
    >
      {children}
    </ConfirmButton>
  );
}

/** Interrupteur relié à une action serveur, avec état optimiste. */
export function AsyncSwitch({ checked, label, action, disabled }: { checked: boolean; label: string; action: (next: boolean) => Promise<ActionResult<unknown>>; disabled?: boolean }) {
  const [value, setValue] = useState(checked);
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={value}
      label={label}
      disabled={disabled || pending}
      onChange={(next) => {
        setValue(next);
        start(async () => {
          const r = await action(next);
          if (!r.ok) {
            setValue(!next);
            toast.error(r.error);
          } else if (r.message) toast.success(r.message);
        });
      }}
    />
  );
}

/** Copie une valeur dans le presse-papiers. */
export function CopyButton({ value, label = "Copier", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          toast.error("Impossible de copier. Sélectionnez le texte manuellement.");
        }
      }}
      className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2", className)}
      aria-live="polite"
    >
      {done ? <Check className="size-4 text-primary" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? "Copié" : label}
    </button>
  );
}
