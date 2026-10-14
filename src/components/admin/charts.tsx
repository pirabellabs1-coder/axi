"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Graphiques SVG fins de la console (une seule série par graphique, un seul axe) :
 *  - AreaChart : évolution (MRR) — ligne 2 px + aire légère, réticule et infobulle au survol / clavier ;
 *  - BarChart  : volumes par période (inscriptions, commandes) — barres fines, extrémités arrondies.
 * Accessibilité : chaque graphique est un `figure` avec résumé textuel, navigation clavier (flèches)
 * et tableau de données équivalent pour les lecteurs d'écran. Couleurs : tokens (primaire forêt / lime).
 */

export type ChartPoint = { label: string; full: string; value: number };
export type ValueFormat = { kind: "money"; currency: string } | { kind: "count"; singular: string; plural: string };

export function formatValue(v: number, f: ValueFormat, compact = false): string {
  if (f.kind === "money") return formatMoney(v, f.currency, { compact });
  const n = compact && v >= 10_000 ? new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(v) : v.toLocaleString("fr-FR");
  return `${n} ${v > 1 ? f.plural : f.singular}`;
}

function axisValue(v: number, f: ValueFormat): string {
  if (f.kind === "money") return formatMoney(v, f.currency, { compact: true });
  return new Intl.NumberFormat("fr-FR", { notation: v >= 10_000 ? "compact" : "standard" }).format(v);
}

/** Pas « ronds » pour l'axe vertical (1, 2, 2,5, 5 × 10^n). */
function niceMax(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { top: step * ticks, step };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

type Common = { data: ChartPoint[]; format: ValueFormat; label: string; summary: string; height?: number; className?: string; emptyLabel?: string };

const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function Shell({ label, summary, data, format, children, wrapRef, active, className, onKey, onLeave }: Common & { children: React.ReactNode; wrapRef: React.RefObject<HTMLDivElement | null>; active: number | null; onKey: (e: React.KeyboardEvent) => void; onLeave: () => void }) {
  const tableId = useId();
  return (
    <figure className={cn("relative m-0", className)}>
      <div
        ref={wrapRef}
        role="img"
        aria-label={`${label}. ${summary}`}
        aria-describedby={tableId}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={onLeave}
        onMouseLeave={onLeave}
        className="relative w-full rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {children}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Période</th>
            <th scope="col">Valeur</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.full}>
              <th scope="row">{d.full}</th>
              <td>{formatValue(d.value, format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only" aria-live="polite">{active != null && data[active] ? `${data[active].full} : ${formatValue(data[active].value, format)}` : ""}</span>
    </figure>
  );
}

function Tooltip({ x, width, point, format }: { x: number; width: number; point: ChartPoint; format: ValueFormat }) {
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-[10px] bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-lg)] ring-1 ring-line"
      style={{ left }}
      aria-hidden
    >
      <p className="text-ink-muted">{point.full}</p>
      <p className="tabular font-semibold text-ink">{formatValue(point.value, format)}</p>
    </div>
  );
}

function useKeyboard(n: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a == null ? n - 1 : Math.min(n - 1, a + 1)));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a == null ? n - 1 : Math.max(0, a - 1)));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(n - 1);
    } else if (e.key === "Escape") setActive(null);
  };
  return { active, setActive, onKey };
}

/** Étiquettes de l'axe horizontal : toutes si la place le permet, sinon une sur k (la dernière toujours). */
function xLabelEvery(n: number, plotW: number) {
  const fit = Math.max(1, Math.floor(plotW / 44));
  return Math.max(1, Math.ceil(n / fit));
}

/** Étiquette visible : une sur `every`, la dernière toujours, sans chevaucher la dernière. */
function showLabel(i: number, n: number, every: number) {
  if (i === n - 1) return true;
  return i % every === 0 && n - 1 - i >= every;
}

