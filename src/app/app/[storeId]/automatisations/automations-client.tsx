"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Zap, MessageCircle, Mail, Bell, Tag, TicketPercent, X, FlaskConical, CheckCircle2, CircleSlash, Lock, ScrollText, type LucideIcon } from "lucide-react";
import { saveAutomation, toggleAutomation, deleteAutomation, createFromPreset, simulateAutomation } from "@/lib/automations/actions";
import {
  TRIGGERS,
  TRIGGER_META,
  ACTION_LABELS,
  FULFILLMENT_LABELS,
  SEGMENT_LABELS,
  VARIABLES,
  DELAY_PRESETS,
  actionsFor,
  delayLabel,
  renderTemplate,
  type AutomationTrigger,
  type ActionType,
  type TemplateVars,
} from "@/lib/automations/templates";
import { defaultConditions, isPromotional, type AutomationAction, type AutomationConfig } from "@/lib/automations/config";
import { TRIGGER_FEATURE } from "@/lib/automations/limits";
import type { SimulationResult } from "@/lib/automations/engine";
import type { ActionResult } from "@/lib/action";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Switch, Textarea, Checkbox, Hint, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import { AsyncSwitch, ConfirmActionButton } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type AutomationDTO = {
  id: string;
  trigger: AutomationTrigger;
  delayMinutes: number;
  active: boolean;
  config: AutomationConfig;
  stats: { sent: number; skipped: number; failed: number };
};

export type BuilderEnv = {
  storeId: string;
  storeName: string;
  currency: string;
  canActivate: boolean;
  abandonedCart: boolean;
  waActive: boolean;
  sampleTotal: string;
  orders: { id: string; label: string }[];
};

const ACTION_ICONS: Record<ActionType, LucideIcon> = { whatsapp: MessageCircle, email: Mail, notify: Bell, tag: Tag, coupon: TicketPercent };

function sampleVars(env: BuilderEnv): TemplateVars {
  return {
    prenom: "Aïcha",
    client: "Aïcha Dossou",
    boutique: env.storeName,
    reference: "AX-7K3P9Q",
    total: env.sampleTotal,
    lien: "https://axi.africa/suivi/7f3a",
    coupon: "AXI7K3P9Q",
    produit: "Pagne wax 6 yards",
    stock: "2",
  };
}

/** Phrase résumée « Quand … · Si … · Alors … ». */
function summarize(trigger: AutomationTrigger, config: AutomationConfig, delayMinutes: number): string {
  const meta = TRIGGER_META[trigger];
  const parts: string[] = [];
  const p = meta.param;
  const val = p ? (config.params[p.key] ?? p.default) : null;
  parts.push(`Quand ${meta.when}${p ? ` (${val} ${p.unit})` : ""}`);
  const cond: string[] = [];
  const c = config.conditions;
  if (c.minTotal) cond.push(`montant ≥ ${c.minTotal}`);
  if (c.fulfillment) cond.push(FULFILLMENT_LABELS[c.fulfillment].toLowerCase());
  if (c.segment !== "all") cond.push(c.segment === "tag" && c.tag ? `étiquette ${c.tag}` : SEGMENT_LABELS[c.segment].toLowerCase());
  if (isPromotional(trigger, config)) cond.push("client consentant");
  if (cond.length) parts.push(`si ${cond.join(", ")}`);
  parts.push(`alors ${config.actions.map((a) => ACTION_LABELS[a.type].toLowerCase()).join(" + ")}`);
  if (meta.kind === "event" && delayMinutes > 0) parts.push(delayLabel(delayMinutes).toLowerCase());
  return parts.join(" · ");
}

/* ───────────────────────── Modèles prêts ───────────────────────── */

type PresetCard = { key: string; name: string; pitch: string; trigger: AutomationTrigger; configName: string; actions: ActionType[] };

