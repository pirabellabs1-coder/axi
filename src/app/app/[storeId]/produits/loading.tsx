import { Skeleton, SkeletonTable } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des produits">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-40" />
          <div className="mt-2.5 flex items-center gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-1.5 w-32 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-11 w-28 rounded-full" />
          <Skeleton className="h-11 w-44 rounded-full" />
        </div>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Skeleton className="h-9 w-80 max-w-full rounded-full" />
          <Skeleton className="ml-auto h-9 w-56 rounded-full" />
          <Skeleton className="h-9 w-36 rounded-full" />
        </div>
        <SkeletonTable rows={10} cols={5} className="rounded-none ring-0" />
      </div>
    </div>
  );
}
