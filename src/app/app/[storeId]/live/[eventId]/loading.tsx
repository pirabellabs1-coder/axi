import { Skeleton, SkeletonTable } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Chargement des réservations">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <SkeletonTable rows={6} cols={6} />
    </div>
  );
}
