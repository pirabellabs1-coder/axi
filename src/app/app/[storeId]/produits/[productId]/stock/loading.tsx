import { Skeleton, SkeletonTable } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement du stock">
      <Skeleton className="mb-3 h-4 w-32" />
      <Skeleton className="h-8 w-60 max-w-full" />
      <Skeleton className="mt-2 mb-6 h-4 w-96 max-w-full" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-[22px]" />
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SkeletonTable rows={8} cols={5} />
        <Skeleton className="h-80 rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
