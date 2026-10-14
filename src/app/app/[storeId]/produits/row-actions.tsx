"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductStatus } from "@prisma/client";
import { MoreHorizontal, Pencil, Copy, Star, StarOff, Archive, ArchiveRestore, Boxes, Loader2 } from "lucide-react";
import { archiveProduct, restoreProduct, duplicateProduct, toggleFeatured } from "@/lib/products/actions";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

export function ProductRowActions({
  storeId,
  productId,
  name,
  status,
  isFeatured,
  trackStock,
}: {
  storeId: string;
  productId: string;
  name?: string;
  status: ProductStatus;
  isFeatured: boolean;
  trackStock: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const base = `/app/${storeId}/produits`;

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: (data: unknown) => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        router.refresh();
        after?.(res.data);
      } else toast.error("Action impossible", res.error);
    });

  return (
    <DropdownMenu
      label={name ? `Actions pour ${name}` : "Actions du produit"}
      trigger={(p) => (
        <button
          {...p}
          disabled={pending}
          aria-label={name ? `Actions pour ${name}` : "Actions du produit"}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink aria-expanded:bg-surface-2 aria-expanded:text-ink md:size-9"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MoreHorizontal className="size-5" aria-hidden />}
        </button>
      )}
    >
      <DropdownItem icon={Pencil} href={`${base}/${productId}`}>
        Modifier
      </DropdownItem>
      {trackStock && (
        <DropdownItem icon={Boxes} href={`${base}/${productId}/stock`}>
          Stock et mouvements
        </DropdownItem>
      )}
      <DropdownItem icon={isFeatured ? StarOff : Star} onSelect={() => run(() => toggleFeatured(storeId, productId))}>
        {isFeatured ? "Retirer de la mise en avant" : "Mettre en avant"}
      </DropdownItem>
      <DropdownItem
        icon={Copy}
        onSelect={() =>
          run(
            () => duplicateProduct(storeId, productId),
            (data) => {
              const id = (data as { productId?: string } | undefined)?.productId;
              if (id) router.push(`${base}/${id}`);
            },
          )
        }
      >
        Dupliquer
      </DropdownItem>
      <DropdownSeparator />
      {status === "ARCHIVED" ? (
        <DropdownItem icon={ArchiveRestore} onSelect={() => run(() => restoreProduct(storeId, productId))}>
          Restaurer
        </DropdownItem>
      ) : (
        <DropdownItem icon={Archive} tone="danger" onSelect={() => run(() => archiveProduct(storeId, productId))}>
          Archiver
        </DropdownItem>
      )}
    </DropdownMenu>
  );
}
