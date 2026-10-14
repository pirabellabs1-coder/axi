import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { ConversationListItem } from "@/lib/inbox/queries";
import { STAGE_LABELS, STAGE_TONES } from "@/lib/inbox/constants";
import { Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { relativeTime, formatPhone, cn } from "@/lib/utils";

export function ConversationList({ items, activeId, hrefFor, emptyHint }: { items: ConversationListItem[]; activeId: string | null; hrefFor: (id: string) => string; emptyHint: React.ReactNode }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <MessageCircle className="size-5" aria-hidden />
        </span>
        <p className="font-semibold text-ink">Aucune conversation</p>
        <p className="mt-1 max-w-[30ch] text-sm text-ink-muted">{emptyHint}</p>
      </div>
    );
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain" aria-label="Conversations">
      {items.map((c) => {
        const active = c.id === activeId;
        const unread = c.unreadCount > 0;
        return (
          <li key={c.id}>
            <Link
              href={hrefFor(c.id)}
              aria-current={active ? "true" : undefined}
              scroll={false}
              className={cn(
                "relative flex gap-3 px-4 py-3 transition-colors duration-150 focus-visible:outline-offset-[-2px]",
                active ? "bg-primary-soft/70" : "hover:bg-surface-2/70",
              )}
            >
              {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden />}
              <Avatar name={c.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold text-ink" : "font-medium text-ink")}>{c.name}</p>
                  <time dateTime={c.lastMessageAt.toISOString()} className={cn("shrink-0 text-xs tabular", unread ? "font-semibold text-primary" : "text-ink-faint")}>
                    {relativeTime(c.lastMessageAt)}
                  </time>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <p className={cn("min-w-0 flex-1 truncate text-[13px]", unread ? "text-ink" : "text-ink-muted")}>{c.lastPreview ?? formatPhone(c.phone)}</p>
                  {unread && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent tabular">
                      {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      <span className="sr-only"> message{c.unreadCount > 1 ? "s" : ""} non lu{c.unreadCount > 1 ? "s" : ""}</span>
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <Badge tone={STAGE_TONES[c.stage]} className="px-2 py-0 text-[11px] leading-[18px]">{STAGE_LABELS[c.stage]}</Badge>
                  {c.status === "PENDING" && <Badge tone="warning" className="px-2 py-0 text-[11px] leading-[18px]">En attente</Badge>}
                  {c.labels.slice(0, 2).map((l) => (
                    <span key={l} className="rounded-full bg-surface-2 px-2 text-[11px] leading-[18px] text-ink-muted">
                      {l}
                    </span>
                  ))}
                  {c.labels.length > 2 && <span className="text-[11px] text-ink-faint">+{c.labels.length - 2}</span>}
                  {c.assignedTo && <span className="ml-auto truncate text-[11px] text-ink-faint">{c.assignedTo.name.split(" ")[0]}</span>}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
