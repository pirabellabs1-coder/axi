"use client";

import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { setPagePublished, movePage, deletePage } from "@/lib/pages/actions";
import { AsyncSwitch, ActionButton, ConfirmActionButton } from "@/components/app/action-controls";

export function PageRowActions({ storeId, id, title, published, first, last }: { storeId: string; id: string; title: string; published: boolean; first: boolean; last: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <AsyncSwitch checked={published} label={published ? "Publiée" : "Masquée"} action={(next) => setPagePublished(storeId, id, next)} />
      <ActionButton variant="ghost" size="icon" action={() => movePage(storeId, id, "up")} disabled={first} aria-label={`Monter ${title}`} successMessage="Ordre mis à jour">
        <ArrowUp className="size-4" aria-hidden />
      </ActionButton>
      <ActionButton variant="ghost" size="icon" action={() => movePage(storeId, id, "down")} disabled={last} aria-label={`Descendre ${title}`} successMessage="Ordre mis à jour">
        <ArrowDown className="size-4" aria-hidden />
      </ActionButton>
      <ConfirmActionButton
        action={() => deletePage(storeId, id)}
        title={`Supprimer « ${title} » ?`}
        description="La page disparaîtra de votre boutique. Cette action est définitive."
        confirmLabel="Supprimer"
        className="inline-flex size-11 items-center justify-center rounded-full text-danger hover:bg-danger-soft"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {title}</span>
      </ConfirmActionButton>
    </div>
  );
}