export function AreaChart(props: Common) {
  const { data, format, height = 200, emptyLabel = "Pas encore de données." } = props;
  const { ref, width } = useWidth<HTMLDivElement>();
  const { active, setActive, onKey } = useKeyboard(data.length);
  const gradId = useId().replace(/:/g, "");
  const max = Math.max(0, ...data.map((d) => d.value));
  const { top, step } = niceMax(max);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = data.length ? `${line} L${x(data.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z` : "";
  const every = xLabelEvery(data.length, plotW);
  const empty = max === 0;

  const onMove = (e: React.PointerEvent) => {
    if (!data.length || plotW <= 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    setActive(Math.min(data.length - 1, Math.max(0, Math.round((px / plotW) * (data.length - 1)))));
  };

  return (
    <Shell {...props} wrapRef={ref} active={active} onKey={onKey} onLeave={() => setActive(null)}>
      <div onPointerMove={onMove} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--c-primary)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--c-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--c-line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-faint text-[11px] tabular">{axisValue(t, format)}</text>
              </g>
            ))}
            {data.map((d, i) =>
              showLabel(i, data.length, every) ? (
                <text key={d.full} x={x(i)} y={height - 6} textAnchor={i === 0 && data.length > 1 ? "start" : i === data.length - 1 && data.length > 1 ? "end" : "middle"} className="fill-ink-faint text-[11px]">{d.label}</text>
              ) : null,
            )}
            {!empty && (
              <>
                <path d={area} fill={`url(#${gradId})`} />
                <path d={line} fill="none" stroke="var(--c-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].value)} r={4} fill="var(--c-primary)" stroke="var(--c-surface)" strokeWidth={2} />
              </>
            )}
            {active != null && data[active] && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--c-line-strong)" />
                <circle cx={x(active)} cy={y(data[active].value)} r={5} fill="var(--c-primary)" stroke="var(--c-surface)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {empty && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-ink-muted" style={{ paddingLeft: PAD.left }}>{emptyLabel}</p>}
        {active != null && data[active] && width > 0 && <Tooltip x={x(active)} width={width} point={data[active]} format={format} />}
      </div>
    </Shell>
  );
}

export function BarChart(props: Common & { highlightLast?: boolean }) {
  const { data, format, height = 180, emptyLabel = "Pas encore de données.", highlightLast = true } = props;
  const { ref, width } = useWidth<HTMLDivElement>();
  const { active, setActive, onKey } = useKeyboard(data.length);
  const max = Math.max(0, ...data.map((d) => d.value));
  const { top, step } = niceMax(max);
  const left = 40;
  const plotW = Math.max(0, width - left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(22, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const every = xLabelEvery(data.length, plotW);
  const empty = max === 0;

  return (
    <Shell {...props} wrapRef={ref} active={active} onKey={onKey} onLeave={() => setActive(null)}>
      <div className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} className="block" aria-hidden>
            {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((t) => (
              <g key={t}>
                <line x1={left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--c-line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-faint text-[11px] tabular">{axisValue(t, format)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = left + slot * i + slot / 2;
              const h = Math.max(d.value > 0 ? 2 : 0, PAD.top + plotH - y(d.value));
              const isLast = i === data.length - 1;
              const r = Math.min(4, barW / 2, h);
              const x0 = cx - barW / 2;
              const y0 = PAD.top + plotH - h;
              // Extrémité de donnée arrondie (4 px), base droite ancrée sur l'axe.
              const path = h > 0 ? `M${x0},${PAD.top + plotH} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barW - r} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} V${PAD.top + plotH} Z` : "";
              return (
                <g key={d.full}>
                  {h > 0 && <path d={path} fill="var(--c-primary)" opacity={active === i || (active == null && (!highlightLast || isLast)) ? 1 : active == null ? 0.55 : 0.35} />}
                  <rect x={left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" onPointerEnter={() => setActive(i)} />
                  {showLabel(i, data.length, every) && (
                    <text x={cx} y={height - 6} textAnchor="middle" className="fill-ink-faint text-[11px]">{d.label}</text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {empty && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-ink-muted" style={{ paddingLeft: left }}>{emptyLabel}</p>}
        {active != null && data[active] && width > 0 && <Tooltip x={left + slot * active + slot / 2} width={width} point={data[active]} format={format} />}
      </div>
    </Shell>
  );
}
