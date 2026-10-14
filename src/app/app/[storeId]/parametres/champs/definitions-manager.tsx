"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { createMetafieldDefinition, deleteMetafieldDefinition, setMetafieldDefinitionPin, updateMetafieldDefinition } from "@/lib/metafields/actions";
import { DEFAULT_NAMESPACE, keyFromName, METAFIELD_TYPE_META, METAFIELD_TYPES, OWNER_LABELS, ownerCanBePublic, type MetafieldDefinitionDTO, type MetafieldOwnerType, type MetafieldType } from "@/lib/metafields/types";
import { normalizeValidations } from "@/lib/metafields/validate";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";

type FormState = {
  name: string;
  namespace: string;
  key: string;
  keyTouched: boolean;
  description: string;
  type: MetafieldType;
  min: string;
  max: string;
  regex: string;
  choices: string;
  storefrontVisible: boolean;
  pinned: boolean;
};

function initial(def?: MetafieldDefinitionDTO): FormState {
  return {
    name: def?.name ?? "",
    namespace: def?.namespace ?? DEFAULT_NAMESPACE,
    key: def?.key ?? "",
    keyTouched: !!def,
    description: def?.description ?? "",
    type: def?.type ?? "single_line_text",
    min: def?.validations.min?.toString() ?? "",
    max: def?.validations.max?.toString() ?? "",
    regex: def?.validations.regex ?? "",
    choices: def?.validations.choices?.join("\n") ?? "",
    storefrontVisible: def?.storefrontVisible ?? true,
    pinned: def ? def.pinnedPosition !== null : true,
  };
}

const GROUPS = ["Texte", "Nombre", "Référence", "Autre"] as const;
const RANGE_LABEL = { length: ["Longueur minimale", "Longueur maximale"], value: ["Valeur minimale", "Valeur maximale"], items: ["", "Nombre d'éléments maximum"] } as const;

const iconBtn = "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 sm:size-9";

