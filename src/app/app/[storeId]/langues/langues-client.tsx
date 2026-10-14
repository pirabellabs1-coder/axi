"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages, Sparkles, Trash2 } from "lucide-react";
import { updateGlossary, updateLanguages, upsertTranslation, deleteTranslation, translateResources } from "@/lib/i18n/actions";
import { Button } from "@/components/ui/button";
import { Field, Checkbox, Select, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { toast } from "@/components/ui/toast";
import type { ResourceState } from "@/lib/i18n/service";
import { translationCost } from "@/lib/i18n/translate-ai";
import type { TranslatableResourceType } from "@/lib/i18n/resources";

/**
 * Écran marchand des langues (lot 2 §1.1) : choix des langues, glossaire, et tableau
 * « source / traduction / état » avec traduction manuelle ou par l'IA. Interface en français.
 */

/* ───────────────────────── Langues ───────────────────────── */

export function LanguagesForm({
  storeId,
  primary,
  secondary,
  overQuota,
  limit,
  options,
}: {
  storeId: string;
  primary: string;
  secondary: string[];
  overQuota: string[];
  limit: number | null;
  options: { code: string; label: string; rtl: boolean }[];
}) {
  const [state, action] = useActionState(updateLanguages, undefined);
  const [main, setMain] = useState(primary);
  const [picked, setPicked] = useState<string[]>([...secondary, ...overQuota]);
  const max = limit == null ? options.length : Math.max(0, limit - 1);
  const selected = picked.filter((c) => c !== main);

  function toggle(code: string, on: boolean) {
    setPicked((prev) => (on ? [...new Set([...prev, code])] : prev.filter((c) => c !== code)));
  }

  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} toastSuccess />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="secondary" value={selected.join(",")} />
      <Field id="primary-locale" label="Langue principale" hint="Langue de vos contenus d'origine, servie sans préfixe dans l'adresse." error={fieldError(state, "primary")} className="max-w-sm">
        {(p) => (
          <Select {...p} name="primary" value={main} onChange={(e) => setMain(e.target.value)}>
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">
          Langues supplémentaires{" "}
          <span className="font-normal text-ink-muted tabular">
            ({selected.length}
            {limit == null ? "" : ` / ${max}`})
          </span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options
            .filter((o) => o.code !== main)
            .map((o) => {
              const on = selected.includes(o.code);
              const blocked = !on && limit != null && selected.length >= max;
              return (
                <Checkbox
                  key={o.code}
                  checked={on}
                  disabled={blocked}
                  onChange={(e) => toggle(o.code, e.target.checked)}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {o.label}
                      {o.rtl && <Badge tone="neutral">droite à gauche</Badge>}
                    </span>
                  }
                  description={blocked ? "Quota du plan atteint" : undefined}
                />
              );
            })}
        </div>
        {fieldError(state, "secondary") && <p className="mt-2 text-sm text-danger">{fieldError(state, "secondary")}</p>}
      </fieldset>
      <SubmitButton>
        <Check className="size-4" aria-hidden /> Enregistrer les langues
      </SubmitButton>
    </form>
  );
}

/* ───────────────────────── Glossaire ───────────────────────── */

export function GlossaryForm({ storeId, terms }: { storeId: string; terms: string[] }) {
  const [state, action] = useActionState(updateGlossary, undefined);
  return (
    <form action={action} noValidate className="space-y-3">
      <FormMessage state={state} toastSuccess />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="glossary" label="Termes protégés" hint="Un terme par ligne. Ils sont reproduits à l'identique par la traduction automatique." error={fieldError(state, "terms")}>
        {(p) => <Textarea {...p} name="terms" defaultValue={terms.join("\n")} rows={4} placeholder={"Chez Aïcha\npagne wax"} />}
      </Field>
      <SubmitButton variant="secondary">Enregistrer le glossaire</SubmitButton>
    </form>
  );
}

/* ───────────────────────── Sélecteurs de langue et de ressource ───────────────────────── */

