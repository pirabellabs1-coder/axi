import { Skeleton } from "@/components/ui/misc";
import { LoadingAnnouncement, ProductGridSkeleton } from "@/components/marketplace/skeletons";

export default function Loading() {
  return (
    <div className="container-x pb-20 pt-6 md:pt-10">
      <LoadingAnnouncement label="Recherche en cours" />
      <Skeleton className="h-4 w-40" />
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-end">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-[60px] w-full !rounded-full" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-12">
        <div className="hidden space-y-3 lg:block">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between border-b border-line pb-4">
            <Skeleton className="h-12 w-60 !rounded-full" />
            <Skeleton className="h-11 w-40 !rounded-full" />
          </div>
          <Skeleton className="mt-4 h-4 w-32" />
          <div className="mt-6">
            <ProductGridSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
