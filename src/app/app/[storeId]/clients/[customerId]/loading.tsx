import { Skeleton, SkeletonTable } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement de la fiche client">
      <Skeleton className="mb-3 h-4 w-20" />
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-36" />
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-[22px]" />
            ))}
          </div>
          <SkeletonTable rows={6} cols={4} />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-64 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-72 rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </div>
  );
}
