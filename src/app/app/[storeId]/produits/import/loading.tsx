import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true" aria-label="Chargement">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="mt-2 mb-6 h-4 w-[28rem] max-w-full" />
      <Skeleton className="mb-5 h-16 w-full rounded-[var(--radius-lg)]" />
      <Skeleton className="mb-5 h-6 w-full" />
      <div className="rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line">
        <Skeleton className="mb-5 h-4 w-24" />
        <Skeleton className="h-44 w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
