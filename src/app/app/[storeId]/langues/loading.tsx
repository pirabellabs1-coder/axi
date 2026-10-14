import { Skeleton } from "@/components/ui/misc";

/** Squelette à la forme finale : bandeau d'information, langues, glossaire, tableau des traductions. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des langues">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
        {[6, 1, 4].map((rows, k) => (
          <div key={k} className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
            <div className="space-y-2 px-6 pb-4 pt-5">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3.5 w-80 max-w-full" />
            </div>
            <div className="divide-y divide-line border-t border-line">
              {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
