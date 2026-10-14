"use client";

import * as React from "react";
import { BadgeCheck, Check, ChevronRight, LayoutTemplate, Lock, Palette, Sparkles } from "lucide-react";
import { GLOBAL_GROUPS } from "@/lib/theme-engine/editor-global";
import { AsyncSwitch } from "@/components/app/action-controls";
import { ButtonLink } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { setShowPoweredBy } from "@/lib/theme/actions";
import { cn } from "@/lib/utils";
import type { EditorPreset, Selection } from "./types";

export function ThemeSettingsList({ selection, onSelect, presetName, motionDetail }: { selection: Selection; onSelect: (s: Selection) => void; presetName: string; motionDetail?: string }) {
  const active = (g: string) => selection?.kind === "global" && selection.group === g;
  const row = (id: string, label: string, detail?: string, Icon?: typeof Palette) => (
    <li key={id}>
      <button
        type="button"
        onClick={() => onSelect({ kind: "global", group: id })}
        aria-current={active(id) ? "true" : undefined}
        className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-3 text-left transition-colors sm:min-h-10", active(id) ? "bg-primary-soft" : "hover:bg-surface-2")}
      >
        {Icon && <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{label}</span>
          {detail && <span className="block truncate text-[12px] text-ink-muted">{detail}</span>}
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </button>
    </li>
  );
  return (
    <nav aria-label="Réglages du thème" className="p-2">
      <ul className="space-y-0.5">
        {row("preset", "Modèle de départ", presetName, LayoutTemplate)}
        <li className="px-3 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-faint" aria-hidden>
          Réglages
        </li>
        {GLOBAL_GROUPS.map((g) => row(g.id, g.label))}
        {motionDetail != null && row("motion", "Animations", motionDetail, Sparkles)}
        <li className="px-3 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-faint" aria-hidden>
          Marque
        </li>
        {row("branding", "Mention « Propulsé par Axi »", undefined, BadgeCheck)}
      </ul>
    </nav>
  );
}

export function PresetPanel({
  presets,
  current,
  presetLimit,
  storeId,
  onApply,
}: {
  presets: EditorPreset[];
  current: string;
  presetLimit: number | null;
  storeId: string;
  onApply: (presetId: string, keepContent: boolean) => Promise<void>;
}) {
  const [choice, setChoice] = React.useState<string | null>(null);
  const [keep, setKeep] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const selected = presets.find((p) => p.id === choice);
  return (
    <div className="space-y-4 p-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Un modèle de départ fournit les sections, couleurs et polices adaptées à votre métier. Le changement s&apos;applique au brouillon : rien n&apos;est publié tant que vous ne cliquez pas sur « Publier ».
      </p>
      {presetLimit != null && (
        <p className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">
          Votre plan inclut {presetLimit} modèles de départ.{" "}
          <a href={`/app/${storeId}/abonnement`} className="font-medium text-primary underline-offset-4 hover:underline">
            Débloquer tous les modèles
          </a>
        </p>
      )}
      <ul className="grid gap-2" role="radiogroup" aria-label="Modèles de départ">
        {presets.map((p) => {
          const isCurrent = p.id === current;
          const on = choice === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!p.allowed || isCurrent}
                onClick={() => setChoice(p.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[var(--radius-md)] p-3 text-left ring-1 transition-[background-color,box-shadow] duration-150 disabled:cursor-not-allowed",
                  on ? "bg-primary-soft ring-2 ring-primary" : "ring-line hover:bg-surface-2",
                  !p.allowed && "opacity-60",
                )}
              >
                <span className="flex shrink-0 -space-x-1.5" aria-hidden>
                  <span className="size-6 rounded-full ring-2 ring-surface" style={{ background: p.primary }} />
                  <span className="size-6 rounded-full ring-2 ring-surface" style={{ background: p.accent }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    {p.name}
                    {isCurrent && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">Actuel</span>}
                  </span>
                  <span className="block truncate text-[12px] text-ink-muted">{p.description}</span>
                </span>
                {!p.allowed ? <Lock className="size-4 shrink-0 text-ink-faint" aria-label="Plan supérieur requis" /> : on ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <Checkbox label="Conserver mon logo, mes menus, mes réseaux sociaux et le pied de page" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
      <button
        type="button"
        disabled={!selected || pending}
        onClick={async () => {
          if (!selected) return;
          setPending(true);
          try {
            await onApply(selected.id, keep);
            setChoice(null);
          } finally {
            setPending(false);
          }
        }}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-on-primary transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? "Application…" : selected ? `Appliquer « ${selected.name} »` : "Choisissez un modèle"}
      </button>
      <p className="text-[12px] leading-relaxed text-ink-muted">Les sections et couleurs actuelles du brouillon seront remplacées. Vous pouvez annuler avec Ctrl+Z.</p>
    </div>
  );
}

export function BrandingPanel({ storeId, showPoweredBy, canRemove }: { storeId: string; showPoweredBy: boolean; canRemove: boolean }) {
  return (
    <div className="space-y-4 p-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">La mention « Propulsé par Axi » apparaît en bas de votre boutique. Ce réglage s&apos;applique immédiatement, sans publication.</p>
      <AsyncSwitch checked={!showPoweredBy} label="Masquer « Propulsé par Axi »" disabled={!canRemove} action={(hide) => setShowPoweredBy(storeId, !hide)} />
      {!canRemove && (
        <div className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">
          <p>Masquer la mention Axi est inclus à partir du plan Starter.</p>
          <ButtonLink href={`/app/${storeId}/abonnement`} variant="outline" size="sm" className="mt-2">
            Voir les plans
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
