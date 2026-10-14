"use client";

import * as React from "react";
import { Lock, Sparkles } from "lucide-react";
import { DEFAULT_SECTION_ANIMATION } from "@/lib/theme-engine/motion";
import { DEFAULT_MOTION, SECTION_ANIMATIONS, type MotionSettings, type SectionAnimation } from "@/lib/theme-engine/types";
import { Label, Select, Switch, Hint } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

export const MOTION_PRESET_LABELS: Record<MotionSettings["preset"], string> = { none: "Aucune", subtle: "Sobre", lively: "Vive" };

const PRESET_HELP: Record<MotionSettings["preset"], string> = {
  none: "Aucune animation sur la boutique.",
  subtle: "Apparitions douces et courtes : l'option la plus sûre pour une boutique rapide.",
  lively: "Mouvements plus marqués pour les boutiques de mode, beauté ou événementiel.",
};

export const ANIMATION_LABELS: Record<SectionAnimation, string> = {
  inherit: "Selon les réglages du thème",
  none: "Aucune",
  "fade-up": "Fondu vers le haut",
  fade: "Fondu",
  "zoom-in": "Zoom léger",
  "slide-left": "Glissement depuis la droite",
};

export function motionOf(m: MotionSettings | undefined): MotionSettings {
  return { ...DEFAULT_MOTION, ...m };
}

/** Réglages globaux « Animations » (GlobalSettings.motion). */
export function MotionPanel({
  motion,
  enabled,
  storeId,
  onChange,
}: {
  motion: MotionSettings | undefined;
  enabled: boolean;
  storeId: string;
  onChange: (next: MotionSettings) => void;
}) {
  const m = motionOf(motion);
  const off = m.preset === "none";
  const set = (patch: Partial<MotionSettings>) => onChange({ ...m, ...patch });
  return (
    <div className="space-y-5 p-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Des mouvements discrets rendent la boutique plus vivante. Ils sont coupés automatiquement pour les visiteurs qui préfèrent réduire les animations et en mode économie de données.
      </p>
      {!enabled && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Les animations ne sont pas incluses dans votre plan.{" "}
            <a href={`/app/${storeId}/abonnement`} className="font-medium text-primary underline-offset-4 hover:underline">
              Voir les plans
            </a>
          </span>
        </p>
      )}
      <fieldset disabled={!enabled} className="space-y-5 disabled:opacity-60">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink" id="motion-preset-label">
            Intensité
          </span>
          <Segmented
            fill
            size="sm"
            label="Intensité des animations"
            value={m.preset}
            onChange={(v) => enabled && set({ preset: v })}
            options={(["none", "subtle", "lively"] as const).map((v) => ({ value: v, label: MOTION_PRESET_LABELS[v] }))}
          />
          <Hint>{PRESET_HELP[m.preset]}</Hint>
        </div>
        <div className={cn("space-y-4 rounded-[var(--radius-md)] p-3 ring-1 ring-line", off && "opacity-60")}>
          <MotionSwitch label="Apparition au défilement" hint="Les sections apparaissent en fondu quand elles entrent à l'écran." checked={m.reveal} disabled={!enabled || off} onChange={(v) => set({ reveal: v })} />
          <MotionSwitch label="Effet de profondeur (parallaxe)" hint="Les grandes images défilent un peu moins vite que le texte, sur les navigateurs compatibles." checked={m.parallax} disabled={!enabled || off} onChange={(v) => set({ parallax: v })} />
          <MotionSwitch label="Zoom au survol des images" hint="Les photos des produits grossissent légèrement au survol, sur ordinateur." checked={m.hoverZoom} disabled={!enabled || off} onChange={(v) => set({ hoverZoom: v })} />
        </div>
      </fieldset>
      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Chaque section peut aussi avoir sa propre animation : sélectionnez-la puis réglez « Animation d&apos;apparition ».
      </p>
    </div>
  );
}

function MotionSwitch({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
      <p className="mt-1 pl-14 text-[12.5px] leading-relaxed text-ink-muted">{hint}</p>
    </div>
  );
}

/** Réglage `animation` d'une section (inspecteur). */
export function SectionAnimationField({
  id,
  value,
  globalOn,
  enabled,
  onChange,
}: {
  id: string;
  value: SectionAnimation | undefined;
  /** Animations actives dans les réglages du thème (intensité ≠ aucune et apparition au défilement activée). */
  globalOn: boolean;
  enabled: boolean;
  onChange: (v: SectionAnimation) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div>
      <Label htmlFor={id}>Animation d&apos;apparition</Label>
      <Select id={id} fieldSize="sm" value={value ?? "inherit"} disabled={!enabled} onChange={(e) => onChange(e.target.value as SectionAnimation)} aria-describedby={hintId}>
        {SECTION_ANIMATIONS.map((a) => (
          <option key={a} value={a}>
            {a === "inherit" ? `${ANIMATION_LABELS.inherit} (${ANIMATION_LABELS[DEFAULT_SECTION_ANIMATION].toLowerCase()})` : ANIMATION_LABELS[a]}
          </option>
        ))}
      </Select>
      <Hint id={hintId}>
        {!globalOn && (value ?? "inherit") !== "none"
          ? "Les animations d'apparition sont désactivées dans Réglages du thème, Animations : rien ne sera joué."
          : "Jouée une seule fois, quand la section apparaît à l'écran."}
      </Hint>
    </div>
  );
}
