import { Skeleton } from "@/components/ui/misc";

function ListCard({ rows }: { rows: number }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
      <div className="space-y-2 px-6 pt-5 pb-4">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="divide-y divide-line border-t border-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Squelette à la forme finale : 2 modes, zones, créneaux, livreurs, horaires. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement de la livraison">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-44 rounded-[var(--radius-lg)]" />
      </div>
      <div className="space-y-6">
        <ListCard rows={2} />
        <ListCard rows={2} />
        <Skeleton className="h-20 rounded-[var(--radius-lg)]" />
        <ListCard rows={7} />
      </div>
    </div>
  );
}
