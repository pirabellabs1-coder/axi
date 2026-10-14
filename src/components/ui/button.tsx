import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "whatsapp" | "outline" | "link" | "inverse";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

/**
 * Boutons pilule. Pression physique (scale 0.98), transitions ressort.
 * `trailing` : icône nichée dans sa propre pastille (motif « bouton dans le bouton »).
 */
const base =
  "group/btn relative inline-flex items-center justify-center gap-2 rounded-full font-medium select-none whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-300 ease-spring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_8px_20px_-10px_rgb(var(--c-shadow)/0.6)]",
  accent: "bg-accent text-on-accent hover:bg-accent-hover shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_8px_20px_-12px_rgb(120_170_40/0.7)]",
  secondary: "bg-surface-2 text-ink hover:bg-line",
  outline: "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
  danger: "bg-danger text-canvas hover:opacity-90",
  whatsapp: "bg-whatsapp-deep text-white hover:brightness-110 shadow-sm",
  inverse: "bg-white text-forest hover:bg-white/90",
  link: "bg-transparent text-primary underline-offset-4 hover:underline !px-0 !h-auto rounded-none",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-13 px-7 text-base",
  icon: "size-11 p-0",
};

const trailingPad: Record<ButtonSize, string> = { sm: "pr-1.5", md: "pr-1.5", lg: "pr-2", icon: "" };
const nestSize: Record<ButtonSize, string> = { sm: "size-6", md: "size-8", lg: "size-9", icon: "" };

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
  /** Icône de fin nichée dans une pastille (true = flèche ↗). */
  trailing?: LucideIcon | true;
};

export type ButtonProps = CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function buttonClasses({ variant = "primary", size = "md", className, trailing }: Omit<CommonProps, "children" | "loading">) {
  return cn(base, variants[variant], sizes[size], trailing && trailingPad[size], className);
}

function Nest({ icon, size, variant }: { icon: LucideIcon | true; size: ButtonSize; variant: ButtonVariant }) {
  const Icon = icon === true ? ArrowUpRight : icon;
  const tone =
    variant === "accent" ? "bg-forest text-lime" : variant === "primary" ? "bg-white/15 text-current" : variant === "inverse" ? "bg-forest text-white" : "bg-ink/5 text-current";
  return (
    <span
      aria-hidden
      className={cn(
        "ml-1 inline-flex shrink-0 items-center justify-center rounded-full transition-transform duration-500 ease-spring group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-px group-hover/btn:scale-105",
        nestSize[size],
        tone,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className, children, disabled, type = "button", trailing, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, className, trailing })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
      {trailing && !loading && <Nest icon={trailing} size={size} variant={variant} />}
    </button>
  );
});

export type ButtonLinkProps = CommonProps & React.ComponentProps<typeof Link>;

export function ButtonLink({ variant = "primary", size = "md", className, children, trailing, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, className, trailing })} {...props}>
      {children}
      {trailing && <Nest icon={trailing} size={size} variant={variant} />}
    </Link>
  );
}
