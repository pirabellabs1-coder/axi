import { Skeleton, SkeletonTable } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement des commandes</span>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-44 rounded-full" />
        </div>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Skeleton className="h-9 w-[420px] max-w-full rounded-full" />
          <Skeleton className="h-9 min-w-[200px] flex-1" />
          <Skeleton className="hidden h-9 w-36 sm:block" />
          <Skeleton className="hidden h-9 w-36 sm:block" />
          <Skeleton className="hidden h-9 w-36 sm:block" />
        </div>
        <div className="divide-y divide-line md:hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-5 w-48 rounded-full" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <SkeletonTable rows={10} cols={8} className="hidden rounded-none shadow-none ring-0 md:block" />
      </div>
    </div>
  );
}
