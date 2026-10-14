import Link from "next/link";
import { Download, FileDown } from "lucide-react";
import { listCustomerDownloads } from "@/lib/digital/service";
import { downloadsLabel } from "@/lib/digital/rules";
import { formatDate } from "@/lib/utils";

/**
 * Vague 2 — « Mes téléchargements » de l'espace compte acheteur (`/s/{slug}/compte`).
 *
 * Composant serveur PRÊT À MONTER : l'équipe de l'espace compte l'insère tel quel (voir
 * docs/vague2/N-produits-numeriques.md § « Lignes à insérer par les autres équipes ») :
 *
 *   import { BuyerDownloads } from "@/components/digital/buyer-downloads";
 *   …
 *   <BuyerDownloads storeId={store.id} customerId={buyer.customerId} />
 *
 * `customerId` DOIT venir de la session acheteur (`getBuyer(store)`), jamais d'une saisie ; la lecture est
 * filtrée par `storeId` ET `customerId`. Le jeton de téléchargement n'est pas réaffiché : l'acheteur ouvre
 * sa commande (page de suivi), d'où partent les liens de la commande.
 */
export async function BuyerDownloads({ storeId, customerId, className }: { storeId: string; customerId: string; className?: string }) {
  const rows = await listCustomerDownloads(storeId, customerId);
  if (rows.length === 0) return null;
  const now = new Date();

  return (
    <section className={className ?? "rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6"} aria-labelledby="downloads-title">
      <h2 id="downloads-title" className="flex items-center gap-2 text-base font-semibold text-ink">
        <FileDown className="size-5 text-[var(--store-primary)]" aria-hidden /> Mes téléchargements
      </h2>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.grantId} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{r.itemName}</p>
              <p className="text-xs text-ink-muted">
                Commande {r.reference} · {r.files} fichier{r.files > 1 ? "s" : ""} · {downloadsLabel(r, now)}
                {r.expiresAt ? ` · jusqu'au ${formatDate(r.expiresAt, { day: "numeric", month: "long", year: "numeric" })}` : ""}
              </p>
            </div>
            {r.state.usable ? (
              <Link
                href={`/suivi/${r.trackingToken}`}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-surface px-5 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2"
              >
                <Download className="size-4" aria-hidden /> Ouvrir
              </Link>
            ) : (
              <span className="text-xs font-medium text-ink-muted">{r.state.expired ? "Lien expiré" : "Limite atteinte"}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-muted">Besoin d&apos;un nouvel accès ? Écrivez à la boutique : elle peut renvoyer un lien.</p>
    </section>
  );
}
