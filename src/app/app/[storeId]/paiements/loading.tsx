import { Skeleton, SkeletonTable } from "@/components/ui/misc";

/** Squelette à la forme finale : bandeau 0 % commission, liste des moyens, rapprochement. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des paiements">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <Skeleton className="h-11 w-44 rounded-full" />
      </div>
      <Skeleton className="mb-8 h-48 rounded-[var(--radius-lg)] md:h-40" />
      <Skeleton className="mb-3 h-6 w-48" />
      <div className="divide-y divide-line rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-10 mb-3 h-6 w-56" />
      <SkeletonTable rows={4} cols={6} />
    </div>
  );
}
