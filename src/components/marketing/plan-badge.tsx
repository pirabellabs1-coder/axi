import { PLANS, type PlanId } from "@/config/plans";
import { cn } from "@/lib/utils";

/** Plan minimum requis pour une fonctionnalité (« Tous les plans », « Dès Business »…), et mention « Bientôt ». */
export function PlanBadge({ plan, soon = false, className, light = false }: { plan: PlanId; soon?: boolean; className?: string; light?: boolean }) {
  const label = plan === "FREE" ? "Tous les plans" : plan === "ENTERPRISE" ? "Enterprise" : `Dès ${PLANS[plan].name}`;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-medium", className)}>
      <span className={cn("rounded-full px-2.5 py-0.5 ring-1 ring-inset", light ? "bg-white/10 text-white/85 ring-white/15" : plan === "FREE" ? "bg-surface-2 text-ink-muted ring-line" : "bg-primary-soft text-primary-deep ring-primary/15")}>{label}</span>
      {soon && <span className={cn("rounded-full px-2.5 py-0.5 ring-1 ring-inset", light ? "bg-lime text-forest-deep ring-transparent" : "bg-sun-soft text-ink ring-sun/30")}>Bientôt</span>}
    </span>
  );
}
