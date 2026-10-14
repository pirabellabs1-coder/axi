"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { j: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Compte à rebours (rendu identique serveur/client jusqu'à l'hydratation, puis mise à jour chaque seconde). */
export function CountdownTimer({ endsAt, initialNow }: { endsAt: number; initialNow: number }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = endsAt - now;
  if (left <= 0) return <p className="text-lg font-semibold text-ink">L&apos;offre est terminée.</p>;
  const p = parts(left);
  const units: [string, number][] = [
    ["jours", p.j],
    ["heures", p.h],
    ["minutes", p.m],
    ["secondes", p.s],
  ];
  return (
    <div role="timer" aria-label={`Temps restant : ${p.j} jours ${p.h} heures ${p.m} minutes`} className="flex gap-2 sm:gap-3">
      {units.map(([label, v]) => (
        <div key={label} className="flex min-w-[68px] flex-col items-center rounded-[var(--store-card-radius)] bg-surface px-3 py-3 ring-1 ring-line sm:min-w-[84px]">
          <span className="text-[28px] font-semibold leading-none tabular text-ink sm:text-[36px]" aria-hidden>
            {String(v).padStart(2, "0")}
          </span>
          <span className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-ink-muted" aria-hidden>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
