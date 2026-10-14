"use client";

import { useActionState, useMemo, useState } from "react";
import { Crown, FlaskConical, Pause, Play, Square, Trash2 } from "lucide-react";
import { applyExperimentWinner, completeExperiment, createExperiment, deleteExperiment, pauseExperiment, startExperiment } from "@/lib/experiments/actions";
import { EXPERIMENT_GOALS, GOAL_LABELS } from "@/lib/experiments/assign";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";
import type { SectionOptionDTO } from "./data";

export type VariantViewDTO = {
  key: string;
  label: string;
  exposures: number;
  conversions: number;
  ratePct: number;
  probabilityPct: number;
  liftPct: number | null;
  liftRange: [number, number] | null;
  isWinner: boolean;
};

export type ExperimentDTO = {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  tone: BadgeTone;
  goalLabel: string;
  sectionLabel: string;
  sectionMissing: boolean;
  startedAt: string | null;
  winnerKey: string | null;
  message: string;
  warning: string | null;
  enoughData: boolean;
  daysRunning: number;
  variants: VariantViewDTO[];
};

const iconBtn = "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2";

type VariantKind = "none" | "section" | "hidden";

/** Applique les textes saisis à une copie de la section d'origine (le serveur revalide tout). */
function buildVariantSection(option: SectionOptionDTO, values: Record<string, string>) {
  const section = JSON.parse(JSON.stringify(option.section)) as {
    settings: Record<string, unknown>;
    blocks: { id: string; settings: Record<string, unknown> }[];
  };
  for (const field of option.fields) {
    const value = values[field.path];
    if (value === undefined) continue;
    if (field.path.startsWith("s:")) {
      section.settings[field.path.slice(2)] = value;
    } else {
      const [, blockId, key] = field.path.split(":");
      const block = section.blocks.find((b) => b.id === blockId);
      if (block) block.settings[key] = value;
    }
  }
  return section;
}

