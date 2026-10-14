import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PlanBadge } from "@/components/marketing/plan-badge";
import { DOMAINS, type Capability, type CapabilityGroup, type DomainSlug } from "@/lib/marketing/positioning";
import { cn } from "@/lib/utils";

/** Liste de capacités en lignes séparées, avec le plan minimum à droite. */
export function CapabilityList({ items, light = false, columns = 1, className }: { items: Capability[]; light?: boolean; columns?: 1 | 2; className?: string }) {
  return (
    <ul className={cn("grid gap-x-10", columns === 2 && "md:grid-cols-2", className)}>
      {items.map((f, i) => (
        <li key={f.title} className={cn("reveal border-t py-5", light ? "border-white/15" : "border-line")} style={{ transitionDelay: `${Math.min(i, 5) * 50}ms` }}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <h3 className={cn("text-[16px] font-semibold", light ? "text-white" : "text-ink")}>{f.title}</h3>
            <PlanBadge plan={f.plan} soon={f.soon} light={light} />
          </div>
          <p className={cn("mt-1.5 max-w-[52ch] text-[15px] leading-relaxed", light ? "text-white/70" : "text-ink-muted")}>{f.text}</p>
        </li>
      ))}
    </ul>
  );
}

/** Un groupe de capacités : titre, intro, puis la liste. */
export function CapabilityGroupBlock({ group, light = false, columns = 2 }: { group: CapabilityGroup; light?: boolean; columns?: 1 | 2 }) {
  return (
    <section aria-labelledby={`cap-${group.id}`} className="scroll-mt-28" id={group.id}>
      <div className="reveal max-w-2xl">
        <h2 id={`cap-${group.id}`} className={cn("text-h3 font-semibold", light ? "text-white" : "text-ink")}>
          {group.title}
        </h2>
        <p className={cn("mt-2 text-[15.5px] leading-relaxed", light ? "text-white/70" : "text-ink-muted")}>{group.description}</p>
      </div>
      <CapabilityList items={group.items} light={light} columns={columns} className="mt-8" />
    </section>
  );
}

/**
 * Maillage interne : les quatre domaines produit, celui de la page en cours étant exclu.
 * À placer en bas de chaque page de domaine.
 */
export function DomainLinks({ current, className }: { current?: DomainSlug; className?: string }) {
  const domains = DOMAINS.filter((d) => d.slug !== current);
  return (
    <ul className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {domains.map((d, i) => (
        <li key={d.slug} className="reveal" style={{ transitionDelay: `${i * 70}ms` }}>
          <Link
            href={`/${d.slug}`}
            className="flex h-full flex-col rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-500 ease-spring hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-[17px] font-semibold text-ink">{d.label}</span>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
            </span>
            <span className="mt-2 text-[15px] leading-relaxed text-ink-muted">{d.summary}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
