import { Skeleton } from "@/components/ui/misc";

/** Squelette plein écran à la forme de l'éditeur : barre du haut, arbre des sections, aperçu, réglages. */
export default function Loading() {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-canvas" aria-busy="true" aria-label="Chargement de l'éditeur de thème">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <Skeleton className="h-9 w-24 rounded-full" />
        <div className="flex flex-1 justify-center">
          <Skeleton className="h-9 w-44 rounded-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div className="w-full space-y-2 border-line bg-surface p-3 lg:border-r">
          <Skeleton className="h-9 w-full rounded-[14px]" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-[12px]" />
          ))}
        </div>
        <div className="hidden bg-canvas-deep p-6 lg:block">
          <Skeleton className="h-full w-full rounded-[var(--radius-lg)]" />
        </div>
        <div className="hidden space-y-4 border-l border-line bg-surface p-4 lg:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