export function ExperimentForm({ storeId, options }: { storeId: string; options: SectionOptionDTO[] }) {
  const [state, action] = useActionState(createExperiment, undefined);
  const free = options.filter((o) => !o.busy);
  const [sectionKey, setSectionKey] = useState(free[0] ? `${free[0].templateKey}|${free[0].sectionId}` : "");
  const option = options.find((o) => `${o.templateKey}|${o.sectionId}` === sectionKey) ?? null;
  const [kindB, setKindB] = useState<Exclude<VariantKind, "none">>("section");
  const [kindC, setKindC] = useState<VariantKind>("none");
  const [valuesB, setValuesB] = useState<Record<string, string>>({});
  const [valuesC, setValuesC] = useState<Record<string, string>>({});

  const variantsJson = useMemo(() => {
    if (!option) return "[]";
    const list: unknown[] = [{ key: "A", kind: "current" }];
    list.push(kindB === "hidden" ? { key: "B", kind: "hidden" } : { key: "B", kind: "section", section: buildVariantSection(option, valuesB) });
    if (kindC !== "none") list.push(kindC === "hidden" ? { key: "C", kind: "hidden" } : { key: "C", kind: "section", section: buildVariantSection(option, valuesC) });
    return JSON.stringify(list);
  }, [option, kindB, kindC, valuesB, valuesC]);

  const changeSection = (key: string) => {
    setSectionKey(key);
    setValuesB({});
    setValuesC({});
  };

  if (free.length === 0) {
    return (
      <div className="px-5 pb-6 sm:px-6">
        <Alert tone="info" title="Toutes les sections sont déjà testées">
          Terminez un test en cours pour pouvoir tester une autre version de la même section.
        </Alert>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-5 px-5 pb-6 sm:px-6">
      <FormMessage state={state} toastSuccess />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="template" value={option?.templateKey ?? ""} />
      <input type="hidden" name="sectionId" value={option?.sectionId ?? ""} />
      <input type="hidden" name="variantsJson" value={variantsJson} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="exp-name" label="Nom du test" required error={fieldError(state, "name")} hint="Visible par vous seulement.">
          {(p) => <Input {...p} name="name" maxLength={60} placeholder="Titre de la bannière" />}
        </Field>
        <Field id="exp-goal" label="Ce que l'on mesure" error={fieldError(state, "goal")} hint="Les autres mesures restent visibles dans les résultats.">
          {(p) => (
            <Select {...p} name="goal" defaultValue="ORDER">
              {EXPERIMENT_GOALS.map((g) => (
                <option key={g} value={g}>
                  {GOAL_LABELS[g]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field id="exp-section" label="Section à tester" required error={fieldError(state, "sectionId")}>
        {(p) => (
          <Select {...p} value={sectionKey} onChange={(e) => changeSection(e.target.value)}>
            {options.map((o) => (
              <option key={`${o.templateKey}|${o.sectionId}`} value={`${o.templateKey}|${o.sectionId}`} disabled={o.busy}>
                {o.templateLabel} · {o.sectionName}
                {o.busy ? " (déjà testée)" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="rounded-[var(--radius-md)] bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
        Variante A : votre section actuelle, inchangée.
      </div>

      <VariantEditor
        title="Variante B"
        option={option}
        kind={kindB}
        onKind={(k) => setKindB(k === "none" ? "section" : k)}
        allowNone={false}
        values={valuesB}
        onValues={setValuesB}
      />

      <VariantEditor
        title="Variante C (facultative)"
        option={option}
        kind={kindC}
        onKind={setKindC}
        allowNone
        values={valuesC}
        onValues={setValuesC}
      />

      <div className="flex justify-end">
        <SubmitButton disabled={!option}>
          <FlaskConical className="size-4" aria-hidden /> Créer le test
        </SubmitButton>
      </div>
    </form>
  );
}

function VariantEditor({
  title,
  option,
  kind,
  onKind,
  allowNone,
  values,
  onValues,
}: {
  title: string;
  option: SectionOptionDTO | null;
  kind: VariantKind;
  onKind: (k: VariantKind) => void;
  allowNone: boolean;
  values: Record<string, string>;
  onValues: (v: Record<string, string>) => void;
}) {
  const id = title.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="space-y-4 rounded-[var(--radius-md)] border border-line p-4">
      <Field id={`kind-${id}`} label={title} hint={option?.required && kind === "hidden" ? "Cette section est obligatoire : elle ne peut pas être masquée." : undefined}>
        {(p) => (
          <Select {...p} value={kind} onChange={(e) => onKind(e.target.value as VariantKind)}>
            {allowNone && <option value="none">Pas de variante C</option>}
            <option value="section">Autre version de la section</option>
            {!option?.required && <option value="hidden">Section masquée</option>}
          </Select>
        )}
      </Field>

      {kind === "section" && option && (
        <div className="space-y-3">
          {option.fields.length === 0 ? (
            <p className="text-sm text-ink-muted">Cette section n&apos;a pas de texte modifiable : testez-la plutôt contre « Section masquée ».</p>
          ) : (
            option.fields.map((f) => (
              <Field key={f.path} id={`${id}-${f.path}`} label={f.label}>
                {(p) =>
                  f.multiline ? (
                    <Textarea {...p} rows={3} value={values[f.path] ?? f.value} onChange={(e) => onValues({ ...values, [f.path]: e.target.value })} />
                  ) : (
                    <Input {...p} value={values[f.path] ?? f.value} onChange={(e) => onValues({ ...values, [f.path]: e.target.value })} />
                  )
                }
              </Field>
            ))
          )}
        </div>
      )}
      {kind === "hidden" && <p className="text-sm text-ink-muted">Les visiteurs de cette variante ne voient pas la section du tout.</p>}
    </div>
  );
}

/* ───────────── Liste et résultats ───────────── */

export function ExperimentList({ storeId, experiments }: { storeId: string; experiments: ExperimentDTO[] }) {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {experiments.map((e) => (
        <li key={e.id} className="space-y-4 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-ink">{e.name}</span>
                <Badge tone={e.tone}>{e.statusLabel}</Badge>
                {e.winnerKey && <Badge tone="success">Gagnante : {e.winnerKey}</Badge>}
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {e.sectionLabel} · {e.goalLabel}
                {e.startedAt ? ` · démarré le ${e.startedAt}` : ""}
                {e.daysRunning > 0 ? ` · ${e.daysRunning} jour${e.daysRunning > 1 ? "s" : ""}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(e.status === "DRAFT" || e.status === "PAUSED") && (
                <ActionButton action={() => startExperiment(storeId, e.id)} variant="secondary" size="sm">
                  <Play className="size-4" aria-hidden /> {e.status === "PAUSED" ? "Reprendre" : "Démarrer"}
                </ActionButton>
              )}
              {e.status === "RUNNING" && (
                <ActionButton action={() => pauseExperiment(storeId, e.id)} variant="ghost" size="sm">
                  <Pause className="size-4" aria-hidden /> Pause
                </ActionButton>
              )}
              {e.status !== "COMPLETED" && (
                <ConfirmActionButton
                  action={() => completeExperiment(storeId, e.id)}
                  title={`Terminer « ${e.name} » ?`}
                  description="Tous les visiteurs reverront la section actuelle. Les mesures sont conservées."
                  confirmLabel="Terminer"
                  className={iconBtn}
                >
                  <Square className="size-4" aria-hidden />
                  <span className="sr-only">Terminer {e.name}</span>
                </ConfirmActionButton>
              )}
              <ConfirmActionButton
                action={() => deleteExperiment(storeId, e.id)}
                title={`Supprimer « ${e.name} » ?`}
                description="Le test et ses mesures sont supprimés définitivement."
                confirmLabel="Supprimer"
                className={iconBtn}
              >
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Supprimer {e.name}</span>
              </ConfirmActionButton>
            </div>
          </div>

          {e.sectionMissing && (
            <Alert tone="warning" title="Section absente du thème">
              La section testée n&apos;existe plus dans votre thème publié : le test est suspendu et ne compte plus rien.
            </Alert>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Variante</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Affichages</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Conversions</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Taux</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Écart</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Chances d&apos;être la meilleure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {e.variants.map((v) => (
                  <tr key={v.key}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                      {v.label}
                      {v.isWinner && <Crown className="ml-1.5 inline size-4 text-success" aria-label="meilleure variante" />}
                    </th>
                    <td className="py-2 pr-3 text-right tabular">{v.exposures}</td>
                    <td className="py-2 pr-3 text-right tabular">{v.conversions}</td>
                    <td className="py-2 pr-3 text-right tabular">{v.ratePct} %</td>
                    <td className="py-2 pr-3 text-right tabular text-ink-muted">
                      {v.liftPct == null ? "référence" : `${v.liftPct > 0 ? "+" : ""}${v.liftPct} %`}
                      {v.liftRange && <span className="block text-xs">de {v.liftRange[0]} % à {v.liftRange[1]} %</span>}
                    </td>
                    <td className="py-2 text-right tabular">{v.probabilityPct} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-ink">{e.message}</p>
          {e.warning && (
            <Alert tone="warning" title="N'arrêtez pas trop tôt">
              {e.warning}
            </Alert>
          )}

          {e.status !== "COMPLETED" && (
            <div className="flex flex-wrap gap-2">
              {e.variants.map((v) => (
                <ConfirmActionButton
                  key={v.key}
                  action={() => applyExperimentWinner(storeId, e.id, v.key)}
                  title={`Appliquer la variante ${v.key} ?`}
                  description="La section est remplacée dans le BROUILLON de votre thème. Rien ne change en ligne avant que vous publiiez. Le test sera terminé."
                  confirmLabel="Appliquer au brouillon"
                  tone="primary"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
                >
                  <Crown className="size-4" aria-hidden /> Appliquer {v.key}
                </ConfirmActionButton>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
