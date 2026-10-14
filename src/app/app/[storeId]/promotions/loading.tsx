import { Skeleton, SkeletonTable } from "@/components/ui/misc";

/** Squelette à la forme finale : en-tête + action, 4 KPI, tableau des codes. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des codes promo">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-[22px]" />
        ))}
      </div>
      <SkeletonTable rows={5} cols={6} />
    </div>
  );
}
