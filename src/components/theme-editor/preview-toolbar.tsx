"use client";

import * as React from "react";
import { UserRound } from "lucide-react";
import { AUDIENCE_CUSTOMER_SEGMENTS, AUDIENCE_SOURCES } from "@/lib/theme-engine/types";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Switch } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { CUSTOMER_LABELS, DAY_LABELS, initialAudience, SOURCE_LABELS, type SimulatedAudience } from "./preview-doc";

const pill =
  "inline-flex h-11 max-w-full items-center gap-1.5 rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink shadow-[var(--shadow-md)] ring-1 ring-line transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-[0.97] sm:h-9";

/** Case « Réduire les animations » de l'aperçu (n'affecte que l'aperçu). */
export function ReduceMotionToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn(pill, "cursor-pointer select-none")}>
      <input type="checkbox" className="size-4 shrink-0 accent-[var(--c-primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="truncate">Réduire les animations</span>
    </label>
  );
}

/** Choix de la fiche réelle affichée dans l'aperçu (éléments qui utilisent le modèle alternatif). */
export function PreviewOwnerSelect({ owners, value, onChange, noun }: { owners: { path: string; name: string }[]; value: string | null; onChange: (path: string | null) => void; noun: string }) {
  return (
    <label className={cn(pill, "pr-1.5")}>
      <span className="shrink-0 text-ink-muted">Aperçu avec</span>
      <select
        className="h-9 min-w-0 max-w-[180px] cursor-pointer truncate rounded-full bg-surface-2 px-2.5 text-[13px] font-medium text-ink focus-visible:outline-2 focus-visible:outline-primary sm:h-7"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{`Un ${noun} exemple`}</option>
        {owners.map((o) => (
          <option key={o.path} value={o.path}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function audienceSummary(a: SimulatedAudience | null): string {
  if (!a) return "Tous les visiteurs";
  const parts = [CUSTOMER_LABELS[a.customer].split(" (")[0], SOURCE_LABELS[a.source]];
  if (a.city) parts.push(a.city);
  return parts.join(" · ");
}

/** Sélecteur d'audience simulée (lot 4 §12). `null` = règles ignorées : toutes les sections sont visibles. */
export function AudienceSimulator({
  value,
  onChange,
  device,
  cities,
  hasRules,
}: {
  value: SimulatedAudience | null;
  onChange: (a: SimulatedAudience | null) => void;
  device: "mobile" | "desktop";
  cities: string[];
  hasRules: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const btn = React.useRef<HTMLButtonElement>(null);
  const a = value;
  const set = (patch: Partial<SimulatedAudience>) => a && onChange({ ...a, ...patch });
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={cn(pill, a && "bg-primary-soft ring-primary")}>
        <UserRound className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          <span className="sr-only">Simuler un visiteur : </span>
          {audienceSummary(a)}
        </span>
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          requestAnimationFrame(() => btn.current?.focus());
        }}
        sheet
        title="Simuler un visiteur"
        description="Voyez la boutique comme un visiteur précis : les sections réservées à d'autres audiences sont masquées dans l'aperçu."
      >
        <div className="space-y-5">
          {!hasRules && <p className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">Aucune section n&apos;a encore de règle « Visible pour ». Sélectionnez une section pour en ajouter.</p>}
          <Switch
            label="Simuler un visiteur"
            checked={!!a}
            onChange={(on) => onChange(on ? { ...initialAudience(device), city: cities[0] ?? "" } : null)}
          />
          <fieldset disabled={!a} className="space-y-4 disabled:opacity-55">
            <legend className="sr-only">Profil du visiteur simulé</legend>
            <div>
              <Label htmlFor="sim-customer">Client</Label>
              <Select id="sim-customer" fieldSize="sm" value={a?.customer ?? "anonymous"} onChange={(e) => set({ customer: e.target.value as SimulatedAudience["customer"] })}>
                {AUDIENCE_CUSTOMER_SEGMENTS.map((c) => (
                  <option key={c} value={c}>
                    {CUSTOMER_LABELS[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="sim-source">Arrivé depuis</Label>
              <Select id="sim-source" fieldSize="sm" value={a?.source ?? "direct"} onChange={(e) => set({ source: e.target.value as SimulatedAudience["source"] })}>
                {AUDIENCE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="sim-city">Ville</Label>
              <Input id="sim-city" fieldSize="sm" list="sim-cities" placeholder="Ex. Cotonou" value={a?.city ?? ""} maxLength={80} onChange={(e) => set({ city: e.target.value })} />
              <datalist id="sim-cities">
                {cities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sim-day">Jour</Label>
                <Select id="sim-day" fieldSize="sm" value={String(a?.day ?? 1)} onChange={(e) => set({ day: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <option key={d} value={d}>
                      {DAY_LABELS[d]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="sim-time">Heure</Label>
                <Input id="sim-time" fieldSize="sm" type="time" value={a?.time ?? "12:00"} onChange={(e) => e.target.value && set({ time: e.target.value.slice(0, 5) })} />
              </div>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-muted">Appareil : {device === "mobile" ? "mobile" : "ordinateur"}, selon la taille d&apos;aperçu choisie. Langue : français.</p>
          </fieldset>
        </div>
      </Dialog>
    </>
  );
}
