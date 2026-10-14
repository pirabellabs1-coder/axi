import { cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { OpenStatus } from "../open-status";
import { SectionHeading, SectionShell } from "../ui";

export default function OpeningHours({ section, ctx }: SectionProps) {
  const s = ctx.data.store;
  if (!s.hours.length) return null;
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} fallback="Horaires d'ouverture" aside={s.openNow !== null ? <OpenStatus open={s.openNow} /> : undefined} />
      <dl className="grid grid-cols-1 gap-1 rounded-[var(--store-card-radius)] bg-surface p-3 ring-1 ring-line sm:grid-cols-2 sm:gap-x-6 sm:p-4 lg:grid-cols-4">
        {s.hours.map((h, i) => {
          const today = i === s.todayIndex;
          return (
            <div key={h.day} className={cn("flex items-center justify-between gap-4 rounded-[10px] px-3 py-2.5 text-[15px] lg:flex-col lg:items-start lg:gap-0.5", today && "bg-[var(--store-primary-soft)] font-semibold")}>
              <dt className={today ? "text-ink" : "text-ink-muted"}>
                {h.day}
                {today && <span className="ml-2 text-xs font-medium text-[var(--store-primary)]">Aujourd&apos;hui</span>}
              </dt>
              <dd className={cn("tabular", h.ranges === "Fermé" ? "text-ink-muted" : "text-ink")}>{h.ranges}</dd>
            </div>
          );
        })}
      </dl>
    </SectionShell>
  );
}
