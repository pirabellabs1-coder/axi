"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Pause, Play, Trash2 } from "lucide-react";
import { saveAnnouncement, toggleAnnouncement, deleteAnnouncement } from "@/lib/admin/platform-actions";
import { ANNOUNCEMENT_AUDIENCES, AUDIENCE_LABEL, ANNOUNCEMENT_TONES, TONE_LABEL, type AnnouncementAudience, type AnnouncementTone } from "@/lib/admin/announcements";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { AnnouncementBanners } from "./announcement-banners";

export type AnnouncementDTO = { id: string; title: string; body: string; tone: string; audience: string; startsAt: string; endsAt: string | null; active: boolean };

type FormState = { title: string; body: string; tone: AnnouncementTone; audience: AnnouncementAudience; startsAt: string; endsAt: string; active: boolean };

/** Date ISO → valeur d'un <input type="datetime-local"> (heure locale du navigateur). */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function initial(a?: AnnouncementDTO): FormState {
  return {
    title: a?.title ?? "",
    body: a?.body ?? "",
    tone: (a?.tone as AnnouncementTone) ?? "info",
    audience: (a?.audience as AnnouncementAudience) ?? "all",
    startsAt: toLocal(a?.startsAt ?? null),
    endsAt: toLocal(a?.endsAt ?? null),
    active: a?.active ?? true,
  };
}

export function AnnouncementDialogButton({ announcement, canEdit }: { announcement?: AnnouncementDTO; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormState>(() => initial(announcement));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = () =>
    start(async () => {
      const r = await saveAnnouncement(announcement?.id ?? null, {
        title: f.title,
        body: f.body,
        tone: f.tone,
        audience: f.audience,
        startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : undefined,
        endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
        active: f.active,
      });
      if (r.ok) {
        toast.success(r.message ?? "Enregistré");
        setOpen(false);
        setErrors({});
        setError(null);
        if (!announcement) setF(initial());
      } else {
        setError(r.error);
        setErrors(r.fieldErrors ?? {});
      }
    });

  return (
    <>
      {announcement ? (
        <button type="button" onClick={() => { setF(initial(announcement)); setOpen(true); }} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:size-9" aria-label={`Modifier l'annonce ${announcement.title}`}>
          <Pencil className="size-4" aria-hidden />
        </button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nouvelle annonce
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={announcement ? "Modifier l'annonce" : "Nouvelle annonce"}
        description="Bandeau discret en haut de l'espace marchand, fermable par chaque marchand."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button onClick={submit} loading={pending}>{announcement ? "Enregistrer" : "Publier"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && Object.keys(errors).length === 0 && <Alert tone="danger">{error}</Alert>}
          <Field id="a-title" label="Titre" required error={errors.title?.[0]}>
            {(p) => <Input {...p} value={f.title} maxLength={90} onChange={(e) => set("title", e.target.value)} placeholder="Nouveau : paiement Wave" />}
          </Field>
          <Field id="a-body" label="Texte" required error={errors.body?.[0]} hint={`${f.body.length} / 400`}>
            {(p) => <Textarea {...p} value={f.body} maxLength={400} onChange={(e) => set("body", e.target.value)} className="min-h-20" placeholder="Vos clients peuvent désormais payer avec Wave au Sénégal et en Côte d'Ivoire." />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="a-tone" label="Ton">
              {(p) => (
                <Select {...p} value={f.tone} onChange={(e) => set("tone", e.target.value as AnnouncementTone)}>
                  {ANNOUNCEMENT_TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
                </Select>
              )}
            </Field>
            <Field id="a-aud" label="Audience">
              {(p) => (
                <Select {...p} value={f.audience} onChange={(e) => set("audience", e.target.value as AnnouncementAudience)}>
                  {ANNOUNCEMENT_AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
                </Select>
              )}
            </Field>
            <Field id="a-start" label="Début" hint="Vide = maintenant" error={errors.startsAt?.[0]}>
              {(p) => <Input {...p} type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />}
            </Field>
            <Field id="a-end" label="Fin" hint="Vide = sans fin" error={errors.endsAt?.[0]}>
              {(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />}
            </Field>
          </div>
          <Checkbox label="Active" description="Décochez pour préparer l'annonce sans l'afficher." checked={f.active} onChange={(e) => set("active", e.target.checked)} />
          {f.title && f.body && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Aperçu</p>
              <AnnouncementBanners key={`${f.title}${f.body}${f.tone}`} items={[{ id: "preview", title: f.title, body: f.body, tone: f.tone }]} preview />
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}

export function AnnouncementRowActions({ announcement, canEdit }: { announcement: AnnouncementDTO; canEdit: boolean }) {
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  return (
    <div className="flex items-center justify-end gap-0.5">
      <AnnouncementDialogButton announcement={announcement} canEdit={canEdit} />
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await toggleAnnouncement(announcement.id); if (r.ok) toast.success(r.message ?? "Fait"); else toast.error(r.error); })}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50 sm:size-9"
        aria-label={announcement.active ? `Mettre en pause ${announcement.title}` : `Réactiver ${announcement.title}`}
        title={announcement.active ? "Mettre en pause" : "Réactiver"}
      >
        {announcement.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      </button>
      <ConfirmButton
        title="Supprimer cette annonce ?"
        description="Elle disparaît de l'espace marchand. L'action est journalisée."
        confirmLabel="Supprimer"
        onConfirm={async () => { const r = await deleteAnnouncement(announcement.id); if (r.ok) toast.success(r.message ?? "Supprimée"); else toast.error(r.error); }}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger sm:size-9"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {announcement.title}</span>
      </ConfirmButton>
    </div>
  );
}
