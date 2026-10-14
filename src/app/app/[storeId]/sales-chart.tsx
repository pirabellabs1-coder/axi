"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";

type Point = { date: string; value: number; orders: number };

/** Graduations « rondes » pour l'axe des montants. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

/**
 * Ventes par jour : aire + ligne 2 px, axes discrets, réticule + infobulle au survol,
 * navigation clavier (flèches), tableau équivalent pour les lecteurs d'écran.
 */
export function SalesChart({ series, currency, height = 240 }: { series: Point[]; currency: string; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");
  const descId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = series.reduce((s, x) => s + x.value, 0);
  const maxVal = Math.max(0, ...series.map((s) => s.value));
  const ticks = useMemo(() => niceTicks(maxVal), [maxVal]);
  const top = ticks[ticks.length - 1] || 1;

  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const W = width;
  const H = height;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / top) * innerH;

  const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z` : "";

  const labelCount = W < 480 ? 3 : W < 760 ? 5 : 7;
  const labelIdx = n <= labelCount ? series.map((_, i) => i) : Array.from({ length: labelCount }, (_, k) => Math.round((k * (n - 1)) / (labelCount - 1)));
  const best = series.reduce((b, p, i) => (p.value > (series[b]?.value ?? -1) ? i : b), 0);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-line-strong px-6 text-center" style={{ height }}>
        <p className="text-sm font-medium text-ink">Aucune vente sur la période</p>
        <p className="mt-1 max-w-xs text-sm text-ink-muted">Partagez le lien de votre boutique sur WhatsApp pour recevoir vos premières commandes.</p>
      </div>
    );
  }

  const onMove = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = clientX - rect.left;
    const i = Math.round(((px - padL) / innerW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };

  const a = active != null ? series[active] : null;
  const tipLeft = active != null ? Math.min(Math.max(x(active), 90), W - 90) : 0;

  return (
    <figure className="relative">
      <div
        ref={wrapRef}
        className="relative touch-pan-y select-none"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={descId}
          tabIndex={0}
          onKeyDown={(e) => {
            const map: Record<string, (v: number | null) => number | null> = {
              ArrowRight: (v) => Math.min(n - 1, (v ?? -1) + 1),
              ArrowLeft: (v) => Math.max(0, (v ?? n) - 1),
              Home: () => 0,
              End: () => n - 1,
              Escape: () => null,
            };
            const f = map[e.key];
            if (!f) return;
            e.preventDefault();
            setActive(f);
          }}
          onBlur={() => setActive(null)}
          className="block w-full rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <title id={descId}>
            {`Ventes par jour, total ${formatMoney(total, currency)}, meilleur jour le ${fmtDay(series[best].date, { day: "numeric", month: "long" })} avec ${formatMoney(series[best].value, currency)}. Utilisez les flèches pour parcourir les jours.`}
          </title>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--c-primary)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--c-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--c-line)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={padL - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--c-ink-faint)" className="tabular">
                {t === 0 ? "0" : new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(currency === "XOF" || currency === "XAF" ? t : t / 100)}
              </text>
            </g>
          ))}

          {labelIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="11" fill="var(--c-ink-faint)">
              {fmtDay(series[i].date)}
            </text>
          ))}

          <path d={area} fill={`url(#${gradId})`} />
          <path d={line} fill="none" stroke="var(--c-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {active != null && a && (
            <g aria-hidden>
              <line x1={x(active)} x2={x(active)} y1={padT} y2={padT + innerH} stroke="var(--c-ink-faint)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(active)} cy={y(a.value)} r="5" fill="var(--c-primary)" stroke="var(--c-surface)" strokeWidth="2" />
            </g>
          )}
        </svg>

        {a && active != null && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[12px] bg-surface px-3 py-2 text-xs ring-1 ring-line shadow-[var(--shadow-md)]"
            style={{ left: tipLeft }}
          >
            <p className="font-medium text-ink-muted">{fmtDay(a.date, { weekday: "short", day: "numeric", month: "short" })}</p>
            <p className="tabular mt-0.5 text-sm font-semibold text-ink">{formatMoney(a.value, currency)}</p>
            <p className="tabular text-ink-muted">
              {a.orders} commande{a.orders > 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Ventes par jour</caption>
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col">Ventes</th>
            <th scope="col">Commandes</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.date}>
              <td>{fmtDay(s.date, { day: "numeric", month: "long" })}</td>
              <td>{formatMoney(s.value, currency)}</td>
              <td>{s.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
