"use client";

import * as React from "react";
import { Lock, Plus, Trash2, Users, X } from "lucide-react";
import type { AudienceRuleType } from "@/config/plans";
import { AUDIENCE_CUSTOMER_SEGMENTS, AUDIENCE_DEVICES, AUDIENCE_SOURCES, MAX_VISIBILITY_RULES, type AudienceRule, type SectionVisibility } from "@/lib/theme-engine/types";
import { Input, Label, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { CUSTOMER_LABELS, DAY_LABELS, SOURCE_LABELS } from "./preview-doc";

export const RULE_LABELS: Record<AudienceRuleType, string> = {
  customer: "Type de client",
  city: "Ville",
  source: "Provenance",
  device: "Appareil",
  schedule: "Jours et heures",
  locale: "Langue",
};

const RULE_ORDER: AudienceRuleType[] = ["customer", "city", "source", "device", "schedule", "locale"];
const DEVICE_LABELS = { mobile: "Mobile", desktop: "Ordinateur" } as const;
const LOCALE_RE = /^[a-z]{2,3}$/;

/** Règle préremplie (une règle vide serait refusée à l'enregistrement). */
export function defaultRule(type: AudienceRuleType, city?: string | null): AudienceRule {
  switch (type) {
    case "customer":
      return { type, values: ["loyal"] };
    case "city":
      return { type, values: [city?.trim() || "Cotonou"] };
    case "source":
      return { type, values: ["whatsapp"] };
    case "device":
      return { type, values: ["mobile"] };
    case "locale":
      return { type, values: ["fr"] };
    case "schedule":
      return { type, days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" };
  }
}

/** Résumé lisible (arbre des sections, lecteur d'écran). */
export function visibilitySummary(v: SectionVisibility | undefined): string | null {
  if (!v || !v.rules.length) return null;
  const parts = v.rules.map((r) => RULE_LABELS[r.type].toLowerCase());
  return `${v.mode === "show" ? "Visible seulement selon" : "Masquée selon"} : ${parts.join(v.match === "all" ? " et " : " ou ")}`;
}

export function AudiencePanel({
  idPrefix,
  visibility,
  allowed,
  locked,
  storeId,
  storeCity,
  onChange,
}: {
  idPrefix: string;
  visibility: SectionVisibility | undefined;
  /** Types de règles inclus dans le plan (AUDIENCE_RULES_BY_PLAN). */
  allowed: AudienceRuleType[];
  /** Raison d'indisponibilité pour cette section (ex. section obligatoire du modèle). */
  locked?: string;
  storeId: string;
  storeCity?: string | null;
  onChange: (v: SectionVisibility | null) => void;
}) {
  const v = visibility;
  const mode: "all" | "show" | "hide" = v && v.rules.length ? v.mode : "all";
  const rules = v?.rules ?? [];
  const usedTypes = new Set(rules.map((r) => r.type));
  const addable = RULE_ORDER.filter((t) => allowed.includes(t) && !usedTypes.has(t));
  const lockedTypes = RULE_ORDER.filter((t) => !allowed.includes(t));
  const [adding, setAdding] = React.useState<AudienceRuleType | "">("");

  const update = (patch: Partial<SectionVisibility>) => onChange({ match: v?.match ?? "all", mode: v?.mode ?? "show", rules, ...patch });
  const setRule = (i: number, r: AudienceRule) => update({ rules: rules.map((x, j) => (j === i ? r : x)) });
  const removeRule = (i: number) => {
    const next = rules.filter((_, j) => j !== i);
    if (!next.length) onChange(null);
    else update({ rules: next });
  };
  const addRule = (type: AudienceRuleType) => {
    if (rules.length >= MAX_VISIBILITY_RULES) return;
    update({ rules: [...rules, defaultRule(type, storeCity)] });
    setAdding("");
  };

  if (locked) {
    return (
      <Shell>
        <p className="text-[13px] leading-relaxed text-ink-muted">{locked}</p>
      </Shell>
    );
  }

  if (!allowed.length) {
    return (
      <Shell>
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Montrez une section seulement à vos clients fidèles, aux visiteurs venus de WhatsApp ou de votre ville. Inclus à partir du plan Business (type de client) et complet à partir du plan Scale.{" "}
            <a href={`/app/${storeId}/abonnement`} className="font-medium text-primary underline-offset-4 hover:underline">
              Voir les plans
            </a>
          </span>
        </p>
        {rules.length > 0 && (
          <button type="button" onClick={() => onChange(null)} className="mt-2 inline-flex h-11 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink sm:h-9">
            <Trash2 className="size-3.5" aria-hidden /> Retirer les règles existantes
          </button>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <Segmented
        fill
        size="sm"
        label="Visibilité de la section"
        value={mode}
        onChange={(m) => {
          if (m === "all") onChange(null);
          else if (rules.length) update({ mode: m });
          else onChange({ match: "all", mode: m, rules: [defaultRule(addable[0] ?? allowed[0], storeCity)] });
        }}
        options={[
          { value: "all", label: "Tout le monde" },
          { value: "show", label: "Seulement si" },
          { value: "hide", label: "Sauf si" },
        ]}
      />
      {mode !== "all" && (
        <>
          {rules.length > 1 && (
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Conditions</span>
              <Segmented
                fill
                size="sm"
                label="Combinaison des conditions"
                value={v!.match}
                onChange={(m) => update({ match: m })}
                options={[
                  { value: "all", label: "Toutes" },
                  { value: "any", label: "Au moins une" },
                ]}
              />
            </div>
          )}
          <ul className="space-y-2" aria-label="Conditions de visibilité">
            {rules.map((r, i) => (
              <li key={`${r.type}-${i}`} className="rounded-[var(--radius-md)] p-3 ring-1 ring-line">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">
                    {i > 0 && <span className="mr-1 font-normal text-ink-muted">{v!.match === "all" ? "et" : "ou"}</span>}
                    {RULE_LABELS[r.type]}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRule(i)}
                    aria-label={`Retirer la condition « ${RULE_LABELS[r.type]} »`}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-danger-soft hover:text-danger sm:size-8"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
                {!allowed.includes(r.type) && <p className="mb-2 text-[12.5px] text-warning">Condition non incluse dans votre plan : elle est conservée mais ne peut plus être ajoutée ailleurs.</p>}
                <RuleEditor id={`${idPrefix}-rule-${i}`} rule={r} onChange={(nr) => setRule(i, nr)} />
              </li>
            ))}
          </ul>
          {rules.length < MAX_VISIBILITY_RULES && addable.length > 0 && (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor={`${idPrefix}-add`} className="text-[13px]">
                  Ajouter une condition
                </Label>
                <Select id={`${idPrefix}-add`} fieldSize="sm" value={adding} onChange={(e) => setAdding(e.target.value as AudienceRuleType)}>
                  <option value="">Choisir…</option>
                  {addable.map((t) => (
                    <option key={t} value={t}>
                      {RULE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                disabled={!adding}
                onClick={() => adding && addRule(adding)}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-ink transition-colors hover:bg-line disabled:opacity-50 sm:h-9"
              >
                <Plus className="size-3.5" aria-hidden /> Ajouter
              </button>
            </div>
          )}
          {lockedTypes.length > 0 && (
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {lockedTypes.map((t) => RULE_LABELS[t]).join(", ")} : inclus à partir du plan Scale.{" "}
                <a href={`/app/${storeId}/abonnement`} className="font-medium text-primary underline-offset-4 hover:underline">
                  Voir les plans
                </a>
              </span>
            </p>
          )}
        </>
      )}
      <p className="text-[12px] leading-relaxed text-ink-faint">
        Les prix ne changent jamais selon l&apos;audience. Les moteurs de recherche voient la version par défaut. Testez avec « Simuler un visiteur » dans l&apos;aperçu.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="audience-title" className="space-y-3 border-t border-line pt-4">
      <h3 id="audience-title" className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        <Users className="size-3.5" aria-hidden /> Visible pour
      </h3>
      {children}
    </section>
  );
}

function ChoiceGroup<T extends string>({ legend, options, labels, values, onChange }: { legend: string; options: readonly T[]; labels: Record<T, string>; values: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = values.includes(o);
          const last = on && values.length === 1;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              aria-disabled={last || undefined}
              title={last ? "Au moins une valeur : retirez la condition pour l'enlever" : undefined}
              onClick={() => !last && onChange(on ? values.filter((x) => x !== o) : [...values, o])}
              className={cn(
                "min-h-11 rounded-full px-3 text-[13px] font-medium ring-1 ring-inset transition-colors sm:min-h-8",
                on ? "bg-primary-soft text-primary-deep ring-primary" : "bg-surface text-ink-muted ring-line hover:text-ink",
              )}
            >
              {labels[o]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function TagInput({ id, label, values, onChange, validate, placeholder, max }: { id: string; label: string; values: string[]; onChange: (v: string[]) => void; validate: (v: string) => string | null; placeholder: string; max: number }) {
  const [text, setText] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const e = validate(t) ?? (values.some((x) => x.toLowerCase() === t.toLowerCase()) ? "Déjà dans la liste." : values.length >= max ? `${max} valeurs maximum.` : null);
    setErr(e);
    if (e) return;
    onChange([...values, t]);
    setText("");
  };
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={label}>
        {values.map((c) => (
          <li key={c} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-soft py-1 pl-3 pr-1 text-[13px] text-primary-deep">
            <span className="truncate">{c}</span>
            <button
              type="button"
              disabled={values.length === 1}
              onClick={() => onChange(values.filter((x) => x !== c))}
              aria-label={`Retirer ${c}`}
              className="grid size-7 place-items-center rounded-full hover:bg-surface disabled:opacity-40"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          id={id}
          fieldSize="sm"
          value={text}
          placeholder={placeholder}
          aria-label={`${label} : ajouter`}
          aria-invalid={!!err || undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className="inline-flex h-11 shrink-0 items-center rounded-full bg-surface-2 px-3.5 text-[13px] font-medium text-ink hover:bg-line sm:h-9">
          Ajouter
        </button>
      </div>
      {err && (
        <p id={`${id}-err`} className="mt-1.5 text-[13px] font-medium text-danger">
          {err}
        </p>
      )}
    </div>
  );
}

function RuleEditor({ id, rule, onChange }: { id: string; rule: AudienceRule; onChange: (r: AudienceRule) => void }) {
  switch (rule.type) {
    case "customer":
      return <ChoiceGroup legend="Types de client" options={AUDIENCE_CUSTOMER_SEGMENTS} labels={CUSTOMER_LABELS} values={rule.values} onChange={(values) => onChange({ ...rule, values })} />;
    case "source":
      return <ChoiceGroup legend="Provenance du visiteur" options={AUDIENCE_SOURCES} labels={SOURCE_LABELS} values={rule.values} onChange={(values) => onChange({ ...rule, values })} />;
    case "device":
      return <ChoiceGroup legend="Appareil" options={AUDIENCE_DEVICES} labels={DEVICE_LABELS} values={rule.values} onChange={(values) => onChange({ ...rule, values })} />;
    case "city":
      return (
        <TagInput
          id={id}
          label="Villes"
          values={rule.values}
          placeholder="Ex. Porto-Novo"
          max={50}
          validate={(v) => (v.length > 80 ? "80 caractères maximum." : null)}
          onChange={(values) => onChange({ ...rule, values })}
        />
      );
    case "locale":
      return (
        <TagInput
          id={id}
          label="Langues"
          values={rule.values}
          placeholder="Code de langue, ex. en"
          max={12}
          validate={(v) => (LOCALE_RE.test(v) ? null : "Code de langue en minuscules (fr, en, wo…).")}
          onChange={(values) => onChange({ ...rule, values: values.map((x) => x.toLowerCase()) })}
        />
      );
    case "schedule":
      return (
        <div className="space-y-3">
          <fieldset>
            <legend className="sr-only">Jours</legend>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = rule.days.includes(d);
                const last = on && rule.days.length === 1;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_LABELS[d]}
                    aria-disabled={last || undefined}
                    onClick={() => !last && onChange({ ...rule, days: on ? rule.days.filter((x) => x !== d) : [...rule.days, d].sort((a, b) => a - b) })}
                    className={cn(
                      "grid size-11 place-items-center rounded-full text-[13px] font-medium ring-1 ring-inset transition-colors sm:size-9",
                      on ? "bg-primary-soft text-primary-deep ring-primary" : "bg-surface text-ink-muted ring-line hover:text-ink",
                    )}
                  >
                    {DAY_LABELS[d].slice(0, 2)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-from`} className="text-[13px]">
                De
              </Label>
              <Input id={`${id}-from`} fieldSize="sm" type="time" value={rule.from} onChange={(e) => e.target.value && onChange({ ...rule, from: e.target.value.slice(0, 5) })} />
            </div>
            <div>
              <Label htmlFor={`${id}-to`} className="text-[13px]">
                À
              </Label>
              <Input id={`${id}-to`} fieldSize="sm" type="time" value={rule.to} onChange={(e) => e.target.value && onChange({ ...rule, to: e.target.value.slice(0, 5) })} />
            </div>
          </div>
          <p className="text-[12px] text-ink-muted">Heure de la boutique. Une plage qui passe minuit (22:00 à 02:00) est acceptée.</p>
        </div>
      );
  }
}
