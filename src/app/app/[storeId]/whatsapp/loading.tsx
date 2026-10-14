import { Skeleton, SkeletonText, SkeletonTable } from "@/components/ui/misc";

/** Squelette à la forme finale : en-tête, 4 KPI, formulaire + aperçu, section API, journal. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement de la page WhatsApp">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-[22px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5 rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line">
          <SkeletonText lines={2} className="max-w-sm" />
          <Skeleton className="h-12 max-w-sm" />
          <Skeleton className="h-20" />
          <div className="flex justify-end gap-2">
            <Skeleton className="h-11 w-36 rounded-full" />
            <Skeleton className="h-11 w-32 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-[380px] rounded-[var(--radius-lg)]" />
      </div>
      <Skeleton className="mt-10 mb-4 h-6 w-56" />
      <Skeleton className="h-64 rounded-[var(--radius-lg)]" />
      <Skeleton className="mt-10 mb-4 h-6 w-48" />
      <SkeletonTable rows={4} cols={5} />
    </div>
  );
}
