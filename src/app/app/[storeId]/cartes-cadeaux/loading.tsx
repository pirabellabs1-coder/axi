import { Skeleton, SkeletonTable } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des cartes cadeaux">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-[22px]" />
        ))}
      </div>
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
