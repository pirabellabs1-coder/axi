import { Skeleton, SkeletonText } from "@/components/ui/misc";

export default function DeveloperLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement…</span>
      <Skeleton className="mb-3 h-8 w-64" />
      <SkeletonText lines={2} className="mb-8 max-w-xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
