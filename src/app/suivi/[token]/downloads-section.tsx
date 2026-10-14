"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileDown } from "lucide-react";
import { openOrderDownload } from "@/lib/digital/actions";
import { toast } from "@/components/ui/toast";

export type TrackingDownload = { grantId: string; itemName: string; files: number; label: string; usable: boolean; problem: string | null };

/**
 * Vague 2 — « Vos fichiers » sur la page de suivi : l'acheteur ouvre ses téléchargements sans compte.
 * Le jeton de téléchargement n'est jamais affiché ici : « Ouvrir » appelle une action serveur qui vérifie
 * le jeton de suivi, émet un NOUVEAU jeton de téléchargement et ouvre la page correspondante.
 */
export function DownloadsSection({ trackingToken, rows }: { trackingToken: string; rows: TrackingDownload[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const open = (grantId: string) => {
    setBusy(grantId);
    start(async () => {
      const res = await openOrderDownload(trackingToken, grantId);
      setBusy(null);
      if (!res.ok || !res.data) return toast.error("Téléchargement indisponible", res.ok ? "Réessayez dans un instant." : res.error);
      router.push(res.data.url);
    });
  };

  return (
    <section className="mt-4 rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6" aria-labelledby="dl-title">
      <h2 id="dl-title" className="flex items-center gap-2 text-base font-semibold text-ink">
        <FileDown className="size-5 text-[var(--store-primary)]" aria-hidden /> Vos fichiers
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Disponibles immédiatement après le paiement. Chaque ouverture crée un lien personnel neuf.</p>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.grantId} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{r.itemName}</p>
              <p className="text-xs text-ink-muted">
                {r.files} fichier{r.files > 1 ? "s" : ""} · {r.label}
              </p>
            </div>
            {r.usable ? (
              <button
                type="button"
                onClick={() => open(r.grantId)}
                disabled={pending}
                aria-busy={pending && busy === r.grantId}
                className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                <Download className="size-4" aria-hidden /> {pending && busy === r.grantId ? "Ouverture…" : "Ouvrir"}
              </button>
            ) : (
              <span className="text-xs font-medium text-ink-muted">{r.problem ?? "Indisponible"}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
