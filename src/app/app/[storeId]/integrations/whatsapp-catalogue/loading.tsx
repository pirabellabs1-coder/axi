import { Skeleton, SkeletonTable } from "@/components/ui/misc";

/** Squelette : en-tête, 4 indicateurs, flux, synchronisation, guide. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement du catalogue WhatsApp">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-[22px]" />
        ))}
      </div>
      <Skeleton className="mb-4 h-6 w-48" />
      <Skeleton className="mb-10 h-56 rounded-[var(--radius-lg)]" />
      <Skeleton className="mb-4 h-6 w-80 max-w-full" />
      <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-72 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-72 rounded-[var(--radius-lg)]" />
      </div>
      <SkeletonTable rows={3} cols={3} />
    </div>
  );
}
