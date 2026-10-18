"use client";

import { useActionState, useEffect, useState } from "react";
import { MessageSquareText, Pin, Play, Radio, Square, Trash2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import type { BadgeTone } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";
import { deleteLiveEvent, pinLiveProduct, saveLiveEvent, setLiveEventStatus } from "@/lib/live/actions";

/**
 * Formulaires du live shopping (lot 4 §18). Les produits sont choisis par cases à cocher (jusqu'à 12) et
 * le produit « à l'écran » par un bouton d'épinglage : le serveur revérifie tout (produits actifs de la
 * boutique, lien de diffusion dans la liste blanche, plan).
 */

type ProductRef = { id: string; name: string };

export type EventRef = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  streamUrl: string;
  productIds: string[];
  pinnedId: string | null;
  status: string;
};

/** Valeur d'un `<input type="datetime-local">` depuis une date ISO (heure locale du navigateur). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LiveEventForm({ storeId, products, event, onDone }: { storeId: string; products: ProductRef[]; event?: EventRef; onDone?: () => void }) {
  const [state, action] = useActionState(saveLiveEvent, undefined);
  const [selected, setSelected] = useState<string[]>(event?.productIds ?? []);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 12 ? prev : [...prev, id]));
  };

  // Fermeture du formulaire d'édition une fois l'enregistrement confirmé (effet, jamais pendant le rendu).
  useEffect(() => {
    if (state?.ok) onDone?.();
  }, [state, onDone]);

  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      {event && <input type="hidden" name="eventId" value={event.id} />}
      {selected.map((id) => (
        <input key={id} type="hidden" name="productIds[]" value={id} />
      ))}

      <Field id={`title-${event?.id ?? "new"}`} label="Titre du direct" required error={fieldError(state, "title")}>
        {(p) => <Input {...p} name="title" defaultValue={event?.title ?? ""} maxLength={80} autoComplete="off" placeholder="Nouveautés de la rentrée" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`starts-${event?.id ?? "new"}`} label="Début" required error={fieldError(state, "startsAt")}>
          {(p) => <Input {...p} type="datetime-local" name="startsAt" defaultValue={toLocalInput(event?.startsAt ?? null)} />}
        </Field>
        <Field id={`ends-${event?.id ?? "new"}`} label="Fin (facultatif)" error={fieldError(state, "endsAt")} hint="Sans fin indiquée : 3 heures.">
          {(p) => <Input {...p} type="datetime-local" name="endsAt" defaultValue={toLocalInput(event?.endsAt ?? null)} />}
        </Field>
      </div>
      <Field id={`stream-${event?.id ?? "new"}`} label="Lien de la diffusion" required error={fieldError(state, "streamUrl")} hint="Adresse https de votre direct YouTube, Facebook, TikTok ou Instagram.">
        {(p) => <Textarea {...p} name="streamUrl" defaultValue={event?.streamUrl ?? ""} rows={2} maxLength={500} spellCheck={false} className="font-mono text-[13px]" />}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">
          Produits présentés <span className="font-normal text-ink-muted">({selected.length} / 12)</span>
        </legend>
        {products.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucun produit actif pour l&apos;instant.</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-md)] bg-surface-2 p-2 ring-1 ring-inset ring-line">
            {products.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-[10px] px-2 text-sm text-ink hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    disabled={!selected.includes(p.id) && selected.length >= 12}
                    className="size-5 shrink-0 accent-[var(--c-primary,currentColor)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton>{event ? "Enregistrer" : "Programmer le direct"}</SubmitButton>
      </div>
    </form>
  );
}

export function LiveEventRow({
  storeId,
  event,
  statusLabel,
  statusTone,
  when,
  products,
}: {
  storeId: string;
  event: EventRef;
  statusLabel: string;
  statusTone: BadgeTone;
  when: string;
  products: ProductRef[];
}) {
  const [editing, setEditing] = useState(false);
  const names = new Map(products.map((p) => [p.id, p.name]));

  return (
    <div className="rounded-[var(--radius-md)] bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            {event.title} <Badge tone={statusTone}>{statusLabel}</Badge>
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">{when}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.status !== "LIVE" ? (
            <ActionButton action={() => setLiveEventStatus(storeId, event.id, "LIVE")} variant="primary" size="sm" className="min-h-11">
              <Play className="size-4" aria-hidden /> Lancer
            </ActionButton>
          ) : (
            <ActionButton action={() => setLiveEventStatus(storeId, event.id, "ENDED")} variant="outline" size="sm" className="min-h-11">
              <Square className="size-4" aria-hidden /> Terminer
            </ActionButton>
          )}
          <ButtonLink href={`/app/${storeId}/live/${event.id}`} variant="secondary" size="sm" className="min-h-11">
            <MessageSquareText className="size-4" aria-hidden /> Réservations
          </ButtonLink>
          <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink-muted hover:text-ink">
            {editing ? "Fermer" : "Modifier"}
          </button>
          <ConfirmActionButton
            action={() => deleteLiveEvent(storeId, event.id)}
            className="min-h-11"
            title="Supprimer ce direct ?"
            description="Le compte à rebours disparaîtra de la boutique. Les inscrits au rappel restent dans vos clients."
            confirmLabel="Supprimer"
          >
            <Trash2 className="size-4" aria-hidden />
            <span className="sr-only">Supprimer le direct</span>
          </ConfirmActionButton>
        </div>
      </div>

      {event.productIds.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {event.productIds.map((id) => {
            const pinned = event.pinnedId === id;
            return (
              <li key={id}>
                <ActionButton
                  action={() => pinLiveProduct(storeId, event.id, pinned ? null : id)}
                  variant={pinned ? "primary" : "secondary"}
                  size="sm"
                  className="min-h-11"
                  aria-pressed={pinned}
                >
                  <Pin className="size-3.5" aria-hidden />
                  {names.get(id) ?? "Produit"}
                  <span className="sr-only">{pinned ? " : à l'écran, cliquez pour retirer" : " : mettre à l'écran"}</span>
                </ActionButton>
              </li>
            );
          })}
        </ul>
      )}
      {event.productIds.length > 0 && (
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <Radio className="size-3.5" aria-hidden /> Le produit à l&apos;écran apparaît en premier sur la boutique, en quinze secondes.
        </p>
      )}

      {editing && (
        <div className="mt-4 border-t border-line pt-4">
          <LiveEventForm storeId={storeId} products={products} event={event} onDone={() => setEditing(false)} />
        </div>
      )}
    </div>
  );
}
