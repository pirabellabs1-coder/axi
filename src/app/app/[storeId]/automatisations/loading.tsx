import { Skeleton } from "@/components/ui/misc";

function Rows({ count }: { count: number }) {
  return (
    <div className="divide-y divide-line rounded-[var(--radius-lg)] bg-surface ring-1 ring-line">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-4 px-6 py-4">
          <div className="flex-1 space-y-2.5">
            <div className="flex gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-full max-w-xl" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Squelette à la forme finale : compteur + canaux, liste, scénarios. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des automatisations">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-11 w-52 rounded-full" />
      </div>
      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Skeleton className="h-32 rounded-[22px]" />
        <Skeleton className="h-32 rounded-[var(--radius-lg)]" />
      </div>
      <Skeleton className="mb-3 h-6 w-48" />
      <Rows count={3} />
      <Skeleton className="mt-10 mb-3 h-6 w-44" />
      <Rows count={3} />
    </div>
  );
}
