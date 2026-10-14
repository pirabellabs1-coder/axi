import { Clock, MessageCircle, RefreshCw, ShieldCheck, Star, Truck } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { SectionShell } from "../ui";

const ICONS = { truck: Truck, shield: ShieldCheck, refresh: RefreshCw, chat: MessageCircle, star: Star, clock: Clock } as const;

export default function TrustBadges({ section, ctx }: SectionProps) {
  const items = section.blocks.filter((b) => !b.disabled && S.str(b.settings, "title").trim());
  if (!items.length) return null;
  return (
    <SectionShell section={section} ctx={ctx} label="Nos garanties">
      <ul className={cn("grid gap-3 sm:gap-4", items.length === 2 ? "sm:grid-cols-2" : items.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
        {items.map((b) => {
          const Icon = ICONS[S.str(b.settings, "icon", "truck") as keyof typeof ICONS] ?? Truck;
          return (
            <li key={b.id} className="flex items-start gap-3.5 rounded-[var(--store-card-radius)] bg-surface p-4 ring-1 ring-line sm:p-5">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--store-primary-soft)] text-[var(--store-primary)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block text-[15px] font-semibold text-ink">{S.str(b.settings, "title")}</span>
                {S.str(b.settings, "text") && <span className="mt-0.5 block text-sm leading-snug text-ink-muted">{S.str(b.settings, "text")}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}
