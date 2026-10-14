import { Skeleton, SkeletonText } from "@/components/ui/misc";

/** Squelette du formulaire produit (2 colonnes), partagé par nouveau et [productId]. */
export function ProductFormSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement du produit">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-6 h-8 w-64 max-w-full" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {[3, 2, 2].map((lines, i) => (
            <div key={i} className="rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line">
              <Skeleton className="mb-5 h-4 w-32" />
              <div className="space-y-4">
                {Array.from({ length: lines }).map((_, j) => (
                  <div key={j}>
                    <Skeleton className="mb-2 h-3.5 w-24" />
                    <Skeleton className="h-12 w-full rounded-[var(--radius-md)]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-5">
          <div className="rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line">
            <Skeleton className="mb-5 h-4 w-24" />
            <Skeleton className="h-12 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="mt-4 h-12 w-full rounded-[var(--radius-md)]" />
          </div>
          <div className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line">
            <Skeleton className="aspect-[4/5] w-full rounded-[var(--radius-md)]" />
            <SkeletonText lines={2} className="mt-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