export function PresetGallery({ env, presets, existingNames }: { env: BuilderEnv; presets: PresetCard[]; existingNames: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {presets.map((p) => {
        const locked = TRIGGER_FEATURE[p.trigger] === "abandonedCart" && !env.abandonedCart;
        const added = existingNames.includes(p.configName);
        return (
          <li key={p.key} className="flex flex-col rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line shadow-[var(--shadow-card)]">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary-deep ring-1 ring-inset ring-line">
                <Zap className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="font-medium text-ink">{p.name}</h3>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{p.pitch}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Actions du modèle">
              {p.actions.map((t, i) => {
                const Icon = ACTION_ICONS[t];
                return (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
                    <Icon className="size-3.5" aria-hidden /> {ACTION_LABELS[t].replace(" au client", "")}
                  </span>
                );
              })}
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-4">
              <span className="text-xs text-ink-faint">{TRIGGER_META[p.trigger].label}</span>
              {locked ? (
                <Link href={`/app/${env.storeId}/abonnement#plans`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-muted ring-1 ring-inset ring-line-strong hover:bg-surface-2 sm:min-h-9">
                  <Lock className="size-3.5" aria-hidden /> Plan Scale
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant={added ? "ghost" : "primary"}
                  className="h-11 sm:h-9"
                  loading={pending && busy === p.key}
                  disabled={pending}
                  onClick={() => {
                    setBusy(p.key);
                    start(async () => {
                      const r = await createFromPreset(env.storeId, p.key);
                      if (r.ok) {
                        if (r.data?.active) toast.success(r.message ?? "Modèle activé");
                        else toast.info(r.message ?? "Modèle ajouté, désactivé");
                        router.refresh();
                      } else toast.error(r.error);
                      setBusy(null);
                    });
                  }}
                >
                  <Plus className="size-4" aria-hidden /> {added ? "Ajouter encore" : "Activer"}
                  <span className="sr-only"> le modèle « {p.name} »</span>
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────────────────── Ligne de la liste ───────────────────────── */

export function AutomationRow({ automation: a, env }: { automation: AutomationDTO; env: BuilderEnv }) {
  const locked = !a.active && !env.canActivate;
  const meta = TRIGGER_META[a.trigger];
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex flex-wrap items-center gap-2">
          <p className={a.active ? "font-medium text-ink" : "font-medium text-ink-muted"}>{a.config.name}</p>
          <Badge tone={a.active ? "success" : "neutral"} dot>
            {a.active ? "Active" : "Inactive"}
          </Badge>
          {meta.marketing && <Badge tone="info">Promotionnel</Badge>}
          {a.config.actions.some((x) => x.type === "whatsapp") && !env.waActive && a.active && <Badge tone="warning">Brouillons wa.me</Badge>}
        </div>
        <p className="mt-1.5 max-w-[80ch] text-sm leading-relaxed text-ink-muted">{summarize(a.trigger, a.config, a.delayMinutes)}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
          <span className="tabular">7 j : {a.stats.sent} exécutée{a.stats.sent > 1 ? "s" : ""}</span>
          <span className="tabular">{a.stats.skipped} ignorée{a.stats.skipped > 1 ? "s" : ""}</span>
          {a.stats.failed > 0 && <span className="font-medium text-danger tabular">{a.stats.failed} échec{a.stats.failed > 1 ? "s" : ""}</span>}
          <Link href={`/app/${env.storeId}/automatisations?journal=${a.id}#journal`} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
            <ScrollText className="size-3.5" aria-hidden /> Journal
          </Link>
        </p>
      </div>
      <div className="-mr-2 flex items-center gap-1">
        <AsyncSwitch checked={a.active} disabled={locked} label={a.active ? "Active" : "Inactive"} action={(v) => toggleAutomation(env.storeId, a.id, v)} />
        <AutomationBuilder env={env} automation={a} />
        <ConfirmActionButton
          title="Supprimer cette automatisation ?"
          description={`« ${a.config.name} ». Les exécutions programmées sont annulées. Le journal est conservé.`}
          confirmLabel="Supprimer"
          action={() => deleteAutomation(env.storeId, a.id)}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">Supprimer « {a.config.name} »</span>
        </ConfirmActionButton>
      </div>
    </li>
  );
}

/* ───────────────────────── Constructeur Quand / Si / Alors / Après ───────────────────────── */

function newAction(type: ActionType, trigger: AutomationTrigger): AutomationAction {
  const merchant = TRIGGER_META[trigger].audience === "merchant";
  switch (type) {
    case "whatsapp":
      return { type, purpose: TRIGGER_META[trigger].marketing ? "marketing" : "transactional", message: "Bonjour {prenom}, " };
    case "email":
      return merchant ? { type, subject: "Alerte : {produit}", message: "Bonjour,\n\n{produit} : {stock} en stock.\n\n{lien}" } : { type, subject: "{boutique} : votre commande {reference}", message: "Bonjour {prenom},\n\n" };
    case "notify":
      return { type, message: merchant ? "Stock bas : {produit} ({stock})" : "{client} : {reference}" };
    case "tag":
      return { type, tag: "relancé" };
    case "coupon":
      return { type, couponType: "PERCENT", value: 10, validDays: 14 };
  }
}

function blankConfig(trigger: AutomationTrigger): AutomationConfig {
  return { v: 2, name: TRIGGER_META[trigger].label, params: {}, conditions: defaultConditions(), actions: [newAction(TRIGGER_META[trigger].audience === "merchant" ? "notify" : "whatsapp", trigger)], cap: null };
}

function StepTitle({ letter, title, hint }: { letter: string; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="text-[15px] font-semibold tracking-tight text-ink">{letter}</span>
      <span className="text-sm text-ink-muted">{title}</span>
      {hint && <span className="ml-auto text-xs text-ink-faint">{hint}</span>}
    </div>
  );
}

function VariableChips({ onInsert, trigger }: { onInsert: (v: string) => void; trigger: AutomationTrigger }) {
  const merchant = TRIGGER_META[trigger].audience === "merchant";
  const keys = VARIABLES.filter((v) => (merchant ? ["{boutique}", "{produit}", "{stock}", "{lien}"].includes(v.key) : !["{produit}", "{stock}"].includes(v.key)));
  return (
    <div role="group" aria-label="Insérer une variable" className="mt-1.5 flex flex-wrap gap-1.5">
      {keys.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onInsert(v.key)}
          className="inline-flex min-h-8 items-center rounded-full px-2.5 font-mono text-xs text-ink-muted ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {v.key}
          <span className="sr-only"> : {v.label}</span>
        </button>
      ))}
    </div>
  );
}

export function AutomationBuilder({ env, automation }: { env: BuilderEnv; automation?: AutomationDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {automation ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier « ${automation.config.name} »`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="accent" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nouvelle automatisation
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={automation ? "Modifier l'automatisation" : "Nouvelle automatisation"} description="Quand un événement se produit, si les conditions sont réunies, alors Axi agit pour vous." size="lg" sheet>
        {open && <BuilderForm env={env} automation={automation} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function BuilderForm({ env, automation, onDone, onCancel }: { env: BuilderEnv; automation?: AutomationDTO; onDone: () => void; onCancel: () => void }) {
  const [trigger, setTrigger] = useState<AutomationTrigger>(automation?.trigger ?? "order.created");
  const [config, setConfig] = useState<AutomationConfig>(automation?.config ?? blankConfig("order.created"));
  const [delay, setDelay] = useState(automation?.delayMinutes ?? 0);
  const [active, setActive] = useState(automation?.active ?? env.canActivate);
  const [state, formAction] = useActionState(saveAutomation, undefined);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [simOrder, setSimOrder] = useState(env.orders[0]?.id ?? "");
  const [simPending, startSim] = useTransition();
  const activationLocked = !automation?.active && !env.canActivate;
  const meta = TRIGGER_META[trigger];
  const allowed = actionsFor(trigger);
  const vars = useMemo(() => sampleVars(env), [env]);
  const promotional = isPromotional(trigger, config);

  // Fermeture au succès (comparaison pendant le rendu, sans effet)
  const [seen, setSeen] = useState<ActionResult<{ id: string }> | undefined>(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) onDone();
  }

  const patch = (p: Partial<AutomationConfig>) => setConfig((c) => ({ ...c, ...p }));
  const patchCond = (p: Partial<AutomationConfig["conditions"]>) => setConfig((c) => ({ ...c, conditions: { ...c.conditions, ...p } }));
  const patchAction = (i: number, p: Partial<AutomationAction>) => setConfig((c) => ({ ...c, actions: c.actions.map((a, j) => (j === i ? ({ ...a, ...p } as AutomationAction) : a)) }));

  const changeTrigger = (t: AutomationTrigger) => {
    setTrigger(t);
    setSim(null);
    const ok = actionsFor(t);
    setConfig((c) => {
      const kept = c.actions.filter((a) => ok.includes(a.type));
      const nameIsDefault = !automation && TRIGGERS.some((x) => TRIGGER_META[x].label === c.name);
      return { ...c, name: nameIsDefault ? TRIGGER_META[t].label : c.name, params: {}, actions: kept.length ? kept : [newAction(ok[0], t)] };
    });
    if (TRIGGER_META[t].kind !== "event") setDelay(0);
  };

  const runSim = () =>
    startSim(async () => {
      const r = await simulateAutomation({ storeId: env.storeId, trigger, config: JSON.stringify(config), orderId: simOrder || null, automationId: automation?.id ?? null });
      if (r.ok && r.data) setSim(r.data);
      else if (!r.ok) {
        setSim(null);
        toast.error(r.error);
      }
    });

  const addable = allowed.filter((t) => !(t === "coupon" && config.actions.some((a) => a.type === "coupon")));
  const delayIsPreset = DELAY_PRESETS.some((d) => d.value === delay);

  return (
    <form action={formAction} noValidate className="space-y-6">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={env.storeId} />
      {automation && <input type="hidden" name="id" value={automation.id} />}
      <input type="hidden" name="trigger" value={trigger} />
      <input type="hidden" name="delayMinutes" value={meta.kind === "event" ? delay : 0} />
      <input type="hidden" name="config" value={JSON.stringify(config)} />

      <Field id="auto-name" label="Nom" required>
        {(p) => <Input {...p} value={config.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} />}
      </Field>

      {/* QUAND */}
      <fieldset className="rounded-[var(--radius-lg)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
        <legend className="sr-only">Quand</legend>
        <StepTitle letter="Quand" title="l'événement déclencheur" />
        <Field id="auto-trigger" label="Déclencheur" hint={meta.description}>
          {(p) => (
            <Select {...p} value={trigger} onChange={(e) => changeTrigger(e.target.value as AutomationTrigger)}>
              {(["Commandes", "Paiements", "Relances", "Catalogue"] as const).map((g) => (
                <optgroup key={g} label={g}>
                  {TRIGGERS.filter((t) => TRIGGER_META[t].group === g).map((t) => {
                    const locked = TRIGGER_FEATURE[t] === "abandonedCart" && !env.abandonedCart && automation?.trigger !== t;
                    return (
                      <option key={t} value={t} disabled={locked}>
                        {TRIGGER_META[t].label}
                        {locked ? " (plan Scale)" : ""}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        {meta.param && (
          <Field id="auto-param" label={meta.param.label} className="mt-3" hint={`Entre ${meta.param.min} et ${meta.param.max} ${meta.param.unit}.`}>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={meta.param!.min}
                max={meta.param!.max}
                value={config.params[meta.param!.key] ?? meta.param!.default}
                onChange={(e) => patch({ params: { ...config.params, [meta.param!.key]: e.target.value === "" ? undefined : Number(e.target.value) } })}
                className="tabular sm:max-w-40"
              />
            )}
          </Field>
        )}
      </fieldset>

      {/* SI */}
      {meta.audience === "customer" && (
        <fieldset className="rounded-[var(--radius-lg)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
          <legend className="sr-only">Si</legend>
          <StepTitle letter="Si" title="les conditions sont réunies" hint="Facultatif" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="auto-min" label={`Montant minimum (${env.currency})`} hint="Vide = sans minimum.">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={config.conditions.minTotal ?? ""}
                  onChange={(e) => patchCond({ minTotal: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))) })}
                  className="tabular"
                />
              )}
            </Field>
            <Field id="auto-fulfil" label="Mode de livraison">
              {(p) => (
                <Select {...p} value={config.conditions.fulfillment ?? ""} onChange={(e) => patchCond({ fulfillment: (e.target.value || null) as AutomationConfig["conditions"]["fulfillment"] })}>
                  <option value="">Tous les modes</option>
                  {Object.entries(FULFILLMENT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="auto-seg" label="Segment de clients">
              {(p) => (
                <Select {...p} value={config.conditions.segment} onChange={(e) => patchCond({ segment: e.target.value as AutomationConfig["conditions"]["segment"] })}>
                  {Object.entries(SEGMENT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {config.conditions.segment === "tag" && (
              <Field id="auto-tag" label="Étiquette" required>
                {(p) => <Input {...p} value={config.conditions.tag ?? ""} maxLength={30} onChange={(e) => patchCond({ tag: e.target.value || null })} placeholder="ex. vip" />}
              </Field>
            )}
          </div>
          <div className="mt-3">
            <Checkbox
              checked={promotional}
              disabled={meta.marketing || config.actions.some((a) => a.type === "coupon" || (a.type === "whatsapp" && a.purpose === "marketing"))}
              onChange={(e) => patchCond({ requireConsent: e.target.checked })}
              label="Uniquement les clients qui acceptent les messages promotionnels"
              description={promotional && !config.conditions.requireConsent ? "Obligatoire ici : le message est promotionnel." : "Consentement recueilli au paiement."}
            />
          </div>
        </fieldset>
      )}

      {/* ALORS */}
      <fieldset className="rounded-[var(--radius-lg)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
        <legend className="sr-only">Alors</legend>
        <StepTitle letter="Alors" title="Axi agit pour vous" hint={`${config.actions.length} / 4`} />
        <ol className="space-y-3">
          {config.actions.map((a, i) => {
            const Icon = ACTION_ICONS[a.type];
            return (
              <li key={i} className="rounded-[var(--radius-md)] bg-surface p-3.5 ring-1 ring-line">
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="size-4 text-ink-muted" aria-hidden />
                  <span className="text-sm font-medium text-ink">{meta.audience === "merchant" && a.type === "email" ? "E-mail à la boutique" : ACTION_LABELS[a.type]}</span>
                  {config.actions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, actions: c.actions.filter((_, j) => j !== i) }))}
                      className="ml-auto inline-flex size-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
                      aria-label={`Retirer l'action ${i + 1}`}
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
                <ActionFields action={a} index={i} trigger={trigger} env={env} vars={vars} onChange={(p) => patchAction(i, p)} />
              </li>
            );
          })}
        </ol>
        {config.actions.length < 4 && addable.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Ajouter une action">
            {addable.map((t) => {
              const Icon = ACTION_ICONS[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, actions: [...c.actions, newAction(t, trigger)] }))}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-sm text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <Plus className="size-3.5" aria-hidden /> <Icon className="size-3.5 text-ink-muted" aria-hidden /> {meta.audience === "merchant" && t === "email" ? "E-mail à la boutique" : ACTION_LABELS[t]}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      {/* APRÈS + plafond */}
      <fieldset className="rounded-[var(--radius-lg)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
        <legend className="sr-only">Après</legend>
        <StepTitle letter="Après" title="le bon moment, sans insister" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {meta.kind === "event" ? (
            <Field id="auto-delay" label="Délai" hint={delayIsPreset ? undefined : "Délai personnalisé en minutes (14 jours maximum)."}>
              {(p) => (
                <div className="space-y-2">
                  <Select {...p} value={delayIsPreset ? String(delay) : "custom"} onChange={(e) => setDelay(e.target.value === "custom" ? 30 : Number(e.target.value))}>
                    {DELAY_PRESETS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                    <option value="custom">Personnalisé…</option>
                  </Select>
                  {!delayIsPreset && <Input aria-label="Délai en minutes" type="number" inputMode="numeric" min={0} max={20160} value={delay} onChange={(e) => setDelay(Math.max(0, Math.min(20160, Math.round(Number(e.target.value) || 0))))} className="tabular" />}
                </div>
              )}
            </Field>
          ) : (
            <div>
              <Label>Moment</Label>
              <p className="text-sm text-ink-muted">Vérifié automatiquement toutes les 10 minutes environ.</p>
            </div>
          )}
          {meta.audience === "customer" && (
            <div>
              <Checkbox checked={!!config.cap} onChange={(e) => patch({ cap: e.target.checked ? { max: 1, days: 7 } : null })} label="Limiter la fréquence par client" />
              {config.cap && (
                <div className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
                  <Input aria-label="Nombre maximum d'envois" type="number" inputMode="numeric" min={1} max={20} value={config.cap.max} onChange={(e) => patch({ cap: { ...config.cap!, max: Math.max(1, Math.min(20, Number(e.target.value) || 1)) } })} className="w-20 tabular" fieldSize="sm" />
                  <span>fois par</span>
                  <Input aria-label="Fenêtre en jours" type="number" inputMode="numeric" min={1} max={90} value={config.cap.days} onChange={(e) => patch({ cap: { ...config.cap!, days: Math.max(1, Math.min(90, Number(e.target.value) || 1)) } })} className="w-20 tabular" fieldSize="sm" />
                  <span>jours</span>
                </div>
              )}
              <Hint>Une même commande ou un même panier ne déclenche jamais deux fois.</Hint>
            </div>
          )}
        </div>
      </fieldset>

      {/* Simulation */}
      <section aria-labelledby="sim-title" className="rounded-[var(--radius-lg)] p-4 ring-1 ring-inset ring-line">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-60">
            <h3 id="sim-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FlaskConical className="size-4 text-ink-muted" aria-hidden /> Simuler
            </h3>
            {meta.audience === "customer" && env.orders.length > 0 ? (
              <Select aria-label="Commande pour la simulation" value={simOrder} onChange={(e) => setSimOrder(e.target.value)} fieldSize="sm" className="mt-2">
                {env.orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="mt-1 text-[13px] text-ink-muted">{meta.audience === "merchant" ? "Sur le produit le plus bas en stock." : "Aucune commande pour l'instant."}</p>
            )}
          </div>
          <Button type="button" variant="secondary" size="sm" className="h-11 sm:h-9" onClick={runSim} loading={simPending} disabled={meta.audience === "customer" && env.orders.length === 0}>
            Lancer la simulation
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">Rien n'est envoyé ni enregistré.</p>
        {sim && (
          <div className="mt-4 space-y-3 border-t border-line pt-4" aria-live="polite">
            <p className="text-sm text-ink">
              <span className="font-medium">{sim.label}</span>
            </p>
            {sim.decision.ok ? (
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <CheckCircle2 className="size-4" aria-hidden /> Conditions réunies{sim.alreadyDone ? ", mais déjà exécutée pour cet élément (anti-doublon)" : ""}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <CircleSlash className="size-4" aria-hidden /> Ignorée : {sim.decision.reason}
              </p>
            )}
            <ul className="space-y-2">
              {sim.actions.map((x, i) => (
                <li key={i} className="text-sm">
                  <p className={cn("font-medium", x.ok ? "text-ink" : "text-ink-muted")}>
                    {x.title} : <span className="font-normal text-ink-muted">{x.outcome}</span>
                  </p>
                  {x.preview && <Bubble text={x.preview} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <div className="mr-auto flex min-h-11 items-center">
          <Switch name="active" checked={active && !activationLocked} onChange={setActive} disabled={activationLocked} label="Active" />
        </div>
        {activationLocked && <Hint className="mt-0 w-full">Limite d'automatisations actives atteinte : enregistrez-la désactivée, ou désactivez-en une autre.</Hint>}
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <SubmitButton>{automation ? "Enregistrer" : "Créer"}</SubmitButton>
      </div>
    </form>
  );
}

function Bubble({ text }: { text: string }) {
  return (
    <div className="mt-1.5 max-w-[46ch] whitespace-pre-wrap rounded-[18px] rounded-tl-[6px] bg-accent-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-ink ring-1 ring-inset ring-line [overflow-wrap:anywhere]">
      {text}
    </div>
  );
}

function ActionFields({ action: a, index, trigger, env, vars, onChange }: { action: AutomationAction; index: number; trigger: AutomationTrigger; env: BuilderEnv; vars: TemplateVars; onChange: (p: Partial<AutomationAction>) => void }) {
  const id = `act-${index}`;
  const append = (cur: string, v: string) => `${cur}${cur && !cur.endsWith(" ") && !cur.endsWith("\n") ? " " : ""}${v}`;
  switch (a.type) {
    case "whatsapp":
      return (
        <div className="grid gap-3">
          <div>
            <Field id={`${id}-msg`} label="Message" hint={`${a.message.length} / 1 000`}>
              {(p) => <Textarea {...p} value={a.message} rows={4} maxLength={1000} onChange={(e) => onChange({ message: e.target.value })} />}
            </Field>
            <VariableChips trigger={trigger} onInsert={(v) => onChange({ message: append(a.message, v) })} />
            {!TRIGGER_META[trigger].marketing && (
              <div className="mt-3">
                <Checkbox
                  checked={a.purpose === "marketing"}
                  onChange={(e) => onChange({ purpose: e.target.checked ? "marketing" : "transactional" })}
                  label="Message promotionnel"
                  description="Crédit marketing, clients consentants uniquement."
                />
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Aperçu</p>
            <Bubble text={renderTemplate(a.message || "…", vars)} />
            <p className="mt-2 text-xs text-ink-faint">{env.waActive ? "Envoyé par l'API WhatsApp, 1 crédit par message." : "Préparé dans la boîte de réception, à envoyer via wa.me."}</p>
          </div>
        </div>
      );
    case "email":
      return (
        <div className="space-y-3">
          <Field id={`${id}-subj`} label="Objet">
            {(p) => <Input {...p} value={a.subject} maxLength={120} onChange={(e) => onChange({ subject: e.target.value })} />}
          </Field>
          <Field id={`${id}-body`} label="Texte" hint={TRIGGER_META[trigger].audience === "merchant" ? "Envoyé à l'adresse de contact de la boutique." : "Envoyé seulement si le client a donné son adresse."}>
            {(p) => <Textarea {...p} value={a.message} rows={4} maxLength={1000} onChange={(e) => onChange({ message: e.target.value })} />}
          </Field>
          <VariableChips trigger={trigger} onInsert={(v) => onChange({ message: append(a.message, v) })} />
        </div>
      );
    case "notify":
      return (
        <div>
          <Field id={`${id}-n`} label="Texte de la notification" hint={`Aperçu : ${renderTemplate(a.message || "…", vars)}`}>
            {(p) => <Input {...p} value={a.message} maxLength={300} onChange={(e) => onChange({ message: e.target.value })} />}
          </Field>
          <VariableChips trigger={trigger} onInsert={(v) => onChange({ message: append(a.message, v) })} />
        </div>
      );
    case "tag":
      return (
        <Field id={`${id}-t`} label="Étiquette ajoutée au client" hint="Utile pour cibler une campagne ensuite.">
          {(p) => <Input {...p} value={a.tag} maxLength={30} onChange={(e) => onChange({ tag: e.target.value })} className="sm:max-w-60" />}
        </Field>
      );
    case "coupon":
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id={`${id}-ct`} label="Type">
            {(p) => (
              <Select {...p} value={a.couponType} onChange={(e) => onChange({ couponType: e.target.value as "PERCENT" | "FIXED" | "FREE_DELIVERY" })}>
                <option value="PERCENT">Pourcentage</option>
                <option value="FIXED">Montant fixe</option>
                <option value="FREE_DELIVERY">Livraison offerte</option>
              </Select>
            )}
          </Field>
          {a.couponType !== "FREE_DELIVERY" && (
            <Field id={`${id}-cv`} label={a.couponType === "PERCENT" ? "Remise (%)" : `Remise (${env.currency})`}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} value={a.value} onChange={(e) => onChange({ value: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="tabular" />}
            </Field>
          )}
          <Field id={`${id}-cd`} label="Validité (jours)">
            {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={90} value={a.validDays} onChange={(e) => onChange({ validDays: Math.max(1, Math.min(90, Math.round(Number(e.target.value) || 1))) })} className="tabular" />}
          </Field>
          <p className="text-xs text-ink-faint sm:col-span-3">Code unique à usage unique, utilisable dans vos messages avec {"{coupon}"}.</p>
        </div>
      );
  }
}
