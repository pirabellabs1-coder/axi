"use client";

import { createContext, useContext, useId, useState } from "react";
import { Globe2 } from "lucide-react";
import { YEARLY_MONTHS_PAID, type Interval, type PlanId, type PricingZone } from "@/config/plans";

/** Prix mensuels effectifs par plan et par zone (surcharges admin comprises), calculés côté serveur. */
export type EffectiveMonthly = Partial<Record<PlanId, Record<PricingZone, number | null>>>;
import { cn } from "@/lib/utils";

type PricingState = {
  zone: PricingZone;
  setZone: (z: PricingZone) => void;
  interval: Interval;
  setInterval: (i: Interval) => void;
  prices?: EffectiveMonthly;
};

const PricingContext = createContext<PricingState | null>(null);

/** État partagé de la page tarifs : zone (€ / FCFA) et période (mensuel / annuel). Défaut : euros, mensuel. */
export function PricingProvider({ children, defaultZone = "WORLD", prices }: { children: React.ReactNode; defaultZone?: PricingZone; prices?: EffectiveMonthly }) {
  const [zone, setZone] = useState<PricingZone>(defaultZone);
  const [interval, setInterval] = useState<Interval>("MONTHLY");
  return <PricingContext.Provider value={{ zone, setZone, interval, setInterval, prices }}>{children}</PricingContext.Provider>;
}

export function usePricing(): PricingState {
  const ctx = useContext(PricingContext);
  if (!ctx) throw new Error("usePricing doit être utilisé dans <PricingProvider>");
  return ctx;
}

/** Contrôle segmenté à deux options (radios natifs), pastille glissante en transform. */
function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  className,
}: {
  legend: string;
  value: T;
  options: { id: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const name = useId();
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <fieldset className={cn("relative grid w-fit grid-cols-2 rounded-full bg-surface p-1 ring-1 ring-line shadow-[var(--shadow-card)]", className)}>
      <legend className="sr-only">{legend}</legend>
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-ink transition-transform duration-500 ease-spring"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => {
        const active = o.id === value;
        return (
          <label
            key={o.id}
            className={cn(
              "relative z-10 inline-flex h-10 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              active ? "text-canvas" : "text-ink-muted hover:text-ink",
            )}
          >
            <input type="radio" name={name} value={o.id} checked={active} onChange={() => onChange(o.id)} className="sr-only" />
            {o.label}
          </label>
        );
      })}
    </fieldset>
  );
}

export function ZoneSwitch({ className }: { className?: string }) {
  const { zone, setZone } = usePricing();
  return (
    <Segmented<PricingZone>
      legend="Zone de prix"
      value={zone}
      onChange={setZone}
      className={className}
      options={[
        { id: "WORLD", label: "Monde · €" },
        { id: "AFRICA", label: "Afrique · FCFA" },
      ]}
    />
  );
}

export function IntervalSwitch({ className }: { className?: string }) {
  const { interval, setInterval } = usePricing();
  return (
    <Segmented<Interval>
      legend="Période de facturation"
      value={interval}
      onChange={setInterval}
      className={className}
      options={[
        { id: "MONTHLY", label: "Mensuel" },
        {
          id: "YEARLY",
          label: (
            <>
              Annuel
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", interval === "YEARLY" ? "bg-accent text-on-accent" : "bg-accent-soft text-ink")}>{12 - YEARLY_MONTHS_PAID} mois offerts</span>
            </>
          ),
        },
      ]}
    />
  );
}

/** Raccourci explicite pour les commerçants d'Afrique francophone. */
export function AfricaShortcut({ className }: { className?: string }) {
  const { zone, setZone } = usePricing();
  const africa = zone === "AFRICA";
  return (
    <button
      type="button"
      onClick={() => setZone(africa ? "WORLD" : "AFRICA")}
      className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-primary underline-offset-4 hover:underline", className)}
    >
      <Globe2 className="size-4" aria-hidden />
      {africa ? "Afficher les prix en euros" : "Prix pour l'Afrique francophone"}
    </button>
  );
}

/** Annonce discrète du changement de devise pour les lecteurs d'écran. */
export function PricingAnnouncer() {
  const { zone, interval } = usePricing();
  return (
    <p className="sr-only" aria-live="polite">
      Prix affichés {zone === "AFRICA" ? "en francs CFA" : "en euros"}, {interval === "YEARLY" ? "paiement annuel" : "paiement mensuel"}.
    </p>
  );
}
