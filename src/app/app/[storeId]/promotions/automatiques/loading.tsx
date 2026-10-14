import { Skeleton, SkeletonTable } from "@/components/ui/misc";

/** Squelette à la forme finale : en-tête + action, onglets, 4 KPI, tableau des remises. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des remises automatiques">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <Skeleton className="h-11 w-44 rounded-full" />
      </div>
      <Skeleton className="mb-6 h-11 w-full max-w-lg" />
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-[22px]" />
        ))}
      </div>
      <SkeletonTable rows={5} cols={5} />
    </div>
  );
}
