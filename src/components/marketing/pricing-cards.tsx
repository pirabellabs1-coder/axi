"use client";

import { Bot, Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { MCP_TIER_LABEL, PLANS, SELF_SERVE_PLANS, TRIAL_DAYS, TRIAL_PLAN, type Plan } from "@/config/plans";
import { displayPlanPrice } from "@/lib/marketing/pricing";
import { cn } from "@/lib/utils";
import { usePricing } from "@/components/marketing/pricing-context";

/**
 * Cartes des 4 plans en libre-service (Gratuit, Starter, Business, Scale).
 * Doit être rendu dans un <PricingProvider>. Business est mis en avant (double-bezel).
 */
export function PricingCards({ compact = false, className }: { compact?: boolean; className?: string }) {
  const plans = SELF_SERVE_PLANS.map((id) => PLANS[id]);
  return (
    <ul className={cn("grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {plans.map((plan, i) => (
        <li key={plan.id} className="reveal" style={{ transitionDelay: `${i * 70}ms` }}>
          <PlanCard plan={plan} compact={compact} />
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ plan, compact }: { plan: Plan; compact: boolean }) {
  const { zone, interval, prices } = usePricing();
  const effective = prices?.[plan.id];
  const price = displayPlanPrice(plan.id, zone, interval, effective ? effective[zone] : undefined);
  const highlight = !!plan.highlight;
  const free = price.kind === "free";
  const bullets = compact ? plan.bullets.slice(0, 4) : plan.bullets;
  const trial = plan.id === TRIAL_PLAN;
  const cta = free ? "Commencer gratuitement" : trial ? `Essayer ${TRIAL_DAYS} jours` : `Choisir ${plan.name}`;

  const body = (
    <div className="flex h-full flex-col p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold tracking-[-0.02em] text-ink">{plan.name}</h3>
        {highlight && <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-on-accent">Recommandé</span>}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{plan.audience}</p>

      <div className="mt-7 min-h-[88px]">
        {price.kind === "paid" ? (
          <>
            <p className="flex items-baseline gap-1.5 text-ink">
              <span className="text-[2.5rem] font-semibold leading-none tracking-[-0.045em] tabular">{price.perMonth}</span>
              <span className="text-sm text-ink-muted">/ mois</span>
            </p>
            <p className="mt-2.5 text-[13px] text-ink-muted">{price.billed ?? "Facturé chaque mois, sans engagement"}</p>
          </>
        ) : (
          <>
            <p className="text-[2.5rem] font-semibold leading-none tracking-[-0.045em] text-ink tabular">{price.label}</p>
            <p className="mt-2.5 text-[13px] text-ink-muted">{free ? "Pour toujours, sans carte bancaire" : "Selon vos besoins"}</p>
          </>
        )}
      </div>

      <ButtonLink href="/inscription" variant={highlight ? "accent" : "outline"} className="mt-6 w-full" trailing={highlight ? true : undefined}>
        {cta}
      </ButtonLink>

      <ul className="mt-7 space-y-3 border-t border-line pt-6 text-[14px] text-ink">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{b}</span>
          </li>
        ))}
        <li className="flex items-start gap-2.5">
          <Bot className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            Connecteur IA (MCP) : <span className="text-ink-muted">{MCP_TIER_LABEL[plan.id].toLowerCase()}</span>
          </span>
        </li>
      </ul>
    </div>
  );

  if (highlight) {
    return (
      <div className="bezel h-full bg-accent-soft ring-1 ring-accent/40">
        <div className="bezel-core h-full">{body}</div>
      </div>
    );
  }
  return <div className="h-full rounded-[var(--radius-xl)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">{body}</div>;
}
