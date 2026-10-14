import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function ProductCardSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="aspect-[4/5] w-full !rounded-[var(--radius-lg)]" />
      <Skeleton className="mt-3 h-3 w-1/3" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <Skeleton className="mt-2 h-4 w-1/4" />
    </div>
  );
}

export function StoreCardSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line", className)}>
      <Skeleton className="aspect-[16/10] w-full !rounded-none" />
      <div className="px-4 pb-4">
        <Skeleton className="-mt-7 size-14 !rounded-full ring-4 ring-surface" />
        <Skeleton className="mt-3 h-4 w-2/3" />
        <Skeleton className="mt-2 h-3 w-1/2" />
        <Skeleton className="mt-4 h-3 w-3/4" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function LoadingAnnouncement({ label = "Chargement de la marketplace" }: { label?: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}
