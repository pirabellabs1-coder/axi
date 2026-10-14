import { Skeleton } from "@/components/ui/misc";

/** Squelette à la forme finale : navigation de sections + cartes. */
export default function Loading() {
  return (
    <div className="container-x pb-20 pt-[5.5rem] sm:pt-[6.5rem]" aria-busy="true" aria-label="Chargement du compte">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <div className="space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
          <div className="flex gap-2 pt-3 lg:flex-col">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-36 rounded-full lg:w-full lg:rounded-[var(--radius-md)]" />
            ))}
          </div>
        </div>
        <div className="max-w-2xl space-y-6">
          <Skeleton className="h-24 rounded-[var(--radius-xl)]" />
          <Skeleton className="h-72 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-56 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-48 rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </div>
  );
}
