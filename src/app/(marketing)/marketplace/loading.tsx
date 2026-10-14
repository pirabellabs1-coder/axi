import { Skeleton } from "@/components/ui/misc";
import { LoadingAnnouncement, ProductGridSkeleton, StoreCardSkeleton } from "@/components/marketplace/skeletons";

export default function Loading() {
  return (
    <div className="container-x pb-20 pt-8 md:pt-14 lg:pt-20">
      <LoadingAnnouncement />
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.08fr_1fr] lg:gap-14">
        <div>
          <Skeleton className="h-14 w-11/12 md:h-20" />
          <Skeleton className="mt-3 h-14 w-3/4 md:h-20" />
          <Skeleton className="mt-6 h-5 w-2/3" />
          <Skeleton className="mt-8 h-[68px] w-full !rounded-full" />
        </div>
        <Skeleton className="aspect-[16/11] w-full !rounded-[var(--radius-xl)] sm:aspect-[5/4]" />
      </div>
      <div className="mt-20 grid auto-rows-[150px] grid-cols-2 gap-3 sm:auto-rows-[180px] md:grid-cols-4 md:gap-4">
        <Skeleton className="col-span-2 row-span-2 !rounded-[var(--radius-lg)]" />
        <Skeleton className="col-span-2 !rounded-[var(--radius-lg)]" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="!rounded-[var(--radius-lg)]" />
        ))}
      </div>
      <div className="mt-20 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StoreCardSkeleton />
        <StoreCardSkeleton className="hidden sm:block" />
        <StoreCardSkeleton className="hidden lg:block" />
      </div>
      <div className="mt-20">
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
