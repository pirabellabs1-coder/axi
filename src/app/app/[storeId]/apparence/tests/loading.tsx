import { Skeleton } from "@/components/ui/misc";

/** Squelette à la forme finale : explication, formulaire de test, liste des résultats. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des tests A/B">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
        <div className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
          <div className="space-y-2 px-6 pb-4 pt-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <div className="space-y-4 px-6 pb-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Skeleton className="h-12 rounded-[var(--radius-md)]" />
              <Skeleton className="h-12 rounded-[var(--radius-md)]" />
            </div>
            <Skeleton className="h-12 rounded-[var(--radius-md)]" />
            <Skeleton className="h-32 rounded-[var(--radius-md)]" />
          </div>
        </div>
        <div className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
          <div className="space-y-2 px-6 pb-4 pt-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <div className="space-y-4 border-t border-line px-6 py-5">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-24 rounded-[var(--radius-md)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
