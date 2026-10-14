import { Skeleton } from "@/components/ui/misc";

/** Squelette du checkout : 3 sections + récapitulatif. */
export default function CheckoutLoading() {
  return (
    <div className="container-x max-w-[1120px] pb-16 pt-4 sm:pt-8" aria-busy="true" aria-label="Chargement de la commande">
      <Skeleton className="h-11 w-40 rounded-full" />
      <Skeleton className="mb-6 mt-3 h-10 w-72" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <div className="space-y-5">
          <Skeleton className="h-14 rounded-[var(--store-card-radius)] lg:hidden" />
          <Skeleton className="h-64 rounded-[var(--store-card-radius)]" />
          <Skeleton className="h-56 rounded-[var(--store-card-radius)]" />
          <Skeleton className="h-72 rounded-[var(--store-card-radius)]" />
        </div>
        <Skeleton className="hidden h-96 rounded-[var(--radius-xl)] lg:block" />
      </div>
    </div>
  );
}
