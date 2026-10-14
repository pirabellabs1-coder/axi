import { Skeleton, SkeletonText } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement de la facture</span>
      <Skeleton className="h-7 w-56" />
      <div className="mt-5 rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line sm:p-10">
        <SkeletonText lines={4} className="w-1/2" />
        <Skeleton className="mt-8 h-40 w-full" />
      </div>
    </div>
  );
}
