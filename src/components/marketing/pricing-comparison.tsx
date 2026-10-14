"use client";

import { Fragment, useState } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { COMPARISON, PLANS, PLAN_ORDER, type PlanId } from "@/config/plans";
import { displayPlanPrice } from "@/lib/marketing/pricing";
import { usePricing } from "@/components/marketing/pricing-context";
import { cn } from "@/lib/utils";

type Cell = boolean | string;

function CellValue({ value }: { value: Cell }) {
  if (value === true)
    return (
      <>
        <Check className="mx-auto size-[18px] text-primary max-lg:mx-0" aria-hidden />
        <span className="sr-only">Inclus</span>
      </>
    );
  if (value === false)
    return (
      <>
        <Minus className="mx-auto size-[18px] text-ink-faint max-lg:mx-0" aria-hidden />
        <span className="sr-only">Non inclus</span>
      </>
    );
  return <span className="text-[13.5px] font-medium text-ink tabular">{value}</span>;
}

function PriceLine({ id }: { id: PlanId }) {
  const { zone, interval } = usePricing();
  const p = displayPlanPrice(id, zone, interval);
  const plan = PLANS[id];
  if (p.kind === "paid") return <>{plan.fromPrice ? `dès ${p.perMonth}` : p.perMonth} / mois</>;
  return <>{p.label}</>;
}

/**
 * Comparatif complet depuis `COMPARISON` :
 * - grand écran : tableau à en-tête collant, groupes repliables ;
 * - mobile et tablette : vue d'un plan choisi (liste libellé / valeur).
 */
export function PricingComparison() {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [mobilePlan, setMobilePlan] = useState<PlanId>("BUSINESS");

  const toggle = (title: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  return (
    <div className="reveal">
      {/* Grand écran */}
      <div className="hidden lg:block">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Comparaison détaillée des plans Axi</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky top-[88px] z-10 w-[32%] border-b border-line bg-surface py-5 pr-4 text-left align-bottom text-[13px] font-medium text-ink-muted">
                Fonctionnalité
              </th>
              {PLAN_ORDER.map((id) => (
                <th key={id} scope="col" className={cn("sticky top-[88px] z-10 border-b border-line bg-surface px-3 py-5 text-center align-bottom", PLANS[id].highlight && "shadow-[inset_0_3px_0_var(--c-accent)]")}>
                  <span className="block text-[15px] font-semibold text-ink">{PLANS[id].name}</span>
                  <span className="mt-1 block text-[12.5px] font-normal text-ink-muted tabular">
                    <PriceLine id={id} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {COMPARISON.map((group) => {
            const isOpen = !closed.has(group.title);
            const groupId = `cmp-${group.title.replace(/\W+/g, "-").toLowerCase()}`;
            return (
              <Fragment key={group.title}>
              <tbody>
                <tr>
                  <th scope="rowgroup" colSpan={PLAN_ORDER.length + 1} className="pt-10 text-left">
                    <button
                      type="button"
                      onClick={() => toggle(group.title)}
                      aria-expanded={isOpen}
                      aria-controls={groupId}
                      className="group inline-flex min-h-11 items-center gap-2 text-base font-semibold text-ink"
                    >
                      {group.title}
                      <ChevronDown className={cn("size-4 text-ink-muted transition-transform duration-500 ease-spring", !isOpen && "-rotate-90")} aria-hidden />
                    </button>
                  </th>
                </tr>
              </tbody>
              <tbody id={groupId} hidden={!isOpen}>
                {group.rows.map((row) => (
                  <tr key={row.label} className="hover:bg-surface-2/60">
                    <th scope="row" className="border-b border-line py-3.5 pr-4 text-left font-normal text-ink">
                      {row.label}
                    </th>
                    {PLAN_ORDER.map((id) => (
                      <td key={id} className={cn("border-b border-line px-3 py-3.5 text-center", PLANS[id].highlight && "bg-accent-soft/50")}>
                        <CellValue value={row.values[id]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              </Fragment>
            );
          })}
        </table>
      </div>

      {/* Mobile et tablette : un plan à la fois */}
      <div className="lg:hidden">
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium text-ink">Afficher le détail du plan</legend>
          <div className="scrollbar-none relative -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 py-1">
            {PLAN_ORDER.map((id) => {
              const active = id === mobilePlan;
              return (
                <label
                  key={id}
                  className={cn(
                    "inline-flex h-11 shrink-0 cursor-pointer items-center rounded-full px-4 text-sm font-medium ring-1 transition-colors duration-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                    active ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-muted ring-line",
                  )}
                >
                  <input type="radio" name="cmp-plan" value={id} checked={active} onChange={() => setMobilePlan(id)} className="sr-only" />
                  {PLANS[id].name}
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className="mt-4 text-sm text-ink-muted" aria-live="polite">
          <span className="font-semibold text-ink">{PLANS[mobilePlan].name}</span> : <PriceLine id={mobilePlan} />
        </p>

        <div className="mt-6 space-y-3">
          {COMPARISON.map((group) => {
            const isOpen = !closed.has(group.title);
            const groupId = `cmp-m-${group.title.replace(/\W+/g, "-").toLowerCase()}`;
            return (
              <section key={group.title} className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
                <h3>
                  <button
                    type="button"
                    onClick={() => toggle(group.title)}
                    aria-expanded={isOpen}
                    aria-controls={groupId}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left text-[15px] font-semibold text-ink"
                  >
                    {group.title}
                    <ChevronDown className={cn("size-4 text-ink-muted transition-transform duration-500 ease-spring", !isOpen && "-rotate-90")} aria-hidden />
                  </button>
                </h3>
                <dl id={groupId} hidden={!isOpen} className="divide-y divide-line border-t border-line px-5">
                  {group.rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 py-3">
                      <dt className="text-sm text-ink">{row.label}</dt>
                      <dd className="shrink-0 text-right">
                        <CellValue value={row.values[mobilePlan]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
