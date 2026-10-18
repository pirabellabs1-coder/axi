import { Store } from "lucide-react";

/**
 * Vitrine d'une boutique EN PAUSE (abonnement) : aucune donnée de catalogue, aucun prix, aucun moyen de commande.
 * Le motif (facturation) n'est jamais exposé aux acheteurs.
 */
export function PausedStorefront({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6 py-16 text-ink">
      <div className="w-full max-w-md rounded-2xl bg-surface px-6 py-12 text-center ring-1 ring-line">
        {logoUrl && /^https:\/\//i.test(logoUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo marchand d'origine quelconque, page minimale
          <img src={logoUrl} alt="" width={64} height={64} className="mx-auto mb-5 size-16 rounded-full object-cover" />
        ) : (
          <span className="mx-auto mb-5 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
            <Store className="size-6" aria-hidden />
          </span>
        )}
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{name}</h1>
        <p className="mt-3 text-base font-medium">Boutique momentanément fermée</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">Cette boutique ne prend pas de commandes pour le moment. Revenez un peu plus tard.</p>
      </div>
    </main>
  );
}
