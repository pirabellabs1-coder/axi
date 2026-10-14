import { Skeleton } from "@/components/ui/misc";
import { LoadingAnnouncement, ProductGridSkeleton, StoreCardSkeleton } from "@/components/marketplace/skeletons";

export default function Loading() {
  return (
    <div className="container-x pb-20 pt-4 md:pt-8">
      <LoadingAnnouncement />
      <Skeleton className="min-h-[320px] w-full !rounded-[var(--radius-2xl)] md:min-h-[420px]" />
      <div className="mt-5 flex gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-28 !rounded-full" />
        ))}
      </div>
      <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StoreCardSkeleton />
        <StoreCardSkeleton className="hidden sm:block" />
        <StoreCardSkeleton className="hidden lg:block" />
      </div>
      <div className="mt-16">
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
