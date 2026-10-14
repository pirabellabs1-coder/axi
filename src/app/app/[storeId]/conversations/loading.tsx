import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des conversations">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-44 rounded-full" />
      </div>
      <div className="grid grid-cols-1 h-[calc(100dvh-13rem)] min-h-[520px] overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <div className="space-y-4 border-r border-line p-4">
          <Skeleton className="h-11 w-full rounded-full" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden flex-col justify-end gap-3 bg-canvas/60 p-6 lg:flex">
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="ml-auto h-12 w-2/5" />
          <Skeleton className="h-16 w-3/5" />
          <Skeleton className="mt-4 h-20 w-full" />
        </div>
        <div className="hidden space-y-4 border-l border-line p-5 xl:block">
          <Skeleton className="mx-auto size-14 rounded-full" />
          <Skeleton className="mx-auto h-4 w-32" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}
