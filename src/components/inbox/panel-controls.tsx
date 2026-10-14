"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, CheckCircle2, RotateCcw, Clock, UserRound, PanelRight } from "lucide-react";
import type { ConversationStage, ConversationStatus } from "@prisma/client";
import { assignConversation, assignToMe, setConversationLabels, setConversationStage, setConversationStatus, setEstimatedValue } from "@/lib/inbox/actions";
import { STAGES, STAGE_LABELS, MAX_LABELS } from "@/lib/inbox/constants";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Select, Input } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult<unknown>>, onError?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error);
        onError?.();
      } else {
        if (r.message) toast.success(r.message);
        router.refresh();
      }
    });
  return { pending, run };
}

export function AssignSelect({ storeId, conversationId, value, members, canAssign, currentUserId }: { storeId: string; conversationId: string; value: string | null; members: { id: string; name: string }[]; canAssign: boolean; currentUserId: string }) {
  const id = useId();
  const [current, setCurrent] = useState(value ?? "");
  const { pending, run } = useRun();
  if (!canAssign) {
    const name = members.find((m) => m.id === value)?.name;
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink">{name ?? "Non attribuée"}</p>
        {value !== currentUserId && (
          <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => assignToMe(storeId, conversationId))}>
            <UserRound className="size-4" aria-hidden /> Me l&apos;attribuer
          </Button>
        )}
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Attribuer à
      </label>
      <Select
        id={id}
        value={current}
        disabled={pending}
        className="h-11 text-sm"
        onChange={(e) => {
          const prev = current;
          setCurrent(e.target.value);
          run(() => assignConversation(storeId, conversationId, e.target.value || null), () => setCurrent(prev));
        }}
      >
        <option value="">Non attribuée</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.id === currentUserId ? " (vous)" : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function StageSelect({ storeId, conversationId, value, disabled }: { storeId: string; conversationId: string; value: ConversationStage; disabled?: boolean }) {
  const id = useId();
  const [current, setCurrent] = useState(value);
  const { pending, run } = useRun();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Étape de l&apos;entonnoir
      </label>
      <Select
        id={id}
        value={current}
        disabled={pending || disabled}
        className="h-11 text-sm"
        onChange={(e) => {
          const prev = current;
          const next = e.target.value as ConversationStage;
          setCurrent(next);
          run(() => setConversationStage(storeId, conversationId, next), () => setCurrent(prev));
        }}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function LabelsEditor({ storeId, conversationId, labels, suggestions, disabled }: { storeId: string; conversationId: string; labels: string[]; suggestions: string[]; disabled?: boolean }) {
  const id = useId();
  const [items, setItems] = useState(labels);
  const [draft, setDraft] = useState("");
  const { pending, run } = useRun();

  const save = (next: string[]) => {
    const prev = items;
    setItems(next);
    run(() => setConversationLabels(storeId, conversationId, next), () => setItems(prev));
  };
  const add = () => {
    const l = draft.trim().toLowerCase().slice(0, 24);
    setDraft("");
    if (!l || items.includes(l)) return;
    if (items.length >= MAX_LABELS) return toast.error(`${MAX_LABELS} étiquettes maximum`);
    save([...items, l]);
  };

  return (
    <div>
      {items.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Étiquettes">
          {items.map((l) => (
            <li key={l} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2.5 pr-1 text-xs font-medium text-ink">
              {l}
              {!disabled && (
                <button type="button" onClick={() => save(items.filter((x) => x !== l))} className="inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:bg-line hover:text-ink" aria-label={`Retirer l'étiquette ${l}`} disabled={pending}>
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-sm text-ink-muted">Aucune étiquette.</p>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <label htmlFor={id} className="sr-only">
            Ajouter une étiquette
          </label>
          <Input
            id={id}
            value={draft}
            list={`${id}-list`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            maxLength={24}
            placeholder="vip, livraison, relance…"
            className="h-11 text-sm"
          />
          <datalist id={`${id}-list`}>
            {suggestions.filter((s) => !items.includes(s)).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Button type="button" variant="outline" size="icon" onClick={add} aria-label="Ajouter l'étiquette" disabled={pending || !draft.trim()}>
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

export function EstimatedValueForm({ storeId, conversationId, value, currency, disabled }: { storeId: string; conversationId: string; value: number | null; currency: string; disabled?: boolean }) {
  const id = useId();
  const [state, action, pending] = useActionState(setEstimatedValue, undefined);
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Enregistré");
    else toast.error(state.error);
  }, [state]);
  const zeroDecimal = currency === "XOF" || currency === "XAF";
  return (
    <form action={action} className="flex gap-2">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor={id} className="sr-only">
        Valeur estimée {zeroDecimal ? "en FCFA" : `en ${currency}`}
      </label>
      <Input id={id} name="estimatedValue" key={value ?? "none"} defaultValue={value == null ? "" : zeroDecimal ? value : (value / 100).toFixed(2)} inputMode="decimal" placeholder={zeroDecimal ? "Ex. 25000" : "Ex. 49,90"} className="h-11 text-sm tabular" disabled={disabled} />
      <Button type="submit" variant="outline" size="sm" className="h-11" loading={pending} disabled={disabled}>
        OK
      </Button>
    </form>
  );
}

export function StatusActions({ storeId, conversationId, status }: { storeId: string; conversationId: string; status: ConversationStatus }) {
  const { pending, run } = useRun();
  if (status === "CLOSED") {
    return (
      <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => setConversationStatus(storeId, conversationId, "OPEN"))}>
        <RotateCcw className="size-4" aria-hidden /> Rouvrir
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {status !== "PENDING" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setConversationStatus(storeId, conversationId, "PENDING"))} title="Mettre en attente">
          <Clock className="size-4" aria-hidden /> <span className="hidden sm:inline">En attente</span>
        </Button>
      )}
      <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => setConversationStatus(storeId, conversationId, "CLOSED"))}>
        <CheckCircle2 className="size-4" aria-hidden /> Fermer
      </Button>
    </div>
  );
}

/** Fiche client en panneau latéral sous 1280 px. */
export function CustomerSheet({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="icon" variant="ghost" className="xl:hidden" onClick={() => setOpen(true)} aria-label="Afficher la fiche client" aria-haspopup="dialog">
        <PanelRight className="size-5" aria-hidden />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} sheet>
        {children}
      </Dialog>
    </>
  );
}
