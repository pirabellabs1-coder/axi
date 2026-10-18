import { Skeleton } from "@/components/ui/misc";

/** Squelette : en-tête, compte et état, publications. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement des produits Instagram">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-56 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-56 rounded-[var(--radius-lg)]" />
      </div>
      <Skeleton className="h-72 rounded-[var(--radius-lg)]" />
    </div>
  );
}
