"use client";

import { useActionState, useState } from "react";
import { CalendarClock, Eye, Pencil, Trash2, X } from "lucide-react";
import { cancelThemeSchedule, createThemeSchedule, deleteThemeSchedule, updateThemeSchedule } from "@/lib/theme-schedules/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ConfirmActionButton } from "@/components/app/action-controls";

export type OccasionOptionDTO = {
  id: string;
  name: string;
  description: string;
  /** Date mobile : aucune suggestion, le commerçant saisit les dates. */
  movable: boolean;
  startsAt: string | null;
  endsAt: string | null;
  countdown: boolean;
  announcement: string;
};

export type ScheduleDTO = {
  id: string;
  name: string;
  occasionName: string | null;
  status: string;
  statusLabel: string;
  tone: BadgeTone;
  startsAtLocal: string;
  endsAtLocal: string;
  startsLabel: string;
  endsLabel: string;
  previewHref: string;
  afterHref: string;
  editable: boolean;
};

const iconBtn = "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2";

/* ───────────── Création ───────────── */

export function ScheduleForm({ storeId, occasions, hasPublished, defaultStart }: { storeId: string; occasions: OccasionOptionDTO[]; hasPublished: boolean; defaultStart: string }) {
  const [state, action] = useActionState(createThemeSchedule, undefined);
  const [occasionId, setOccasionId] = useState(occasions[0]?.id ?? "");
  const occasion = occasions.find((o) => o.id === occasionId) ?? null;
  const [name, setName] = useState(occasions[0]?.name ?? "");
  const [startsAt, setStartsAt] = useState(occasions[0]?.startsAt ?? defaultStart);
  const [endsAt, setEndsAt] = useState(occasions[0]?.endsAt ?? "");

  const pick = (id: string) => {
    setOccasionId(id);
    const next = occasions.find((o) => o.id === id);
    if (!next) return;
    setName(next.name);
    setStartsAt(next.startsAt ?? defaultStart);
    setEndsAt(next.endsAt ?? "");
  };

  return (
    <form action={action} noValidate className="space-y-4 px-5 pb-6 sm:px-6">
      <FormMessage state={state} toastSuccess />
      <input type="hidden" name="storeId" value={storeId} />

      <Field id="sch-occasion" label="Occasion" error={fieldError(state, "occasion")} hint={occasion ? occasion.description : undefined}>
        {(p) => (
          <Select {...p} name="occasion" value={occasionId} onChange={(e) => pick(e.target.value)}>
            {occasions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.movable ? " (dates à saisir)" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {occasion && (
        <p className="rounded-[var(--radius-md)] bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
          Annonce prévue : « {occasion.announcement} »
        </p>
      )}

      <Field id="sch-name" label="Nom de la programmation" required error={fieldError(state, "name")} hint="Visible par vous seulement.">
        {(p) => <Input {...p} name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="sch-start" label="Début" required error={fieldError(state, "startsAt")} hint="Heure de votre boutique.">
          {(p) => <Input {...p} type="datetime-local" name="startsAt" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
        </Field>
        <Field id="sch-end" label="Fin" required error={fieldError(state, "endsAt")} hint="À la seconde : le thème normal revient aussitôt.">
          {(p) => <Input {...p} type="datetime-local" name="endsAt" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
        </Field>
      </div>

      {occasion?.movable && (
        <p className="text-sm text-warning">Cette fête n&apos;a pas de date fixe : saisissez vous-même le début et la fin.</p>
      )}

      <Field id="sch-source" label="Partir de" error={fieldError(state, "source")} hint="Une copie est faite : votre thème en ligne n'est pas modifié.">
        {(p) => (
          <Select {...p} name="source" defaultValue="published">
            <option value="published">{hasPublished ? "Mon thème publié" : "Mon thème actuel"}</option>
            <option value="draft">Mon brouillon en cours</option>
          </Select>
        )}
      </Field>

      <div className="space-y-2">
        <Checkbox name="banner" defaultChecked label="Ajouter une bannière en haut de l'accueil" />
        <Checkbox name="countdown" defaultChecked={occasion?.countdown ?? true} label="Ajouter un compte à rebours jusqu'à la fin" description={occasion?.countdown ? undefined : "Ce préréglage n'en prévoit pas : la case reste sans effet."} />
      </div>

      <div className="flex justify-end">
        <SubmitButton>
          <CalendarClock className="size-4" aria-hidden /> Programmer
        </SubmitButton>
      </div>
    </form>
  );
}

/* ───────────── Liste ───────────── */

export function ScheduleList({ storeId, schedules }: { storeId: string; schedules: ScheduleDTO[] }) {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {schedules.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-ink">{s.name}</span>
              <Badge tone={s.tone}>{s.statusLabel}</Badge>
              {s.occasionName && <span className="text-sm text-ink-muted">{s.occasionName}</span>}
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              Du {s.startsLabel} au {s.endsLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <ButtonLink href={s.previewHref} target="_blank" rel="noopener" variant="ghost" size="sm">
              <Eye className="size-4" aria-hidden /> Voir à cette date
            </ButtonLink>
            <ButtonLink href={s.afterHref} target="_blank" rel="noopener" variant="ghost" size="sm">
              Après la fin
            </ButtonLink>
            {s.editable && <EditDialog storeId={storeId} schedule={s} />}
            {s.editable && (
              <ConfirmActionButton
                action={() => cancelThemeSchedule(storeId, s.id)}
                title={`Annuler « ${s.name} » ?`}
                description="La boutique revient immédiatement au thème normal. La programmation est conservée dans l'historique."
                confirmLabel="Annuler la programmation"
                className={iconBtn}
              >
                <X className="size-4" aria-hidden />
                <span className="sr-only">Annuler {s.name}</span>
              </ConfirmActionButton>
            )}
            <ConfirmActionButton
              action={() => deleteThemeSchedule(storeId, s.id)}
              title={`Supprimer « ${s.name} » ?`}
              description="La programmation et son thème de fête sont supprimés définitivement."
              confirmLabel="Supprimer"
              className={iconBtn}
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Supprimer {s.name}</span>
            </ConfirmActionButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EditDialog({ storeId, schedule }: { storeId: string; schedule: ScheduleDTO }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateThemeSchedule, undefined);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={`Modifier ${schedule.name}`} onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={schedule.name} description="Nom et période. Le thème de fête lui-même reste inchangé.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="scheduleId" value={schedule.id} />
          <Field id={`name-${schedule.id}`} label="Nom" required error={fieldError(state, "name")}>
            {(p) => <Input {...p} name="name" defaultValue={schedule.name} maxLength={60} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={`start-${schedule.id}`} label="Début" required error={fieldError(state, "startsAt")}>
              {(p) => <Input {...p} type="datetime-local" name="startsAt" defaultValue={schedule.startsAtLocal} />}
            </Field>
            <Field id={`end-${schedule.id}`} label="Fin" required error={fieldError(state, "endsAt")}>
              {(p) => <Input {...p} type="datetime-local" name="endsAt" defaultValue={schedule.endsAtLocal} />}
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
