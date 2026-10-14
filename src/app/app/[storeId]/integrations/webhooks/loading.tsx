import { Skeleton, SkeletonTable } from "@/components/ui/misc";

/** Squelette : en-tête, 4 KPI, points de webhook, livraisons. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des webhooks">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-[22px]" />
        ))}
      </div>
      <Skeleton className="mb-3 h-6 w-48" />
      <Skeleton className="mb-10 h-40 rounded-[var(--radius-lg)]" />
      <Skeleton className="mb-3 h-6 w-32" />
      <SkeletonTable rows={6} cols={6} />
    </div>
  );
}
