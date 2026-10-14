import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Recherche en cours" className="space-y-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-12 w-full max-w-xl rounded-full" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-[var(--radius-lg)] lg:col-span-2" />
        <Skeleton className="h-56 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-56 rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
