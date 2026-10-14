"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, ArrowUpRight, Check, Lightbulb, Loader2, Lock, Wand2 } from "lucide-react";
import { isDocumentFix, type Issue, type QualityCategory, type QualityReport } from "@/lib/theme-engine/quality";
import { cn } from "@/lib/utils";
import { actionHref, CATEGORY_LABELS, CATEGORY_ORDER, scoreBand, SEVERITY_LABELS } from "./quality-fix";

const TONE = {
  good: { ring: "stroke-primary", text: "text-primary-deep" },
  medium: { ring: "stroke-warning", text: "text-warning" },
  low: { ring: "stroke-danger", text: "text-danger" },
} as const;

/** Jauge circulaire (SVG fin) ; valeur exposée en `meter` avec libellé texte (jamais la couleur seule). */
function Gauge({ category, score, active, onClick }: { category: QualityCategory; score: number; active: boolean; onClick: () => void }) {
  const band = scoreBand(score);
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] p-2 text-left ring-1 transition-[background-color,box-shadow] duration-150",
        active ? "bg-primary-soft ring-2 ring-primary" : "ring-line hover:bg-surface-2",
      )}
    >
      <span role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-valuetext={`${score} sur 100, ${band.label.toLowerCase()}`} aria-label={CATEGORY_LABELS[category]} className="relative grid size-12 shrink-0 place-items-center">
        <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="28" cy="28" r={r} fill="none" strokeWidth="4" className="stroke-line" />
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
            className={cn(TONE[band.tone].ring, "transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none")}
          />
        </svg>
        <span className="tabular text-[14px] font-semibold text-ink" aria-hidden>
          {score}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium leading-tight text-ink">{CATEGORY_LABELS[category]}</span>
        <span className={cn("block truncate text-[11.5px] font-medium leading-tight", TONE[band.tone].text)}>{band.label}</span>
      </span>
    </button>
  );
}

const SEVERITY_ICON = { error: AlertCircle, warning: AlertTriangle, tip: Lightbulb } as const;
const SEVERITY_TONE = { error: "text-danger", warning: "text-warning", tip: "text-info" } as const;

export function QualityPanel({
  report,
  pending,
  enabled,
  storeId,
  onFix,
  onShow,
}: {
  report: QualityReport;
  /** Calcul en attente (anti-rebond 500 ms). */
  pending: boolean;
  enabled: boolean;
  storeId: string;
  onFix: (issue: Issue) => void;
  onShow: (issue: Issue) => void;
}) {
  const [filter, setFilter] = React.useState<QualityCategory | null>(null);
  if (!enabled) {
    return (
      <div className="p-4">
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Les scores de qualité ne sont pas inclus dans votre plan.{" "}
            <a href={`/app/${storeId}/abonnement`} className="font-medium text-primary underline-offset-4 hover:underline">
              Voir les plans
            </a>
          </span>
        </p>
      </div>
    );
  }
  const issues = filter ? report.issues.filter((i) => i.category === filter) : report.issues;
  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Qualité de la boutique</h2>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted" aria-live="polite">
          {pending ? (
            <>
              <Loader2 className="size-3 animate-spin" aria-hidden /> Calcul…
            </>
          ) : (
            "À jour"
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Scores par catégorie (filtrer la liste)">
        {CATEGORY_ORDER.map((c) => (
          <Gauge key={c} category={c} score={report.scores[c]} active={filter === c} onClick={() => setFilter(filter === c ? null : c)} />
        ))}
      </div>
      <p className="px-1 text-[12.5px] leading-relaxed text-ink-muted">
        {filter ? `${CATEGORY_LABELS[filter]} : ` : ""}
        {issues.length ? `${issues.length} point${issues.length > 1 ? "s" : ""} à vérifier, du plus important au simple conseil.` : "Aucun problème détecté."}
      </p>
      {issues.length ? (
        <ul className="space-y-2" aria-label="Problèmes détectés">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} storeId={storeId} onFix={onFix} onShow={onShow} />
          ))}
        </ul>
      ) : (
        <div className="grid place-items-center gap-2 py-8 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary-deep">
            <Check className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-medium text-ink">{filter ? "Rien à corriger dans cette catégorie" : "Tout est en ordre"}</p>
        </div>
      )}
      <p className="px-1 text-[11.5px] leading-relaxed text-ink-faint">Les scores se mettent à jour pendant que vous modifiez le thème. Chaque correction peut être annulée (Ctrl+Z).</p>
    </div>
  );
}

function IssueRow({ issue, storeId, onFix, onShow }: { issue: Issue; storeId: string; onFix: (i: Issue) => void; onShow: (i: Issue) => void }) {
  const Icon = SEVERITY_ICON[issue.severity];
  const docFix = isDocumentFix(issue.fix);
  const href = actionHref(issue, storeId);
  const canShow = !!issue.target && (!!issue.target.sectionId || !!issue.target.global || !!issue.target.template);
  return (
    <li className="rounded-[var(--radius-md)] p-3 ring-1 ring-line">
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", SEVERITY_TONE[issue.severity])} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-ink">
            <span className="sr-only">{SEVERITY_LABELS[issue.severity]}, {CATEGORY_LABELS[issue.category]} : </span>
            {issue.message}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-muted" aria-hidden>
            {SEVERITY_LABELS[issue.severity]} · {CATEGORY_LABELS[issue.category]}
          </p>
          {(docFix || href || canShow) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {docFix && (
                <button
                  type="button"
                  onClick={() => onFix(issue)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-medium text-on-primary transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.97] sm:h-8"
                >
                  <Wand2 className="size-3.5" aria-hidden /> {issue.fixLabel ?? "Corriger"}
                </button>
              )}
              {!docFix && href && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[12.5px] font-medium text-ink hover:bg-line sm:h-8">
                  {issue.fixLabel?.includes("IA") ? "Corriger dans la fiche" : (issue.fixLabel ?? "Ouvrir")} <ArrowUpRight className="size-3.5" aria-hidden />
                  <span className="sr-only">(nouvel onglet)</span>
                </a>
              )}
              {canShow && (
                <button type="button" onClick={() => onShow(issue)} className="inline-flex h-11 items-center rounded-full px-3 text-[12.5px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink sm:h-8">
                  Voir
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
