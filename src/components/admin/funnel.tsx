import { ArrowDown } from "lucide-react";
import type { FunnelStep } from "@/lib/admin/metrics";
import { barWidth } from "@/lib/admin/metrics";

const pct = (v: number | null) => (v == null ? "-" : `${v.toLocaleString("fr-FR")} %`);

/**
 * Entonnoir d'activation (inscrit → boutique créée → publiée → 1re commande), barres horizontales
 * proportionnelles à la première étape. Chaque étape porte son effectif et ses taux en texte.
 */
export function ActivationFunnel({ steps }: { steps: FunnelStep[] }) {
  const max = steps[0]?.count ?? 0;
  if (max === 0) return <p className="px-5 py-8 text-sm text-ink-muted sm:px-6">Aucune inscription sur la période.</p>;
  return (
    <ol className="space-y-1 px-5 pb-5 pt-3 sm:px-6" aria-label="Entonnoir d'activation">
      {steps.map((s, i) => (
        <li key={s.key}>
          {i > 0 && (
            <p className="flex items-center gap-1.5 py-1 pl-1 text-xs text-ink-muted">
              <ArrowDown className="size-3.5 text-ink-faint" aria-hidden />
              <span className="tabular font-medium text-ink">{pct(s.fromPrevious)}</span> passent à l&apos;étape suivante
            </p>
          )}
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-ink">{s.label}</span>
            <span className="tabular shrink-0 text-ink">
              <span className="font-semibold">{s.count.toLocaleString("fr-FR")}</span>
              {s.fromFirst != null && <span className="ml-2 text-xs text-ink-muted">{pct(s.fromFirst)} des inscrits</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-spring motion-reduce:transition-none" style={{ transform: `scaleX(${barWidth(s.count, max) / 100})`, opacity: 1 - i * 0.15 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
