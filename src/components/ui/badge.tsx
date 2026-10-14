import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "primary" | "accent" | "info" | "warning" | "danger" | "success" | "sun";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-muted",
  primary: "bg-primary-soft text-primary-deep",
  success: "bg-primary-soft text-primary-deep",
  accent: "bg-accent-soft text-[#3d5a12] dark:text-lime",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  sun: "bg-sun-soft text-[#8a5a00] dark:text-sun",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: BadgeTone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 ring-1 ring-inset ring-current/10", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
