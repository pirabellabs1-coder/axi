import { Skeleton } from "@/components/ui/misc";

/** Squelette à la forme finale : bandeau de fuseau, formulaire de programmation, liste. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des thèmes programmés">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
        <div className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
          <div className="space-y-2 px-6 pb-4 pt-5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <div className="space-y-4 px-6 pb-6">
            <Skeleton className="h-12 rounded-[var(--radius-md)]" />
            <Skeleton className="h-12 rounded-[var(--radius-md)]" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Skeleton className="h-12 rounded-[var(--radius-md)]" />
              <Skeleton className="h-12 rounded-[var(--radius-md)]" />
            </div>
          </div>
        </div>
        <div className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
          <div className="space-y-2 px-6 pb-4 pt-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </div>
          <div className="divide-y divide-line border-t border-line">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
                <Skeleton className="h-9 w-32 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
