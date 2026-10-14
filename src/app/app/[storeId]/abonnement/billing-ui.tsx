import type { BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const INV_TONE: Record<string, BadgeTone> = { DRAFT: "neutral", OPEN: "sun", PAID: "success", VOID: "neutral", UNCOLLECTIBLE: "danger" };
export const INV_LABEL: Record<string, string> = { DRAFT: "Brouillon", OPEN: "À payer", PAID: "Payée", VOID: "Annulée", UNCOLLECTIBLE: "Impayée" };

/**
 * Jauge d'usage sobre : une ligne de texte + une barre fine.
 * Couleur ET texte (jamais la couleur seule) : « 18 / 20 », « Limite atteinte ».
 */
export function UsageMeter({ label, used, limit, unit, hint }: { label: string; used: number; limit: number | null; unit?: string; hint?: string }) {
  const included = limit !== 0;
  const pct = limit == null || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const state = !included ? "off" : limit == null ? "unlimited" : pct >= 100 ? "full" : pct >= 80 ? "high" : "ok";
  const fmt = (n: number) => n.toLocaleString("fr-FR");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular text-ink-muted">
          {state === "off" ? (
            "Non inclus"
          ) : state === "unlimited" ? (
            <>
              <span className="text-ink">{fmt(used)}</span> · illimité
            </>
          ) : (
            <>
              <span className={cn("font-medium", state === "full" ? "text-danger" : "text-ink")}>{fmt(used)}</span> / {fmt(limit!)}
              {unit ? ` ${unit}` : ""}
            </>
          )}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state === "off" || state === "unlimited" ? undefined : pct}
        aria-valuetext={state === "off" ? "Non inclus" : state === "unlimited" ? `${used}, illimité` : `${used} sur ${limit}`}
      >
        {state !== "off" && (
          <div
            className={cn("h-full origin-left rounded-full", state === "full" ? "bg-danger" : state === "high" ? "bg-sun" : "bg-primary", state === "unlimited" && "opacity-30")}
            style={{ width: state === "unlimited" ? "100%" : `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
          />
        )}
      </div>
      {(hint || state === "full") && <p className={cn("mt-1.5 text-xs", state === "full" ? "text-danger" : "text-ink-muted")}>{state === "full" ? "Limite atteinte." : hint}</p>}
    </div>
  );
}
