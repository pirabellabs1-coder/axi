import { Skeleton, SkeletonTable } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des clients">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-36 rounded-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-[22px]" />
        ))}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Skeleton className="h-9 w-72 max-w-full rounded-full" />
          <Skeleton className="ml-auto h-9 w-64 rounded-full" />
        </div>
        <SkeletonTable rows={10} cols={6} className="rounded-none ring-0" />
      </div>
    </div>
  );
}