export function ResourceTabs({
  storeId,
  locale,
  locales,
  type,
  types,
}: {
  storeId: string;
  locale: string;
  locales: { code: string; label: string }[];
  type: TranslatableResourceType;
  types: { value: string; label: string }[];
}) {
  const router = useRouter();
  const go = (next: { langue?: string; type?: string }) =>
    router.push(`/app/${storeId}/langues?langue=${next.langue ?? locale}&type=${next.type ?? type}`);
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3 sm:px-5">
      <Field id="tr-locale" label="Langue" className="w-44">
        {(p) => (
          <Select {...p} fieldSize="sm" value={locale} onChange={(e) => go({ langue: e.target.value })}>
            {locales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="tr-type" label="Contenu" className="w-56">
        {(p) => (
          <Select {...p} fieldSize="sm" value={type} onChange={(e) => go({ type: e.target.value })}>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

/* ───────────────────────── Traduction par l'IA ───────────────────────── */

export function TranslateAllButton({
  storeId,
  locale,
  resourceType,
  available,
  planName,
  chars,
}: {
  storeId: string;
  locale: string;
  resourceType: TranslatableResourceType;
  available: boolean;
  planName: string;
  chars: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!available) {
    return <span className="text-sm text-ink-muted">Traduction par l&apos;IA incluse à partir du plan Business (plan actuel : {planName}).</span>;
  }
  if (chars === 0) return <span className="text-sm text-ink-muted">Tout est traduit sur cette page.</span>;
  const cost = translationCost(chars);

  function run() {
    start(async () => {
      const res = await translateResources({ storeId, locale, resourceType, ids: [] });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Traduction terminée.");
      if (res.data?.rejected.length) toast.info(`${res.data.rejected.length} champ(s) non traduit(s)`, `Motif : ${res.data.rejected[0]!.reason}.`);
      router.refresh();
    });
  }

  return (
    <Button variant="secondary" onClick={run} loading={pending}>
      <Sparkles className="size-4" aria-hidden /> Traduire par l&apos;IA ({cost} crédit{cost > 1 ? "s" : ""})
    </Button>
  );
}

/* ───────────────────────── Tableau source / traduction / état ───────────────────────── */

export function TranslationList({ storeId, locale, resourceType, resources }: { storeId: string; locale: string; resourceType: TranslatableResourceType; resources: ResourceState[] }) {
  return (
    <ul className="divide-y divide-line">
      {resources.map((r) => (
        <li key={r.id} className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Languages className="size-4 text-ink-muted" aria-hidden />
            <span className="text-[15px] font-semibold text-ink">{r.label}</span>
            <Badge tone={r.translated === r.total ? "success" : r.translated === 0 ? "neutral" : "info"}>
              <span className="tabular">
                {r.translated} / {r.total}
              </span>
            </Badge>
            {r.stale > 0 && <Badge tone="warning">{r.stale} à revoir</Badge>}
          </div>
          <div className="mt-3 space-y-3">
            {r.fieldStates.map((f) => (
              <FieldRow key={f.field} storeId={storeId} locale={locale} resourceType={resourceType} resourceId={r.id} field={f} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function FieldRow({
  storeId,
  locale,
  resourceType,
  resourceId,
  field,
}: {
  storeId: string;
  locale: string;
  resourceType: TranslatableResourceType;
  resourceId: string;
  field: ResourceState["fieldStates"][number];
}) {
  const [state, action] = useActionState(upsertTranslation, undefined);
  const [removeState, remove] = useActionState(deleteTranslation, undefined);
  const long = field.kind !== "short";
  return (
    <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{field.label}</span>
        {field.value === null ? (
          <Badge tone="neutral">Non traduit</Badge>
        ) : field.stale ? (
          <Badge tone="warning">À revoir : texte d&apos;origine modifié</Badge>
        ) : (
          <Badge tone="success">Traduit</Badge>
        )}
        {field.origin === "AI" && <Badge tone="info">Traduction automatique</Badge>}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink-muted">{field.source}</p>
      <form action={action} noValidate className="mt-2 space-y-2">
        <FormMessage state={state} toastSuccess />
        <FormMessage state={removeState} toastSuccess />
        <input type="hidden" name="storeId" value={storeId} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="resourceType" value={resourceType} />
        <input type="hidden" name="resourceId" value={resourceId} />
        <input type="hidden" name="field" value={field.field} />
        <label className="sr-only" htmlFor={`tr-${resourceId}-${field.field}`}>
          Traduction de « {field.label} »
        </label>
        <Textarea
          id={`tr-${resourceId}-${field.field}`}
          name="value"
          defaultValue={field.value ?? ""}
          rows={long ? 4 : 2}
          className={long ? undefined : "min-h-11"}
          placeholder="Laissez vide pour afficher le texte d'origine"
          invalid={!!fieldError(state, "value")}
        />
        {fieldError(state, "value") && <p className="text-sm text-danger">{fieldError(state, "value")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton size="sm" variant="secondary">
            Enregistrer
          </SubmitButton>
          {field.value !== null && (
            <Button type="submit" size="sm" variant="ghost" formAction={remove}>
              <Trash2 className="size-4" aria-hidden /> Retirer
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
