import * as React from "react";
import { cn } from "@/lib/utils";

const inputBase =
  "block w-full rounded-[var(--radius-md)] border-0 bg-surface px-4 text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint shadow-[0_1px_2px_rgb(var(--c-shadow)/0.04)] transition-[box-shadow,background-color] duration-200 ease-spring hover:ring-ink-faint/60 focus:ring-2 focus:ring-primary focus:outline-none disabled:bg-surface-2 disabled:text-ink-muted aria-invalid:ring-2 aria-invalid:ring-danger";

/** Hauteurs : md = 48 px (formulaires), sm = 44 px sur mobile puis 36 px (barres de filtres denses). */
export type FieldSize = "md" | "sm";
const heights: Record<FieldSize, string> = { md: "h-12", sm: "h-11 px-3.5 sm:h-9 sm:rounded-[12px] sm:text-sm" };

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; fieldSize?: FieldSize };

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, fieldSize = "md", ...props }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, heights[fieldSize], className)} {...props} />;
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, invalid, ...props }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, "min-h-28 py-3 leading-relaxed", className)} {...props} />;
});

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; fieldSize?: FieldSize };

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, invalid, children, fieldSize = "md", ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, heights[fieldSize], "appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted">
        <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export function Label({ className, children, required, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("mb-1.5 block text-sm font-medium text-ink", className)} {...props}>
      {children}
      {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
    </label>
  );
}

export function Hint({ children, id, className }: { children: React.ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} className={cn("mt-1.5 text-[13px] text-ink-muted", className)}>
      {children}
    </p>
  );
}

export function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
      {children}
    </p>
  );
}

/**
 * Champ complet : label + contrôle + aide + erreur, liés par aria-describedby.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | string[];
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; invalid: boolean; required?: boolean }) => React.ReactNode;
}) {
  const err = Array.isArray(error) ? error[0] : error;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = err ? `${id}-error` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("w-full", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({ id, "aria-describedby": describedBy, invalid: !!err, required })}
      {err ? <FieldError id={errId}>{err}</FieldError> : hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

export function Checkbox({ className, label, description, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-line-strong accent-[var(--c-primary)]" {...props} />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, name, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label: string; name?: string; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-3", disabled && "opacity-50")}>
      <span className="relative inline-flex h-6 w-11 shrink-0">
        <input
          type="checkbox"
          name={name}
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
          role="switch"
          aria-checked={checked}
        />
        <span className="absolute inset-0 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
      <span className="text-sm font-medium text-ink">{label}</span>
    </label>
  );
}
