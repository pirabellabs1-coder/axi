import { Skeleton } from "@/components/ui/misc";

/** Squelette de l'espace client : titre, onglets, cartes. */
export default function AccountLoading() {
  return (
    <div className="sf-container max-w-[960px] pb-16 pt-6 sm:pt-10" aria-busy="true" aria-label="Chargement de votre compte">
      <Skeleton className="h-10 w-64 rounded-full" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full rounded-full" />
      <div className="mt-7 flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-[var(--store-card-radius,20px)]" />
        ))}
      </div>
    </div>
  );
}
