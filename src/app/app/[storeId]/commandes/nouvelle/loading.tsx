import { Skeleton, SkeletonText } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement du formulaire</span>
      <Skeleton className="mb-3 h-4 w-28" />
      <Skeleton className="h-8 w-60" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {[2, 3, 3].map((lines, i) => (
            <div key={i} className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-6">
              <Skeleton className="h-4 w-28" />
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {Array.from({ length: lines }).map((_, j) => (
                  <div key={j}>
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="mt-2 h-12 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line">
          <Skeleton className="h-4 w-28" />
          <SkeletonText lines={4} className="mt-5" />
          <Skeleton className="mt-6 h-12 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
