"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Hand, ImageOff, Loader2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { useSortable } from "@/components/theme-editor/use-sortable";
import { reorderCollections } from "@/lib/collections/actions";
import { mergeCollectionOrder, moveId } from "@/lib/collections/order";
import { cn } from "@/lib/utils";

export type CollectionRow = {
  id: string;
  name: string;
  href: string;
  image: string | null;
  auto: boolean;
  rulesLabel: string;
  sortLabel: string;
  count: number;
  published: boolean;
};

/** Délai avant enregistrement : plusieurs déplacements au clavier donnent un seul appel serveur. */
const SAVE_DELAY_MS = 600;

const iconBtn =
  "relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-ink active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-35 sm:size-9";

/**
 * Liste des collections réordonnable : poignée (glisser à la souris / au doigt, ou Espace + flèches au clavier)
 * et boutons Monter / Descendre. L'ordre est enregistré (`reorderCollections`) et se reflète dans la boutique
 * (liste de collections, menus par défaut, filtres).
 */
export function SortableCollectionList({ storeId, rows }: { storeId: string; rows: CollectionRow[] }) {
  const router = useRouter();
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const serverOrder = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const [order, setOrder] = React.useState(serverOrder);
  const [live, setLive] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [savedKey, setSavedKey] = React.useState(() => serverOrder.join(","));

  // Nouvelles données serveur (création, suppression, refresh) : on repart de l'ordre serveur,
  // sauf déplacements locaux pas encore enregistrés (conservés, complétés des nouvelles collections).
  const [lastServer, setLastServer] = React.useState(serverOrder);
  if (lastServer !== serverOrder) {
    setLastServer(serverOrder);
    const pending = order.join(",") !== savedKey;
    setSavedKey(serverOrder.join(","));
    setOrder(pending ? mergeCollectionOrder(order, serverOrder) : serverOrder);
  }

  const ids = order.filter((id) => byId.has(id));
  const label = (id: string) => byId.get(id)?.name ?? "Collection";
  const move = React.useCallback((id: string, to: number) => setOrder((cur) => moveId(cur, id, to)), []);
  const sortable = useSortable({ ids, onMove: move, label, announce: setLive });

  // Enregistrement différé de l'ordre.
  const key = order.join(",");
  React.useEffect(() => {
    if (key === savedKey) return;
    const t = setTimeout(async () => {
      setSaving(true);
      const r = await reorderCollections(storeId, key.split(",")).catch(() => ({ ok: false as const, error: "Connexion perdue. Réessayez." }));
      setSaving(false);
      if (r.ok) {
        setSavedKey(key);
        toast.success("Ordre des collections enregistré");
        router.refresh();
      } else {
        toast.error("Ordre non enregistré", r.error);
        setOrder(savedKey.split(","));
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [key, savedKey, storeId, router]);

  const step = (id: string, delta: number) => {
    const i = ids.indexOf(id);
    const to = i + delta;
    if (to < 0 || to >= ids.length) return;
    move(id, to);
    setLive(`${label(id)} : position ${to + 1} sur ${ids.length}.`);
  };

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {live}
      </div>
      <p className="mb-2 flex min-h-6 items-center gap-2 text-[13px] text-ink-muted">
        {saving ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Enregistrement de l&apos;ordre…
          </>
        ) : (
          "Glissez la poignée ou utilisez les flèches pour choisir l'ordre d'affichage dans la boutique."
        )}
      </p>
      <Card className="overflow-hidden">
      <ul className="divide-y divide-line" aria-label="Collections, dans l'ordre d'affichage">
        {ids.map((id, index) => {
          const c = byId.get(id)!;
          return (
            <li
              key={id}
              ref={sortable.itemRef(id)}
              style={sortable.itemStyle(id)}
              className={cn(
                "relative flex items-center gap-2 bg-surface py-3 pl-1 pr-3 transition-colors hover:bg-surface-2/60 sm:gap-3 sm:pl-2 sm:pr-5",
                sortable.draggingId === id && "shadow-[var(--shadow-md)] ring-1 ring-line",
                sortable.grabbedId === id && "ring-2 ring-inset ring-primary",
              )}
            >
              {ids.length > 1 && (
                <button type="button" className={cn(iconBtn, "cursor-grab active:cursor-grabbing")} {...sortable.handleProps(id)}>
                  <GripVertical className="size-4" aria-hidden />
                </button>
              )}
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image} alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded-[12px] object-cover ring-1 ring-line" />
              ) : (
                <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-surface-2 text-ink-faint ring-1 ring-inset ring-line" aria-hidden>
                  <ImageOff className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <Link href={c.href} className="block truncate text-[15px] font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:underline">
                  {c.name}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                  <span className="inline-flex items-center gap-1">
                    {c.auto ? <Wand2 className="size-3.5" aria-hidden /> : <Hand className="size-3.5" aria-hidden />} {c.rulesLabel}
                  </span>
                  <span aria-hidden>·</span>
                  <span>Tri : {c.sortLabel}</span>
                  {!c.published && (
                    <>
                      <span aria-hidden className="sm:hidden">·</span>
                      <span className="font-medium sm:hidden">Masquée</span>
                    </>
                  )}
                </p>
              </div>
              <span className="tabular hidden text-sm text-ink-muted md:block">
                {c.count} produit{c.count > 1 ? "s" : ""} actif{c.count > 1 ? "s" : ""}
              </span>
              <Badge tone={c.published ? "success" : "neutral"} dot className="hidden sm:inline-flex">
                {c.published ? "Publiée" : "Masquée"}
              </Badge>
              {ids.length > 1 && (
                <div className="flex shrink-0 items-center">
                  <button type="button" className={iconBtn} disabled={index === 0} onClick={() => step(id, -1)} aria-label={`Monter ${c.name}`} title="Monter">
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button type="button" className={iconBtn} disabled={index === ids.length - 1} onClick={() => step(id, 1)} aria-label={`Descendre ${c.name}`} title="Descendre">
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      </Card>
    </>
  );
}
