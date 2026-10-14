import { Skeleton, SkeletonText } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement de la facture</span>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-48 rounded-full" />
      </div>
      <div className="rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line sm:p-10">
        <div className="flex justify-between gap-4">
          <SkeletonText lines={4} className="w-1/2" />
          <SkeletonText lines={3} className="w-1/3" />
        </div>
        <Skeleton className="mt-8 h-40 w-full" />
        <SkeletonText lines={3} className="ml-auto mt-6 max-w-sm" />
      </div>
    </div>
  );
}