export function DefinitionDialogButton({ storeId, ownerType, definition, disabled }: { storeId: string; ownerType: MetafieldOwnerType; definition?: MetafieldDefinitionDTO; disabled?: boolean }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormState>(() => initial(definition));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const owner = definition?.ownerType ?? ownerType;
  const meta = METAFIELD_TYPE_META[f.type];
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const publicOwner = ownerCanBePublic(owner);
  const validationsPreview = useMemo(() => normalizeValidations(f.type, { min: f.min, max: f.max, regex: f.regex, choices: f.choices }), [f.type, f.min, f.max, f.regex, f.choices]);

  const submit = () =>
    start(async () => {
      const validations = { min: f.min, max: f.max, regex: f.regex, choices: f.choices };
      const r = definition
        ? await updateMetafieldDefinition(storeId, definition.id, { name: f.name, description: f.description, validations, storefrontVisible: f.storefrontVisible })
        : await createMetafieldDefinition(storeId, { ownerType: owner, namespace: f.namespace, key: f.key, name: f.name, description: f.description, type: f.type, validations, storefrontVisible: f.storefrontVisible, pinned: f.pinned });
      if (r.ok) {
        toast.success(r.message ?? "Enregistré");
        setOpen(false);
        setErrors({});
        setError(null);
        if (!definition) setF(initial());
      } else {
        setError(r.error);
        setErrors(r.fieldErrors ?? {});
      }
    });

  return (
    <>
      {definition ? (
        <button type="button" className={iconBtn} onClick={() => { setF(initial(definition)); setOpen(true); }} aria-label={`Modifier le champ ${definition.name}`} disabled={disabled}>
          <Pencil className="size-4" aria-hidden />
        </button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
          <Plus className="size-4" aria-hidden /> Nouveau champ
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={definition ? `Modifier « ${definition.name} »` : `Nouveau champ : ${OWNER_LABELS[owner].toLowerCase()}`}
        description={definition ? "Le type et la clé ne changent pas après la création." : "Le champ apparaîtra dans le formulaire de chaque élément."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button onClick={submit} loading={pending}>{definition ? "Enregistrer" : "Créer le champ"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field id={`${uid}-name`} label="Nom" required error={errors.name?.[0]} hint="Affiché dans les formulaires et, si visible, dans la boutique.">
            {(p) => (
              <Input
                {...p}
                value={f.name}
                maxLength={80}
                placeholder="Matière"
                onChange={(e) => setF((s) => ({ ...s, name: e.target.value, key: s.keyTouched ? s.key : keyFromName(e.target.value) }))}
              />
            )}
          </Field>
          {!definition && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
                <Field id={`${uid}-ns`} label="Espace de noms" error={errors.namespace?.[0]}>
                  {(p) => <Input {...p} value={f.namespace} maxLength={32} autoCapitalize="none" spellCheck={false} className="font-mono" onChange={(e) => set("namespace", e.target.value.toLowerCase())} />}
                </Field>
                <Field id={`${uid}-key`} label="Clé" required error={errors.key?.[0]} hint={`Source dynamique : ${owner === "COLLECTION" ? "collection" : owner === "PAGE" ? "page" : owner === "STORE" ? "store" : "product"}.metafields.${f.namespace || "custom"}.${f.key || "cle"}`}>
                  {(p) => <Input {...p} value={f.key} maxLength={64} autoCapitalize="none" spellCheck={false} className="font-mono" onChange={(e) => setF((s) => ({ ...s, key: e.target.value.toLowerCase(), keyTouched: true }))} />}
                </Field>
              </div>
              <Field id={`${uid}-type`} label="Type" error={errors.type?.[0]} hint={meta.hint}>
                {(p) => (
                  <Select {...p} value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value as MetafieldType, min: "", max: "", regex: "", choices: "" }))}>
                    {GROUPS.map((g) => (
                      <optgroup key={g} label={g}>
                        {METAFIELD_TYPES.filter((t) => METAFIELD_TYPE_META[t].group === g).map((t) => <option key={t} value={t}>{METAFIELD_TYPE_META[t].label}</option>)}
                      </optgroup>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          <Field id={`${uid}-desc`} label="Aide (facultatif)" error={errors.description?.[0]}>
            {(p) => <Input {...p} value={f.description} maxLength={300} placeholder="Ex. composition principale du tissu" onChange={(e) => set("description", e.target.value)} />}
          </Field>

          {meta.validations.length > 0 && (
            <fieldset className="space-y-4 rounded-[var(--radius-md)] p-4 ring-1 ring-line">
              <legend className="px-1 text-sm font-medium text-ink">Validations</legend>
              {(meta.validations.includes("min") || meta.validations.includes("max")) && meta.range && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {meta.validations.includes("min") && (
                    <Field id={`${uid}-min`} label={RANGE_LABEL[meta.range][0]} hint={f.type === "rating" ? "Défaut : 0" : undefined}>
                      {(p) => <Input {...p} type="number" inputMode="decimal" value={f.min} onChange={(e) => set("min", e.target.value)} />}
                    </Field>
                  )}
                  {meta.validations.includes("max") && (
                    <Field id={`${uid}-max`} label={RANGE_LABEL[meta.range][1]} hint={f.type === "rating" ? "Défaut : 5" : undefined}>
                      {(p) => <Input {...p} type="number" inputMode="decimal" value={f.max} onChange={(e) => set("max", e.target.value)} />}
                    </Field>
                  )}
                </div>
              )}
              {meta.validations.includes("choices") && (
                <Field id={`${uid}-choices`} label="Liste de choix (facultatif)" hint="Une valeur par ligne. Vide = saisie libre.">
                  {(p) => <Textarea {...p} value={f.choices} className="min-h-20" placeholder={"Coton\nWax hollandais\nBazin"} onChange={(e) => set("choices", e.target.value)} />}
                </Field>
              )}
              {meta.validations.includes("regex") && (
                <Field id={`${uid}-regex`} label="Format imposé (expression régulière, facultatif)" hint="Ex. [A-Z]{2}-[0-9]{4}. 100 caractères, sans quantificateurs imbriqués.">
                  {(p) => <Input {...p} value={f.regex} maxLength={100} spellCheck={false} className="font-mono" onChange={(e) => set("regex", e.target.value)} />}
                </Field>
              )}
              {!validationsPreview.ok && <p className="text-sm text-danger" role="alert">{validationsPreview.error}</p>}
              {errors.validations?.[0] && validationsPreview.ok && <p className="text-sm text-danger" role="alert">{errors.validations[0]}</p>}
            </fieldset>
          )}

          {publicOwner ? (
            <Checkbox label="Visible dans la boutique" description="Utilisable par les sources dynamiques et les sections du thème." checked={f.storefrontVisible} onChange={(e) => set("storefrontVisible", e.target.checked)} />
          ) : (
            <p className="text-sm text-ink-muted">Champ privé : les informations des {OWNER_LABELS[owner].toLowerCase()} ne sont jamais affichées dans la boutique.</p>
          )}
          {!definition && <Checkbox label="Épingler dans le formulaire" description="Toujours affiché ; sinon, replié sous « Afficher les autres champs »." checked={f.pinned} onChange={(e) => set("pinned", e.target.checked)} />}
        </div>
      </Dialog>
    </>
  );
}

export function DefinitionRowActions({ storeId, definition, values, canEdit, first, last }: { storeId: string; definition: MetafieldDefinitionDTO; values: number; canEdit: boolean; first: boolean; last: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Enregistré");
      else toast.error(r.error ?? "Échec");
    });
  const pinned = definition.pinnedPosition !== null;
  return (
    <div className="inline-flex items-center gap-0.5">
      {pinned && (
        <>
          <button type="button" className={iconBtn} disabled={pending || first} onClick={() => run(() => setMetafieldDefinitionPin(storeId, definition.id, "up"))} aria-label={`Monter ${definition.name}`}>
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button type="button" className={iconBtn} disabled={pending || last} onClick={() => run(() => setMetafieldDefinitionPin(storeId, definition.id, "down"))} aria-label={`Descendre ${definition.name}`}>
            <ArrowDown className="size-4" aria-hidden />
          </button>
        </>
      )}
      <button type="button" className={iconBtn} disabled={pending} onClick={() => run(() => setMetafieldDefinitionPin(storeId, definition.id, pinned ? "unpin" : "pin"))} aria-label={pinned ? `Désépingler ${definition.name}` : `Épingler ${definition.name}`}>
        {pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
      </button>
      <DefinitionDialogButton storeId={storeId} ownerType={definition.ownerType} definition={definition} disabled={!canEdit} />
      <ConfirmButton
        className={iconBtn}
        title={`Supprimer « ${definition.name} » ?`}
        description={values > 0 ? `Les ${values} valeur${values > 1 ? "s" : ""} renseignée${values > 1 ? "s" : ""} seront supprimées. Les sections du thème qui l'affichent reviendront à leur valeur par défaut.` : "Aucune valeur n'est renseignée pour ce champ."}
        confirmLabel="Supprimer"
        onConfirm={() => run(() => deleteMetafieldDefinition(storeId, definition.id))}
        disabled={pending}
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {definition.name}</span>
      </ConfirmButton>
    </div>
  );
}
