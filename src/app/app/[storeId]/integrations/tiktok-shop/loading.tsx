import { Skeleton, SkeletonTable } from "@/components/ui/misc";

/** Squelette : en-tête, 4 indicateurs, tableau des produits. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement de TikTok Shop">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-[22px]" />
        ))}
      </div>
      <SkeletonTable rows={5} cols={5} />
    </div>
  );
}
