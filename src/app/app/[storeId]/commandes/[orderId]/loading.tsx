import type { ReactNode } from "react";
import { Skeleton, SkeletonText } from "@/components/ui/misc";

function CardSkeleton({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-6 ${className ?? ""}`}>{children}</div>;
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement de la commande</span>
      <Skeleton className="mb-3 h-4 w-28" />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-40 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <CardSkeleton>
            <Skeleton className="h-4 w-24" />
            <div className="mt-5 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3.5">
                  <Skeleton className="size-12 rounded-[12px]" />
                  <div className="flex-1">
                    <SkeletonText lines={2} />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
            <div className="ml-auto mt-6 max-w-sm space-y-2">
              <Skeleton className="h-3.5" />
              <Skeleton className="h-3.5" />
              <Skeleton className="h-5" />
            </div>
          </CardSkeleton>
          <CardSkeleton>
            <Skeleton className="h-4 w-24" />
            <SkeletonText lines={3} className="mt-5" />
          </CardSkeleton>
          <CardSkeleton>
            <Skeleton className="h-4 w-28" />
            <div className="mt-5 space-y-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3.5">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1">
                    <SkeletonText lines={2} />
                  </div>
                </div>
              ))}
            </div>
          </CardSkeleton>
        </div>
        <div className="space-y-6">
          <CardSkeleton>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-5 h-1.5 w-full rounded-full" />
            <Skeleton className="mt-4 h-11 w-full rounded-full" />
          </CardSkeleton>
          <CardSkeleton>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1">
                <SkeletonText lines={2} />
              </div>
            </div>
            <SkeletonText lines={2} className="mt-5" />
          </CardSkeleton>
          <CardSkeleton>
            <SkeletonText lines={3} />
          </CardSkeleton>
        </div>
      </div>
    </div>
  );
}
