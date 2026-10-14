import { Skeleton } from "@/components/ui/misc";

/** Squelette générique de page de module (en-tête + cartes). */
export function PageSkeleton({ cards = 2, stats = 0 }: { cards?: number; stats?: number }) {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {stats > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: stats }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      <div className="space-y-5">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  );
}
