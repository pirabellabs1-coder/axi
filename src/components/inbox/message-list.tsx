import Link from "next/link";
import { Check, CheckCheck, Clock, AlertCircle, ExternalLink, StickyNote, Receipt } from "lucide-react";
import type { MessageStatus, MessageDirection } from "@prisma/client";
import { MESSAGE_STATUS_LABELS } from "@/lib/inbox/constants";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type MessageDTO = {
  id: string;
  direction: MessageDirection;
  body: string;
  status: MessageStatus;
  createdAt: Date;
  orderId: string | null;
  error: string | null;
  attachmentUrl: string | null;
  author: { name: string } | null;
};

const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function dayLabel(d: Date) {
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === y.toDateString()) return "Hier";
  return formatDate(d, { weekday: "long", day: "numeric", month: "long" });
}

function StatusIcon({ status }: { status: MessageStatus }) {
  const label = MESSAGE_STATUS_LABELS[status];
  const common = "size-3.5 shrink-0";
  const icon =
    status === "QUEUED" ? <Clock className={common} aria-hidden /> :
    status === "SENT" ? <Check className={common} aria-hidden /> :
    status === "DELIVERED" ? <CheckCheck className={common} aria-hidden /> :
    status === "READ" ? <CheckCheck className={cn(common, "text-info")} aria-hidden /> :
    status === "FAILED" ? <AlertCircle className={cn(common, "text-danger")} aria-hidden /> :
    null;
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function MessageList({ messages, storeId, phone }: { messages: MessageDTO[]; storeId: string; phone: string }) {
  return (
    <ol className="mx-auto flex max-w-3xl flex-col gap-1.5">
      {messages.map((m, i) => {
        const showDay = i === 0 || messages[i - 1]!.createdAt.toDateString() !== m.createdAt.toDateString();
        const out = m.direction === "OUTBOUND";
        const note = m.direction === "NOTE";
        return (
          <li key={m.id} className="contents">
            {showDay && (
              <div className="my-3 flex justify-center" role="separator" aria-label={dayLabel(m.createdAt)}>
                <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-muted ring-1 ring-line">{dayLabel(m.createdAt)}</span>
              </div>
            )}
            {note ? (
              <div className="my-1 w-full rounded-[var(--radius-md)] border border-dashed border-sun/50 bg-sun-soft/70 px-3.5 py-2.5">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#8a5a00] dark:text-sun">
                  <StickyNote className="size-3.5" aria-hidden /> Note interne{m.author ? ` de ${m.author.name}` : ""}
                  <span className="ml-auto font-normal text-ink-faint tabular">{time.format(m.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-ink [overflow-wrap:anywhere]">{m.body}</p>
              </div>
            ) : (
              <div className={cn("flex", out ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[82%] rounded-[18px] px-3.5 py-2 shadow-[0_1px_1px_rgb(var(--c-shadow)/0.06)] sm:max-w-[480px]",
                    out ? "rounded-br-md bg-primary text-on-primary" : "rounded-bl-md bg-surface text-ink ring-1 ring-line",
                    m.status === "FAILED" && "ring-2 ring-danger/60",
                  )}
                >
                  <span className="sr-only">{out ? `Vous${m.author ? ` (${m.author.name})` : ""} :` : "Client :"}</span>
                  {m.attachmentUrl && (
                    <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mb-1.5 block overflow-hidden rounded-[12px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.attachmentUrl} alt="Image" className="max-h-72 w-full max-w-[280px] object-cover" loading="lazy" />
                    </a>
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed [overflow-wrap:anywhere]">{m.body}</p>}
                  {m.orderId && (
                    <Link
                      href={`/app/${storeId}/commandes/${m.orderId}`}
                      className={cn("mt-1.5 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline", out ? "text-on-primary" : "text-primary")}
                    >
                      <Receipt className="size-3.5" aria-hidden /> Voir la commande liée
                    </Link>
                  )}
                  <div className={cn("mt-1 flex items-center justify-end gap-1.5 text-[11px] tabular", out ? "text-on-primary/70" : "text-ink-faint")}>
                    {out && m.author && <span className="truncate">{m.author.name.split(" ")[0]}</span>}
                    <time dateTime={m.createdAt.toISOString()}>{time.format(m.createdAt)}</time>
                    {out && <StatusIcon status={m.status} />}
                  </div>
                  {out && m.status === "FAILED" && m.error && <p className="mt-1 text-xs text-on-primary/90">Échec : {m.error}</p>}
                  {out && m.status === "LINK_ONLY" && (
                    <a
                      href={`https://wa.me/${phone}?text=${encodeURIComponent(m.body)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-on-primary/10 px-3 text-xs font-semibold ring-1 ring-inset ring-current/20 hover:bg-on-primary/20"
                    >
                      Pas encore envoyé : ouvrir dans WhatsApp <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
