"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { createLibraryItem, deleteLibraryItem, moveLibraryItem, setLibraryItemPreview, setLibraryItemPublished, updateLibraryItem } from "@/lib/section-library/admin-actions";
import { LIBRARY_CATEGORIES, parseLibraryJson } from "@/lib/section-library/rules";
import { PLAN_ORDER, PLANS, type PlanId } from "@/config/plans";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";

export type LibraryAdminDTO = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  premium: boolean;
  minPlan: PlanId;
  published: boolean;
  previewUrl: string | null;
  sectionType: string;
  payloadJson: string;
};

type FormState = { slug: string; name: string; description: string; category: string; tags: string; premium: boolean; minPlan: PlanId; payloadJson: string };

const EXAMPLE = JSON.stringify(
  { type: "trust-badges", settings: { scheme: "surface" }, blocks: [{ type: "badge", settings: { icon: "truck", title: "Livraison en 24 h", text: "À Cotonou et Abomey-Calavi" } }] },
  null,
  2,
);

function initial(it?: LibraryAdminDTO): FormState {
  return {
    slug: it?.slug ?? "",
    name: it?.name ?? "",
    description: it?.description ?? "",
    category: it?.category ?? LIBRARY_CATEGORIES[0],
    tags: it?.tags.join(", ") ?? "",
    premium: it?.premium ?? false,
    minPlan: it?.minPlan ?? "FREE",
    payloadJson: it?.payloadJson ?? EXAMPLE,
  };
}

const iconBtn = "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 sm:size-9";

export function LibraryItemDialogButton({ item, canEdit }: { item?: LibraryAdminDTO; canEdit: boolean }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormState>(() => initial(item));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  // Validation locale immédiate (mêmes règles que le serveur, hors détection des médias S3).
  const check = parseLibraryJson(f.payloadJson);

  const submit = () =>
    start(async () => {
      const input = { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) };
      const r = item ? await updateLibraryItem(item.id, input) : await createLibraryItem(input);
      if (r.ok) {
        toast.success(r.message ?? "Enregistré");
        setOpen(false);
        setErrors({});
        setError(null);
        if (!item) setF(initial());
      } else {
        setError(r.error);
        setErrors(r.fieldErrors ?? {});
      }
    });

  return (
    <>
      {item ? (
        <button type="button" className={iconBtn} onClick={() => { setF(initial(item)); setOpen(true); }} aria-label={`Modifier ${item.name}`}>
          <Pencil className="size-4" aria-hidden />
        </button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nouvel élément
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={item ? `Modifier « ${item.name} »` : "Nouvel élément de bibliothèque"}
        description="Section validée par le moteur de thème. Aucun identifiant de produit ou de collection : laissez ces réglages vides."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button onClick={submit} loading={pending} disabled={!check.ok}>{item ? "Enregistrer" : "Ajouter (non publié)"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={`${uid}-name`} label="Nom" required error={errors.name?.[0]}>
              {(p) => <Input {...p} value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Garanties livraison et paiement" />}
            </Field>
            <Field id={`${uid}-slug`} label="Identifiant" required error={errors.slug?.[0]} hint="Minuscules, chiffres, tirets.">
              {(p) => <Input {...p} value={f.slug} maxLength={64} className="font-mono" autoCapitalize="none" spellCheck={false} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="garanties-livraison" />}
            </Field>
          </div>
          <Field id={`${uid}-desc`} label="Description" error={errors.description?.[0]}>
            {(p) => <Input {...p} value={f.description} maxLength={300} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id={`${uid}-cat`} label="Catégorie" error={errors.category?.[0]}>
              {(p) => (
                <Select {...p} value={f.category} onChange={(e) => set("category", e.target.value)}>
                  {[...new Set([...LIBRARY_CATEGORIES, f.category])].map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field id={`${uid}-plan`} label="Plan minimal" error={errors.minPlan?.[0]} hint={f.premium ? "Premium : Business au minimum." : undefined}>
              {(p) => (
                <Select {...p} value={f.minPlan} onChange={(e) => set("minPlan", e.target.value as PlanId)}>
                  {PLAN_ORDER.map((pl) => <option key={pl} value={pl}>{PLANS[pl].name}</option>)}
                </Select>
              )}
            </Field>
            <Field id={`${uid}-tags`} label="Mots-clés" hint="Séparés par des virgules." error={errors.tags?.[0]}>
              {(p) => <Input {...p} value={f.tags} onChange={(e) => set("tags", e.target.value)} />}
            </Field>
          </div>
          <Checkbox label="Premium" description="Réservé aux plans qui incluent les sections premium (contrôlé côté serveur à l'insertion)." checked={f.premium} onChange={(e) => set("premium", e.target.checked)} />
          <Field id={`${uid}-json`} label="Section (JSON)" required error={errors.payloadJson?.[0] ?? (check.ok ? undefined : check.errors[0])} hint={check.ok ? `Section valide : ${check.payload.blocks.length} bloc${check.payload.blocks.length > 1 ? "s" : ""}.` : undefined}>
            {(p) => <Textarea {...p} value={f.payloadJson} spellCheck={false} className="min-h-64 font-mono text-[13px]" onChange={(e) => set("payloadJson", e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}

export function LibraryRowActions({ item, canEdit, first, last }: { item: LibraryAdminDTO; canEdit: boolean; first: boolean; last: boolean }) {
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  if (!canEdit) return null;
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Enregistré");
      else toast.error(r.error ?? "Échec");
    });
  const upload = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    run(() => setLibraryItemPreview(item.id, fd));
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div className="inline-flex items-center gap-0.5">
      <button type="button" className={iconBtn} disabled={pending || first} onClick={() => run(() => moveLibraryItem(item.id, "up"))} aria-label={`Monter ${item.name}`}>
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button type="button" className={iconBtn} disabled={pending || last} onClick={() => run(() => moveLibraryItem(item.id, "down"))} aria-label={`Descendre ${item.name}`}>
        <ArrowDown className="size-4" aria-hidden />
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => upload(e.target.files?.[0])} />
      <button type="button" className={iconBtn} disabled={pending} onClick={() => fileRef.current?.click()} aria-label={`Image d'aperçu de ${item.name}`}>
        <ImagePlus className="size-4" aria-hidden />
      </button>
      <button type="button" className={iconBtn} disabled={pending} onClick={() => run(() => setLibraryItemPublished(item.id, !item.published))} aria-label={item.published ? `Retirer ${item.name} de la bibliothèque` : `Publier ${item.name}`}>
        {item.published ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
      <LibraryItemDialogButton item={item} canEdit={canEdit} />
      <ConfirmButton className={iconBtn} title={`Supprimer « ${item.name} » ?`} description="Les sections déjà insérées dans les boutiques ne sont pas modifiées." confirmLabel="Supprimer" onConfirm={() => run(() => deleteLibraryItem(item.id))} disabled={pending}>
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {item.name}</span>
      </ConfirmButton>
    </div>
  );
}
