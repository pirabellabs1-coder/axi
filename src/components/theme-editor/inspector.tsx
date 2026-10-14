"use client";

import * as React from "react";
import { BookmarkPlus, ChevronLeft, Copy, Eye, EyeOff, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { GLOBAL_GROUPS, type GlobalField } from "@/lib/theme-engine/editor-global";
import { getAtPath, isRequiredSection } from "@/lib/theme-engine/operations";
import type { AudienceRuleType } from "@/config/plans";
import type { GlobalSettings, SectionAnimation, SectionVisibility, SettingField, SettingValue, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { Input, Label } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { ColorInput, SettingInput, type FieldContext } from "./fields";
import { AudiencePanel } from "./audience-panel";
import { DynamicSourceControl, type DynamicContext } from "./dynamic-source-picker";
import { SectionAnimationField } from "./motion-panel";
import type { EditorResources, Selection } from "./types";

export type InspectorActions = {
  setSection: (sectionId: string, key: string, value: SettingValue) => void;
  setBlock: (sectionId: string, blockId: string, key: string, value: SettingValue) => void;
  setGlobal: (path: string, value: unknown, coalesce?: boolean) => void;
  resetSection: (sectionId: string) => void;
  resetBlock: (sectionId: string, blockId: string) => void;
  applyPreset: (sectionId: string, index: number) => void;
  toggleSection: (sectionId: string) => void;
  duplicateSection: (sectionId: string) => void;
  removeSection: (sectionId: string) => void;
  toggleBlock: (sectionId: string, blockId: string) => void;
  duplicateBlock: (sectionId: string, blockId: string) => void;
  removeBlock: (sectionId: string, blockId: string) => void;
  select: (s: Selection) => void;
  /** Lot 4 : animation d'apparition, visibilité par audience, enregistrement de la section. */
  setAnimation: (sectionId: string, animation: SectionAnimation) => void;
  setVisibility: (sectionId: string, visibility: SectionVisibility | null) => void;
  saveSection: (sectionId: string) => void;
  bindSource: (sectionId: string, blockId: string | null, key: string, source: string) => void;
  unbindSource: (sectionId: string, blockId: string | null, key: string) => void;
};

/** Contexte lot 4 de l'inspecteur (plan, sources dynamiques). */
export type InspectorLot4 = {
  storeId: string;
  storeCity: string | null;
  motionEnabled: boolean;
  /** Apparitions actives dans les réglages globaux. */
  motionOn: boolean;
  audienceRules: AudienceRuleType[];
  canSaveSections: boolean;
  dynamic: DynamicContext;
};

/** Réglage de section ou de bloc, avec « Connecter une donnée » pour les champs compatibles. */
function FieldRow({
  id,
  field,
  value,
  onChange,
  onBind,
  onUnbind,
  error,
  ctx,
  dynamic,
}: {
  id: string;
  field: SettingField;
  value: unknown;
  onChange: (v: SettingValue) => void;
  onBind: (source: string) => void;
  onUnbind: () => void;
  error?: string;
  ctx: FieldContext;
  dynamic?: DynamicContext;
}) {
  const input = <SettingInput id={id} field={field} value={value} onChange={(v) => onChange(v as SettingValue)} error={error} ctx={ctx} />;
  if (!("id" in field)) return input;
  return (
    <DynamicSourceControl id={id} field={field} value={value} ctx={dynamic} onChange={(v) => onBind(v.$source)} onUnbind={onUnbind}>
      {input}
    </DynamicSourceControl>
  );
}

const iconBtn =
  "grid size-11 shrink-0 place-items-center rounded-full text-ink-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-ink active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 sm:size-9";

function Header({ title, subtitle, onBack, backLabel, children }: { title: string; subtitle?: string; onBack?: () => void; backLabel?: string; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center gap-1 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur">
      {onBack && (
        <button type="button" onClick={onBack} className={iconBtn} aria-label={backLabel ?? "Retour"}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
      )}
      <div className={cn("min-w-0 flex-1", !onBack && "pl-2")}>
        {subtitle && <p className="truncate text-[12px] text-ink-muted">{subtitle}</p>}
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function Inspector({
  doc,
  template,
  selection,
  errors,
  resources,
  actions,
  extraGlobal,
  lot4,
}: {
  doc: ThemeDocument;
  template: TemplateId;
  selection: Selection;
  errors: Record<string, string>;
  resources: EditorResources;
  actions: InspectorActions;
  /** Contenu supplémentaire pour un groupe global (modèle de départ, marque). */
  extraGlobal?: (group: string) => React.ReactNode;
  lot4?: InspectorLot4;
}) {
  const t = doc.templates[template];
  const schemes = doc.settings.colors.schemes.map((s) => ({ id: s.id, name: s.name }));
  const baseCtx: FieldContext = { resources, schemes };

  if (!selection) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-[240px]">
          <p className="text-sm font-medium text-ink">Sélectionnez une section</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">Ses réglages s&apos;affichent ici. Les modifications apparaissent aussitôt dans l&apos;aperçu.</p>
        </div>
      </div>
    );
  }

  if (selection.kind === "global") {
    const group = GLOBAL_GROUPS.find((g) => g.id === selection.group);
    if (!group) return extraGlobal?.(selection.group) ?? null;
    return (
      <div>
        <Header title={group.label} subtitle="Réglages du thème" onBack={() => actions.select(null)} backLabel="Fermer les réglages" />
        <div className="space-y-5 p-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">{group.description}</p>
          {group.fields.map((f, i) => (
            <GlobalFieldRow key={"id" in f ? f.id : `h${i}`} field={f} settings={doc.settings} errors={errors} ctx={baseCtx} resources={resources} onChange={actions.setGlobal} />
          ))}
          {extraGlobal?.(group.id)}
        </div>
      </div>
    );
  }

  const sectionId = selection.kind === "section" ? selection.id : selection.sectionId;
  const section = t?.sections[sectionId];
  if (!section) return null;
  const schema = SECTION_SCHEMAS[section.type];
  const required = isRequiredSection(section);

  if (selection.kind === "block") {
    const index = section.blocks.findIndex((b) => b.id === selection.blockId);
    const block = section.blocks[index];
    if (!block) return null;
    const bs = schema.blocks?.find((b) => b.type === block.type);
    const fields = bs?.settings ?? [];
    return (
      <div>
        <Header title={bs?.name ?? block.type} subtitle={schema.name} onBack={() => actions.select({ kind: "section", id: section.id })} backLabel={`Retour à « ${schema.name} »`}>
          <button type="button" className={iconBtn} onClick={() => actions.toggleBlock(section.id, block.id)} aria-label={block.disabled ? "Afficher le bloc" : "Masquer le bloc"} title={block.disabled ? "Afficher" : "Masquer"}>
            {block.disabled ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
          <button type="button" className={iconBtn} onClick={() => actions.duplicateBlock(section.id, block.id)} aria-label="Dupliquer le bloc" title="Dupliquer">
            <Copy className="size-4" aria-hidden />
          </button>
          <button type="button" className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")} onClick={() => actions.removeBlock(section.id, block.id)} aria-label="Supprimer le bloc" title="Supprimer">
            <Trash2 className="size-4" aria-hidden />
          </button>
        </Header>
        <div className="space-y-5 p-4">
          {!fields.some((f) => "id" in f) && <p className="text-[13px] leading-relaxed text-ink-muted">Ce bloc affiche automatiquement les informations du produit. Déplacez-le pour changer sa position.</p>}
          {fields.map((f, i) => (
            <FieldRow
              key={"id" in f ? f.id : `h${i}`}
              id={`b-${block.id}-${"id" in f ? f.id : i}`}
              field={f}
              value={"id" in f ? block.settings[f.id] : undefined}
              onChange={(v) => "id" in f && actions.setBlock(section.id, block.id, f.id, v)}
              onBind={(src) => "id" in f && actions.bindSource(section.id, block.id, f.id, src)}
              onUnbind={() => "id" in f && actions.unbindSource(section.id, block.id, f.id)}
              error={"id" in f ? errors[`block:${section.id}:${index}:${f.id}`] : undefined}
              ctx={baseCtx}
              dynamic={lot4?.dynamic}
            />
          ))}
          {fields.some((f) => "id" in f) && <ResetButton onClick={() => actions.resetBlock(section.id, block.id)} />}
        </div>
      </div>
    );
  }

  const sectionError = errors[`section:${section.id}`];
  return (
    <div>
      <Header title={schema.name} subtitle={required ? "Section du modèle" : "Section"} onBack={() => actions.select(null)} backLabel="Fermer les réglages de la section">
        {required ? (
          <span className={cn(iconBtn, "cursor-default hover:bg-transparent")} title="Section obligatoire du modèle" aria-label="Section obligatoire du modèle">
            <Lock className="size-4" aria-hidden />
          </span>
        ) : (
          <>
            <button type="button" className={iconBtn} onClick={() => actions.toggleSection(section.id)} aria-label={section.disabled ? "Afficher la section" : "Masquer la section"} title={section.disabled ? "Afficher" : "Masquer"}>
              {section.disabled ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
            <button type="button" className={iconBtn} onClick={() => actions.duplicateSection(section.id)} aria-label="Dupliquer la section" title="Dupliquer">
              <Copy className="size-4" aria-hidden />
            </button>
            {lot4 && (
              <button type="button" className={iconBtn} onClick={() => actions.saveSection(section.id)} aria-label="Enregistrer cette section" title="Enregistrer cette section">
                <BookmarkPlus className="size-4" aria-hidden />
              </button>
            )}
            <button type="button" className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")} onClick={() => actions.removeSection(section.id)} aria-label="Supprimer la section" title="Supprimer">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </>
        )}
      </Header>
      <div className="space-y-5 p-4">
        {sectionError && <Alert tone="danger">{sectionError}</Alert>}
        {section.disabled && <Alert tone="info">Section masquée : elle n&apos;apparaît pas sur la boutique.</Alert>}
        {schema.presets.length > 1 && (
          <div>
            <Label htmlFor={`preset-${section.id}`}>Préréglage</Label>
            <select
              id={`preset-${section.id}`}
              className="h-11 w-full rounded-[var(--radius-md)] bg-surface px-3 text-sm ring-1 ring-inset ring-line-strong sm:h-9"
              defaultValue=""
              onChange={(e) => e.target.value !== "" && actions.applyPreset(section.id, Number(e.target.value))}
            >
              <option value="">Appliquer un préréglage…</option>
              {schema.presets.map((p, i) => (
                <option key={p.name} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {schema.settings.map((f, i) => (
          <FieldRow
            key={"id" in f ? f.id : `h${i}`}
            id={`s-${section.id}-${"id" in f ? f.id : i}`}
            field={f}
            value={"id" in f ? section.settings[f.id] : undefined}
            onChange={(v) => "id" in f && actions.setSection(section.id, f.id, v)}
            onBind={(src) => "id" in f && actions.bindSource(section.id, null, f.id, src)}
            onUnbind={() => "id" in f && actions.unbindSource(section.id, null, f.id)}
            error={"id" in f ? errors[`section:${section.id}:${f.id}`] : undefined}
            ctx={baseCtx}
            dynamic={lot4?.dynamic}
          />
        ))}
        {lot4 && (
          <SectionAnimationField id={`s-${section.id}-animation`} value={section.animation} globalOn={lot4.motionOn} enabled={lot4.motionEnabled} onChange={(a) => actions.setAnimation(section.id, a)} />
        )}
        {schema.blocks?.length ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">
            <Plus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Les blocs de cette section (titres, textes, boutons…) se gèrent dans l&apos;arbre à gauche.
          </p>
        ) : null}
        <ResetButton onClick={() => actions.resetSection(section.id)} />
        {lot4 && (
          <AudiencePanel
            idPrefix={`s-${section.id}`}
            visibility={section.visibility}
            allowed={lot4.audienceRules}
            locked={required ? "Section principale du modèle : elle reste visible pour tous (le prix et l'achat ne dépendent jamais de l'audience)." : undefined}
            storeId={lot4.storeId}
            storeCity={lot4.storeCity}
            onChange={(v) => actions.setVisibility(section.id, v)}
          />
        )}
      </div>
    </div>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:h-9">
      <RotateCcw className="size-3.5" aria-hidden /> Réinitialiser les réglages
    </button>
  );
}

/* ───────────── Réglages globaux ───────────── */

function GlobalFieldRow({
  field,
  settings,
  errors,
  ctx,
  resources,
  onChange,
}: {
  field: GlobalField;
  settings: GlobalSettings;
  errors: Record<string, string>;
  ctx: FieldContext;
  resources: EditorResources;
  onChange: (path: string, value: unknown, coalesce?: boolean) => void;
}) {
  if (field.type === "schemes") return <SchemesEditor settings={settings} errors={errors} onChange={onChange} />;
  if (field.type === "menus") {
    const selected = (getAtPath(settings, field.id) as string[] | undefined) ?? [];
    return (
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">{field.label}</legend>
        <div className="space-y-1">
          {resources.menus.map((m) => {
            const on = selected.includes(m.handle);
            return (
              <label key={m.handle} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 text-sm hover:bg-surface-2 sm:min-h-9">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--c-primary)]"
                  checked={on}
                  disabled={!on && selected.length >= field.max}
                  onChange={() => onChange(field.id, on ? selected.filter((x) => x !== m.handle) : [...selected, m.handle])}
                />
                {m.title}
              </label>
            );
          })}
        </div>
        {errors[`global:${field.id}`] && <p className="mt-1.5 text-[13px] font-medium text-danger">{errors[`global:${field.id}`]}</p>}
      </fieldset>
    );
  }
  if (!("id" in field)) return <SettingInput id={`g-h-${field.content.slice(0, 12)}`} field={field} value={undefined} onChange={() => undefined} ctx={ctx} />;
  const contrastBase = field.type === "color" && field.contrastWith ? (getAtPath(settings, field.contrastWith) as string) : null;
  const raw = getAtPath(settings, field.id);
  return (
    <SettingInput
      id={`g-${field.id.replace(/\./g, "-")}`}
      field={field}
      value={raw ?? (field.type === "text" || field.type === "url" ? "" : raw)}
      onChange={(v) => onChange(field.id, v, field.type === "text" || field.type === "textarea" || field.type === "range")}
      error={errors[`global:${field.id}`]}
      ctx={{ ...ctx, contrastBase }}
    />
  );
}

function SchemesEditor({ settings, errors, onChange }: { settings: GlobalSettings; errors: Record<string, string>; onChange: (path: string, value: unknown, coalesce?: boolean) => void }) {
  const schemes = settings.colors.schemes;
  const set = (next: typeof schemes, coalesce = false) => onChange("colors.schemes", next, coalesce);
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-ink-muted">Chaque section peut utiliser un schéma (réglage « Couleurs de la section »).</p>
      {schemes.map((s, i) => (
        <div key={s.id} className="rounded-[var(--radius-md)] p-3 ring-1 ring-line">
          <div className="mb-3 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor={`scheme-${s.id}-name`} className="text-[13px]">
                Nom du schéma
              </Label>
              <Input id={`scheme-${s.id}-name`} fieldSize="sm" maxLength={40} value={s.name} onChange={(e) => set(schemes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)), true)} />
            </div>
            <button type="button" onClick={() => set(schemes.filter((_, j) => j !== i))} aria-label={`Supprimer le schéma « ${s.name} »`} className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")}>
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {(
              [
                ["background", "Fond", null],
                ["text", "Texte", "background"],
                ["primary", "Bouton", "background"],
                ["primaryText", "Texte du bouton", "primary"],
              ] as const
            ).map(([k, label, against]) => (
              <ColorInput
                key={k}
                id={`scheme-${s.id}-${k}`}
                label={label}
                value={s[k]}
                base={against ? s[against] : null}
                onChange={(v) => set(schemes.map((x, j) => (j === i ? { ...x, [k]: v } : x)))}
              />
            ))}
          </div>
          <details className="group mt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
              <Plus className="size-3.5 transition-transform group-open:rotate-45" aria-hidden /> Options avancées
            </summary>
            <p className="mb-3 mt-1 text-[12px] leading-relaxed text-ink-muted">Laissez vide pour un calcul automatique à partir du fond et du texte.</p>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              {(
                [
                  ["surface", "Surface", "text"],
                  ["border", "Bordures", "background"],
                  ["link", "Liens", "background"],
                  ["secondaryButton", "Bouton secondaire", "background"],
                  ["secondaryButtonText", "Texte du bouton secondaire", "secondaryButton"],
                ] as const
              ).map(([k, label, against]) => {
                const val = s[k] ?? null;
                return (
                  <div key={k}>
                    <ColorInput
                      id={`scheme-${s.id}-${k}`}
                      label={label}
                      value={val}
                      base={against ? (s[against] ?? s.background) : null}
                      onChange={(v) => set(schemes.map((x, j) => (j === i ? { ...x, [k]: v } : x)))}
                    />
                    {val && (
                      <button
                        type="button"
                        onClick={() => set(schemes.map((x, j) => (j === i ? { ...x, [k]: null } : x)))}
                        className="mt-1 inline-flex min-h-9 items-center gap-1 text-[12px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                      >
                        <RotateCcw className="size-3" aria-hidden /> Réinitialiser (automatique)
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      ))}
      {errors["global:colors.schemes"] && <p className="text-[13px] font-medium text-danger">{errors["global:colors.schemes"]}</p>}
      {schemes.length < 8 && (
        <button
          type="button"
          onClick={() => {
            let n = schemes.length + 1;
            while (schemes.some((x) => x.id === `schema-${n}`)) n++;
            set([...schemes, { id: `schema-${n}`, name: `Schéma ${n}`, background: settings.colors.surface, text: settings.colors.text, primary: settings.colors.primary, primaryText: settings.colors.primaryText }]);
          }}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-ink transition-colors hover:bg-line sm:h-9"
        >
          <Plus className="size-3.5" aria-hidden /> Ajouter un schéma
        </button>
      )}
    </div>
  );
}
