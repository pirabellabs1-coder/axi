"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, GripVertical, MessageCircle } from "lucide-react";
import type { ConversationStage } from "@prisma/client";
import { setConversationStage } from "@/lib/inbox/actions";
import { STAGES, STAGE_LABELS } from "@/lib/inbox/constants";
import { formatMoney } from "@/lib/money";
import { relativeTime, cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

export type PipelineCard = {
  id: string;
  name: string;
  stage: ConversationStage;
  estimatedValue: number | null;
  lastMessageAt: string;
  lastPreview: string | null;
  labels: string[];
  unreadCount: number;
  assignee: string | null;
};

const DOT: Record<ConversationStage, string> = {
  NEW: "bg-ink-faint",
  INTERESTED: "bg-info",
  ORDERING: "bg-sun",
  PAID: "bg-primary",
  LOST: "bg-danger",
};

export function PipelineBoard({ storeId, currency, cards: initial, canEdit }: { storeId: string; currency: string; cards: PipelineCard[]; canEdit: boolean }) {
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<ConversationStage | null>(null);
  const [announce, setAnnounce] = useState("");
  const [, start] = useTransition();
  const router = useRouter();

  useEffect(() => setCards(initial), [initial]);

  const columns = useMemo(
    () =>
      STAGES.map((stage) => {
        const items = cards.filter((c) => c.stage === stage);
        return { stage, items, total: items.reduce((s, c) => s + (c.estimatedValue ?? 0), 0) };
      }),
    [cards],
  );

  function move(id: string, to: ConversationStage) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === to) return;
    const from = card.stage;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: to } : c)));
    setAnnounce(`${card.name} déplacé vers ${STAGE_LABELS[to]}`);
    start(async () => {
      const r = await setConversationStage(storeId, id, to);
      if (!r.ok) {
        setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: from } : c)));
        setAnnounce(`Échec du déplacement de ${card.name}`);
        toast.error(r.error);
      } else router.refresh();
    });
  }

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="scrollbar-none relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 2xl:mx-0 2xl:grid 2xl:snap-none 2xl:grid-cols-5 2xl:overflow-visible 2xl:px-0">
        {columns.map((col, ci) => (
          <section
            key={col.stage}
            aria-labelledby={`col-${col.stage}`}
            onDragOver={(e) => {
              if (!dragId || !canEdit) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== col.stage) setOver(col.stage);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === col.stage ? null : o));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragId;
              setOver(null);
              setDragId(null);
              if (id) move(id, col.stage);
            }}
            className={cn(
              "flex w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-[var(--radius-lg)] bg-surface-2/70 ring-1 ring-line transition-[box-shadow,background-color] duration-150 sm:w-72 2xl:w-auto 2xl:max-w-none",
              over === col.stage && "bg-primary-soft/60 ring-2 ring-primary/50",
            )}
          >
            <header className="px-3.5 pb-2 pt-3.5">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", DOT[col.stage])} aria-hidden />
                <h2 id={`col-${col.stage}`} className="text-sm font-semibold text-ink">
                  {STAGE_LABELS[col.stage]}
                </h2>
                <span className="ml-auto rounded-full bg-surface px-2 text-xs font-medium text-ink-muted tabular ring-1 ring-line">{col.items.length}</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted tabular">{col.total > 0 ? formatMoney(col.total, currency) : "Aucune valeur estimée"}</p>
            </header>
            <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2" aria-label={`Conversations ${STAGE_LABELS[col.stage]}`}>
              {col.items.length === 0 && (
                <li className="flex flex-1 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-faint">
                  {canEdit ? "Glissez une carte ici" : "Vide"}
                </li>
              )}
              {col.items.map((c) => {
                const prev = STAGES[ci - 1];
                const next = STAGES[ci + 1];
                return (
                  <li
                    key={c.id}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(c.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    className={cn(
                      "group rounded-[var(--radius-md)] bg-surface p-3 shadow-[var(--shadow-sm)] ring-1 ring-line transition-[opacity,transform] duration-150",
                      canEdit && "cursor-grab active:cursor-grabbing",
                      dragId === c.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      {canEdit && <GripVertical className="mt-0.5 hidden size-4 shrink-0 text-ink-faint [@media(pointer:fine)]:block" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <Link href={`/app/${storeId}/conversations?c=${c.id}`} className="block truncate text-sm font-semibold text-ink hover:text-primary hover:underline">
                          {c.name}
                        </Link>
                        {c.lastPreview && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{c.lastPreview}</p>}
                      </div>
                      {c.unreadCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent" title="Messages non lus">
                          <MessageCircle className="size-3" aria-hidden />
                          {c.unreadCount}
                          <span className="sr-only"> non lus</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink tabular">{c.estimatedValue != null ? formatMoney(c.estimatedValue, currency) : <span className="font-normal text-ink-faint">Valeur à estimer</span>}</span>
                      <time dateTime={c.lastMessageAt} className="ml-auto shrink-0 text-[11px] text-ink-faint">
                        {relativeTime(c.lastMessageAt)}
                      </time>
                    </div>
                    {(c.labels.length > 0 || c.assignee) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {c.labels.slice(0, 3).map((l) => (
                          <span key={l} className="rounded-full bg-surface-2 px-2 text-[11px] leading-[18px] text-ink-muted">
                            {l}
                          </span>
                        ))}
                        {c.assignee && <span className="ml-auto text-[11px] text-ink-faint">{c.assignee}</span>}
                      </div>
                    )}
                    {canEdit && (
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2">
                        <button
                          type="button"
                          disabled={!prev}
                          onClick={() => prev && move(c.id, prev)}
                          className="inline-flex h-9 items-center gap-0.5 rounded-full pl-1.5 pr-2.5 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:invisible"
                          aria-label={prev ? `Déplacer ${c.name} vers ${STAGE_LABELS[prev]}` : undefined}
                        >
                          <ChevronLeft className="size-4" aria-hidden />
                          {prev ? STAGE_LABELS[prev] : ""}
                        </button>
                        <button
                          type="button"
                          disabled={!next}
                          onClick={() => next && move(c.id, next)}
                          className="inline-flex h-9 items-center gap-0.5 rounded-full pl-2.5 pr-1.5 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:invisible"
                          aria-label={next ? `Déplacer ${c.name} vers ${STAGE_LABELS[next]}` : undefined}
                        >
                          {next ? STAGE_LABELS[next] : ""}
                          <ChevronRight className="size-4" aria-hidden />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
